import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireRoleApi } from '@/lib/session'
import { TAGS, allVideos, assignReviewers, insertVideo, publishVideo, slugTaken } from '@/lib/db'
import { signedUploadUrl, videoIsReadable } from '@/lib/storage'

/**
 * PUTTING A CUT IN FRONT OF REVIEWERS, IN TWO CALLS WITH THE UPLOAD BETWEEN THEM.
 *
 *   POST  → make the `draft` row and hand back a one-shot URL for the browser to PUT the file to
 *   PATCH → having read the object back, move the row to `awaiting_review`
 *
 * ⚠️ TWO CALLS BECAUSE THE FILE MUST NOT COME THROUGH HERE. A serverless function's request body
 * cap is a few megabytes and a cut is tens; the browser sends the bytes straight to Supabase with
 * a URL this route minted. Nothing but permission passes through this app.
 *
 * ⚠️ AND THE ORDER IS ROW-FIRST ON PURPOSE. An upload that dies half way then leaves a `draft` —
 * the one status reviewers cannot see — which the admin can find and replace. Uploading first and
 * inserting after would leave the opposite: bytes in a bucket that nothing in the database knows
 * about, and no screen anywhere that shows them.
 *
 * ⚠️ THE SERVER NAMES THE PATH, THE CLIENT NEVER DOES. `slug` is derived from the title and
 * scrubbed to [a-z0-9-]; the upload token is scoped to exactly that path, so a caller cannot aim
 * their upload at an existing cut's object — but only because the path is not theirs to send.
 */
export const dynamic = 'force-dynamic'

/** ⚠️ `[a-z0-9-]` AND NOTHING ELSE, and this is not tidiness. An object whose name stepped outside
 *  that set wrote an 82 KB row into `storage.objects` and was then unreachable through every read
 *  path there is — see docs/security-findings.md #4. The slug is the object name. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** The container formats a browser will actually play back. `mov` is here because it is what a
 *  phone hands you, and refusing it means the admin transcodes before they can even try. */
const EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v'])

export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; filename?: unknown; reviewers?: unknown }
    | null
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const reviewers = Array.isArray(body?.reviewers) ? body.reviewers.filter((r): r is string => typeof r === 'string') : []

  if (!title) return NextResponse.json({ error: 'no_title' }, { status: 400 })

  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (!EXTENSIONS.has(ext)) return NextResponse.json({ error: 'bad_format', ext }, { status: 400 })

  const slug = slugify(title)
  // ⚠️ A TITLE OF PURE PUNCTUATION SLUGIFIES TO NOTHING, and an empty slug is an empty URL segment
  // and an object called `-v1.mp4`. Named rather than allowed through as a mystery 500.
  if (!slug) return NextResponse.json({ error: 'no_slug' }, { status: 400 })
  if (await slugTaken(slug)) return NextResponse.json({ error: 'slug_taken', slug }, { status: 409 })

  // Last in the list. `sort_order` is the admin's ordering, and a new cut has not been placed yet.
  const videos = await allVideos()
  const sort_order = videos.reduce((m, v) => Math.max(m, v.sort_order), -1) + 1

  const storage_path = `${slug}-v1.${ext}`
  const { id } = await insertVideo({ slug, title, storage_path, sort_order })
  if (reviewers.length > 0) await assignReviewers(id, reviewers)

  revalidateTag(TAGS.videos, { expire: 0 })
  revalidateTag(TAGS.assignments, { expire: 0 })

  return NextResponse.json(
    { id, slug, storage_path, uploadUrl: await signedUploadUrl(storage_path) },
    // The URL in this body is permission to write one object. Nothing may cache it.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * "The upload finished — let the reviewers see it."
 *
 * ⚠️ IT DOES NOT TAKE THE CLIENT'S WORD FOR THAT. `videoIsReadable` signs a URL and fetches it,
 * which is the reviewer's own read path and NOT the API that wrote the bytes. A storage write to
 * this very bucket has returned success for an object that could not afterwards be read, listed,
 * signed or deleted (finding #4); a publish that trusted the uploader's 200 would have moved that
 * into somebody's queue and the first to notice would have been the reviewer.
 */
export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { id?: unknown; storage_path?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const storagePath = typeof body?.storage_path === 'string' ? body.storage_path : ''
  if (!id || !storagePath) return NextResponse.json({ error: 'no_id' }, { status: 400 })

  if (!(await videoIsReadable(storagePath))) {
    return NextResponse.json({ error: 'not_readable' }, { status: 502 })
  }

  await publishVideo(id)
  revalidateTag(TAGS.videos, { expire: 0 })
  return NextResponse.json({ ok: true })
}
