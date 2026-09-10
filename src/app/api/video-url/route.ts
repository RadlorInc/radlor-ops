import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { reviewerVideoBySlug } from '@/lib/db'
import { SIGNED_URL_TTL_SECONDS, signedObjectUrl } from '@/lib/storage'

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

/**
 * ⚠️ THE ADMIN'S "CLEARED CUTS ONLY" DOOR IS GONE, on purpose. It existed because visibility was
 * scoped by assignment and the admin needed a way to watch a finished cut they were not on. Since
 * 2026-09-09 every reviewer and the admin can open every published cut — a draft is still nothing,
 * for everyone — so one lookup answers both, and there is no second rule to keep in step.
 */

export async function GET(req: Request) {
  if (overLimit(callerKey(req, 'videourl'), IP_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const q = new URL(req.url).searchParams
  const slug = q.get('slug') ?? ''
  const reviewer = await reviewerIdentity()
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`videourl:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // Any published cut, for anyone the role gate let in. A draft is a 404. This is the route that
  // hands out a bearer credential for the object itself, so `reviewerIdentity()` above is the wall.
  const video = await reviewerVideoBySlug(slug)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = await signedObjectUrl(video.storage_path)
  return NextResponse.json(
    { url, expires_in: SIGNED_URL_TTL_SECONDS },
    // The URL in this body is a bearer credential for the object. Nothing may cache it.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
