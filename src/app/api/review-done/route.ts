import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

/**
 * ⚠️ `{ expire: 0 }`, NOT THE RECOMMENDED `"max"`. Next's default advice is stale-while-revalidate:
 * the next request is served the OLD data while the refresh runs behind it. That is right for a
 * blog and wrong here — it means a reviewer presses "Needs changes", Rafi loads the dashboard, and
 * it still says approved. Correctness over speed at exactly this point: the next read blocks on
 * the refresh, once, and is right.
 *
 * Everything else keeps the cache: this is a per-tag decision about one write, not a way of
 * turning the cache off.
 */
const NOW = { expire: 0 } as const
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { TAGS, reviewerVideoBySlug, setOutcome } from '@/lib/db'

/**
 * "I'm finished with this one, and here's what I think." Records THIS reviewer's VERDICT —
 * approved, or changes needed. Status is where the video sits; verdict is what they concluded, and
 * with more than one reviewer there is one verdict per person. The route accepts nothing else.
 *
 * ⚠️ It no longer moves the video to `reviewed` itself. `videos.status` is derived from every
 * assignment (see `setOutcome`), so one person finishing does not announce the video as reviewed
 * while somebody else still has it open.
 *
 * The reviewer's SESSION authorises this and nothing else: the route resolves it server-side,
 * looks the video up through the same assignment-scoped filter as the page, and can only write the
 * `verdict` column of THEIR OWN assignment row — the grant is column-level, so even a bug here
 * cannot repoint `storage_path`, and the PATCH filter names both keys so it cannot reach another
 * reviewer's verdict. There is no video id in the request; the browser names a slug it can see.
 */
export const dynamic = 'force-dynamic'

const IP_LIMIT = 60
const TOKEN_LIMIT = 20
const WINDOW_MS = 60_000

export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'done'), IP_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const slug = typeof raw.slug === 'string' ? raw.slug : ''
  // Whitelisted, not passed through: the CHECK constraint would catch a bad value, but a route
  // that forwards whatever it is given relies on the database to be its input validation.
  const verdict = raw.verdict === 'approved' || raw.verdict === 'changes_needed' ? raw.verdict : null

  // The session says who is asking. There is no other way in.
  const reviewer = await reviewerIdentity()
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`done:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  if (!verdict) return NextResponse.json({ error: 'bad_verdict' }, { status: 400 })

  // Scoped by assignment, so a reviewer cannot record a verdict on a video nobody asked them to
  // review — the 404 is the same one a draft gets.
  const video = await reviewerVideoBySlug(slug, reviewer.id)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Idempotent, and re-pressable: changing your mind from approved to changes-needed is a normal
  // thing to do and must not require a note in between. It writes THIS reviewer's row only.
  await setOutcome(video.id, reviewer.id, verdict)

  // Their verdict, and the video's derived status, are both behind the /admin cache. See the note
  // in ../notes/route.ts: a verdict the dashboard cannot see yet is worse than a slow dashboard.
  revalidateTag(TAGS.assignments, NOW)
  revalidateTag(TAGS.videos, NOW)

  // The caller's own verdict, which is the only one it is entitled to know.
  return NextResponse.json({ verdict })
}
