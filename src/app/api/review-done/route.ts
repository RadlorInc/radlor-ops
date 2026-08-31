import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerByToken, reviewerVideoBySlug, setVideoStatus } from '@/lib/db'

/**
 * "I'm finished with this one." Moves the video to `reviewed`.
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

  const reviewer = await reviewerByToken(token)
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`done:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const video = await reviewerVideoBySlug(slug)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Idempotent: pressing it twice is not an error, and neither is pressing it on a video that is
  // already finished.
  if (video.status !== 'reviewed') await setVideoStatus(video.id, 'reviewed')

  return NextResponse.json({ status: 'reviewed' })
}
