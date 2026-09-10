import { NextResponse } from 'next/server'
import { requireRoleApi } from '@/lib/session'
import { deleteMaterial, insertMaterial, markMaterialReady, materialById } from '@/lib/db'
import { MATERIAL_BUCKET, deleteObject, objectIsReadable, signedObjectUrl, signedUploadUrl } from '@/lib/storage'

/**
 * SOURCE MATERIAL — the stuff a cut gets made from. Four verbs, admin only, on one path, the same
 * shape as /api/admin/video next door.
 *
 *   GET    ?id=  → 302 to a freshly signed URL for one file
 *   POST         → a link (saved outright) or a file row + a one-shot upload URL
 *   PATCH        → having read the bytes back, mark the file ready
 *   DELETE       → remove the row, then the object
 *
 * ⚠️ IT ACCEPTS ANY FORMAT, ON PURPOSE. `/api/admin/video` whitelists four extensions because a
 * reviewer has to press play on the result in a browser. Nobody has to play this: it is a font, a
 * brand deck, a competitor's reel, a spreadsheet of hooks. A whitelist here would be a guess about
 * what somebody will need next, and the ask was explicitly "kuch bhi".
 *
 * ⚠️ THE ONE THING THAT IS STILL CONSTRAINED IS THE OBJECT NAME. Derived here from the title and a
 * random suffix, never sent by the client, and kept inside `[a-z0-9.-]` — an object whose name
 * stepped outside that set once wrote a row into the object store and was afterwards unreachable
 * through every read path there is (docs/security-findings.md #4). The CHECK constraint on the
 * column says the same thing in the database, so a route that got this wrong fails loudly.
 */
export const dynamic = 'force-dynamic'

/** `[a-z0-9-]`, same rule and same reason as the video slug. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** The extension, if the filename has one this side of plausible. No extension is fine — a file
 *  without one is still a file, and refusing it would be a whitelist by the back door. */
function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{1,12})$/i.exec(filename.trim())
  return m ? m[1].toLowerCase() : ''
}

/** ⚠️ `http`/`https` ONLY. A `javascript:` or `data:` URL saved here would be rendered as an
 *  anchor on the admin's own page, which is a stored redirect into whatever the author wanted —
 *  and the author is whoever the admin pasted from. Parsed rather than pattern-matched. */
function normalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 2000) : null
  } catch {
    return null
  }
}

/**
 * ⚠️ A REDIRECT, NOT A JSON BODY, AND THE DIFFERENCE IS WHO NEEDS THE URL. `/api/video-url` hands
 * its URL to a `<video src>`, so the page needs the string. Nothing needs this one but the
 * browser's own address bar, so an `<a href>` pointing here is a plain link that mints its
 * credential at the moment of the click — nothing signed is ever rendered into the HTML, which is
 * the same property the player has, reached a cheaper way.
 */
export async function GET(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const id = new URL(req.url).searchParams.get('id') ?? ''
  const item = id ? await materialById(id) : null
  // A link has no object to sign, and an unfinished upload has no bytes. Both are the same 404 as
  // an id that never existed.
  if (!item || item.kind !== 'file' || !item.storage_path || !item.ready) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const url = await signedObjectUrl(item.storage_path, undefined, MATERIAL_BUCKET)
  // 302 and no-store: the destination is a bearer credential for the object and it dies in minutes.
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; kind?: unknown; url?: unknown; filename?: unknown }
    | null
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const kind = body?.kind === 'link' || body?.kind === 'file' ? body.kind : null
  if (!title) return NextResponse.json({ error: 'no_title' }, { status: 400 })
  if (!kind) return NextResponse.json({ error: 'no_kind' }, { status: 400 })

  if (kind === 'link') {
    const url = typeof body?.url === 'string' ? normalUrl(body.url) : null
    if (!url) return NextResponse.json({ error: 'bad_url' }, { status: 400 })
    // Ready on arrival: there is nothing to upload and nothing to read back.
    const { id } = await insertMaterial({
      title, kind, url, storage_path: null, filename: null, ready: true, added_by: gate.profile.user_id,
    })
    return NextResponse.json({ id })
  }

  const filename = typeof body?.filename === 'string' ? body.filename.trim().slice(0, 260) : ''
  if (!filename) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  const ext = extensionOf(filename)
  /**
   * ⚠️ A RANDOM SUFFIX RATHER THAN A UNIQUE SLUG. Two videos may not share a title, because a
   * video's slug is in a URL a reviewer holds. Two pieces of source material called "Brand colours"
   * is a perfectly ordinary Tuesday, so uniqueness here would be a rule invented to make the
   * storage path easy rather than to describe anything true.
   */
  const storage_path = `${slugify(title) || 'file'}-${crypto.randomUUID().slice(0, 8)}${ext ? `.${ext}` : ''}`

  const { id } = await insertMaterial({
    title, kind, url: null, storage_path, filename, ready: false, added_by: gate.profile.user_id,
  })
  return NextResponse.json(
    { id, storage_path, uploadUrl: await signedUploadUrl(storage_path, MATERIAL_BUCKET) },
    // Permission to write one object. Nothing may cache it.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * "The upload finished."
 *
 * ⚠️ IT DOES NOT BELIEVE THE UPLOADER. `objectIsReadable` signs a URL and fetches one byte through
 * the SAME path a reader will use, not through the API that wrote the file. A write to this
 * project's object store has returned success for an object that could not afterwards be read,
 * listed, signed or deleted (finding #4); marking a row ready on the uploader's word would put an
 * item in the library that dies on the first click.
 */
export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const item = id ? await materialById(id) : null
  if (!item || item.kind !== 'file' || !item.storage_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!(await objectIsReadable(item.storage_path, MATERIAL_BUCKET))) {
    return NextResponse.json({ error: 'not_readable' }, { status: 502 })
  }
  await markMaterialReady(id)
  return NextResponse.json({ ok: true })
}

/**
 * ⚠️ THE ROW GOES FIRST, THE OBJECT SECOND — the same order as a video, for the same reason. The
 * two writes cannot be made atomic across Postgres and the object store, so one of them has to be
 * the one that may fail alone, and they are not equally bad: an object with no row is litter
 * nobody can see, a row whose file has gone is a dead link in a library. A failed object delete is
 * REPORTED rather than swallowed, because the bytes are still being paid for and still exist.
 */
export async function DELETE(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const item = id ? await materialById(id) : null
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await deleteMaterial(id)
  const objectGone = item.storage_path ? await deleteObject(item.storage_path, MATERIAL_BUCKET) : true
  return NextResponse.json({ ok: true, objectGone })
}
