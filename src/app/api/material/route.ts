import { NextResponse } from 'next/server'
import { requireRoleApi } from '@/lib/session'
import { deleteMaterial, insertMaterial, markMaterialReady, materialById, type Subject } from '@/lib/db'
import { MATERIAL_BUCKET, deleteObject, objectIsReadable, signedObjectUrl, signedUploadUrl } from '@/lib/storage'

/**
 * SOURCE MATERIAL — the stuff a cut gets made from. Four verbs on one path, for TEACHERS AND ADMINS.
 *
 * ⚠️ IT LIVED AT `/api/admin/material` UNTIL 2026-09-11, AND MOVED BECAUSE THE PATH BECAME A LIE.
 * The `teacher` role exists to reach this and nothing else, so a teacher's browser posting to a
 * path under `/api/admin/` would have been a name a later reader has to distrust — and in this repo
 * the next person to read a route's path is often working out who can call it. Same argument as the
 * second bucket not being called `review-videos`.
 *
 * ⚠️ A TEACHER HAS EVERY POWER HERE AN ADMIN HAS, INCLUDING REMOVE. That was the ask — "whoever has
 * the teacher role has source material access" — and inventing an own-items-only rule would have
 * been a guess about something nobody said. It means a teacher can remove an admin's upload. If that
 * should change, it is a check on `added_by` in DELETE below, and nowhere else.
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

/**
 * The name an item shows under when nobody typed one: the filename without its extension, with the
 * separators people actually use turned back into spaces. `Q3_hook_teardown.mp4` → `Q3 hook teardown`.
 *
 * ⚠️ IT LIVES ON THE SERVER, THOUGH THE CLIENT COULD HAVE DONE IT. Uploading a whole selection at
 * once means most items are never titled by hand, so this stopped being a convenience and became
 * the naming rule for the library — and a rule with one definition cannot drift between the form
 * and anything else that posts here later. A name that reduces to nothing (`.gitignore`) keeps the
 * filename whole rather than becoming an item called "".
 */
function titleFromFilename(filename: string): string {
  const ext = extensionOf(filename)
  const stem = ext ? filename.slice(0, -(ext.length + 1)) : filename
  return (stem.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || filename.trim()).slice(0, 200)
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
  const gate = await requireRoleApi('teacher', 'admin')
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
  const gate = await requireRoleApi('teacher', 'admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; subject?: unknown; kind?: unknown; url?: unknown; filename?: unknown }
    | null
  const typed = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const kind = body?.kind === 'link' || body?.kind === 'file' ? body.kind : null
  // ⚠️ WHITELISTED HERE, NOT FORWARDED. The CHECK constraint would catch a bad value, but a route
  // that passes through whatever it is handed relies on the database to be its input validation.
  const subject: Subject | null = body?.subject === 'science' || body?.subject === 'maths' ? body.subject : null
  if (!kind) return NextResponse.json({ error: 'no_kind' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'no_subject' }, { status: 400 })

  if (kind === 'link') {
    // ⚠️ A LINK STILL HAS TO BE NAMED BY A PERSON. There is nothing to fall back to — a URL is not
    // a name, and a library of raw addresses is a library nobody reads.
    if (!typed) return NextResponse.json({ error: 'no_title' }, { status: 400 })
    const url = typeof body?.url === 'string' ? normalUrl(body.url) : null
    if (!url) return NextResponse.json({ error: 'bad_url' }, { status: 400 })
    // Ready on arrival: there is nothing to upload and nothing to read back.
    const { id } = await insertMaterial({
      title: typed, subject, kind, url, storage_path: null, filename: null, ready: true, added_by: gate.profile.user_id,
    })
    return NextResponse.json({ id })
  }

  const filename = typeof body?.filename === 'string' ? body.filename.trim().slice(0, 260) : ''
  if (!filename) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  /**
   * ⚠️ A FILE MAY ARRIVE WITH NO TITLE, AND THAT IS WHAT MAKES UPLOADING A WHOLE SELECTION WORK.
   * One file still takes the name the admin typed, if they typed one; twenty cannot, because there
   * is one box and twenty files. Rather than inventing "Deck (1)", "Deck (2)" — names that describe
   * the upload rather than the thing — each file keeps its own.
   */
  const title = typed || titleFromFilename(filename)
  if (!title) return NextResponse.json({ error: 'no_title' }, { status: 400 })
  const ext = extensionOf(filename)
  /**
   * ⚠️ A RANDOM SUFFIX RATHER THAN A UNIQUE SLUG. Two videos may not share a title, because a
   * video's slug is in a URL a reviewer holds. Two pieces of source material called "Brand colours"
   * is a perfectly ordinary Tuesday, so uniqueness here would be a rule invented to make the
   * storage path easy rather than to describe anything true.
   */
  const storage_path = `${slugify(title) || 'file'}-${crypto.randomUUID().slice(0, 8)}${ext ? `.${ext}` : ''}`

  const { id } = await insertMaterial({
    title, subject, kind, url: null, storage_path, filename, ready: false, added_by: gate.profile.user_id,
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
  const gate = await requireRoleApi('teacher', 'admin')
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
  const gate = await requireRoleApi('teacher', 'admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const item = id ? await materialById(id) : null
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await deleteMaterial(id)
  const objectGone = item.storage_path ? await deleteObject(item.storage_path, MATERIAL_BUCKET) : true
  return NextResponse.json({ ok: true, objectGone })
}
