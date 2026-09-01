import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerByToken, reviewerVideoBySlug } from '@/lib/db'
import { SIGNED_URL_TTL_SECONDS, signedVideoUrl } from '@/lib/storage'

/**
 * Mint a short-lived signed URL for one private-bucket object.
 *
 * There is no permanent link anywhere in this app: the bucket is private with no storage policy,
 * this route is the only thing that can sign, and what it hands out is dead in
 * SIGNED_URL_TTL_SECONDS. Reloading the page is how you get another one.
 */
export const dynamic = 'force-dynamic'

const IP_LIMIT = 60
const TOKEN_LIMIT = 30
const WINDOW_MS = 60_000

export async function GET(req: Request) {
  if (overLimit(callerKey(req, 'videourl'), IP_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const q = new URL(req.url).searchParams
  const reviewer = await reviewerByToken(q.get('token') ?? '')
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`videourl:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // Assignment-scoped, so a token cannot sign a URL for a video it was never given. This is the
  // route that hands out a bearer credential for the object itself, so it is the one that matters.
  const video = await reviewerVideoBySlug(q.get('slug') ?? '', reviewer.id)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = await signedVideoUrl(video.storage_path)
  return NextResponse.json(
    { url, expires_in: SIGNED_URL_TTL_SECONDS },
    // The URL in this body is a bearer credential for the object. Nothing may cache it.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
