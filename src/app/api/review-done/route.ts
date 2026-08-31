import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerByToken, reviewerVideoBySlug, setOutcome } from '@/lib/db'

/**
 * "I'm finished with this one, and here's what I think." Moves the video to `reviewed` and
 * records the reviewer's VERDICT — approved, or changes needed. Status is where the video sits;
 * verdict is what they concluded. The route will not accept anything else for either.
 *
 * The reviewer's token authorises this and nothing else: the route resolves the token server-side,
 * looks the video up through the same reviewer-visible filter as the page, and can only write the
 * `status` column — the grant is column-level, so even a bug here cannot repoint `storage_path`.
 * There is no video id in the request; the browser names a slug it can already see.
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
  const token = typeof raw.token === 'string' ? raw.token : ''
  const slug = typeof raw.slug === 'string' ? raw.slug : ''
  // Whitelisted, not passed through: the CHECK constraint would catch a bad value, but a route
  // that forwards whatever it is given relies on the database to be its input validation.
  const verdict = raw.verdict === 'approved' || raw.verdict === 'changes_needed' ? raw.verdict : null

  const reviewer = await reviewerByToken(token)
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`done:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  if (!verdict) return NextResponse.json({ error: 'bad_verdict' }, { status: 400 })

  const video = await reviewerVideoBySlug(slug)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Idempotent, and re-pressable: changing your mind from approved to changes-needed is a normal
  // thing to do and must not require a note in between.
  await setOutcome(video.id, 'reviewed', verdict)

  return NextResponse.json({ status: 'reviewed', verdict })
}
