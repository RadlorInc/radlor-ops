import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { allVideos, assignmentsForVideo, reviewerVideoBySlug } from '@/lib/db'
import { clearance } from '@/lib/clearance'
import { currentProfile } from '@/lib/session'
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

/**
 * THE SECOND DOOR: an admin watching a finished cut.
 *
 * ⚠️ IT IS DELIBERATELY NARROWER THAN "admin can sign anything". The admin runs this project and
 * could grant themselves an assignment in a click, so this is not a wall — it is a statement of
 * what the button on the dashboard is for. A draft and a cut still being argued over are not
 * marketing material yet, and the one place that mints a bearer credential for a video object
 * should say which videos it is willing to mint for.
 *
 * ⚠️ CLEARED, NOT `status`. `videos.status` says `reviewed` the moment ONE reviewer presses the
 * button, so keying on it would open a cut that a second reviewer is still objecting to — the
 * exact collapse `clearance()` exists to prevent. Every assigned reviewer approved, or nothing.
 *
 * ⚠️ AND IT RUNS ONLY AFTER THE REVIEWER LOOKUP RETURNS NOTHING, so an admin who is also an
 * assigned reviewer keeps going through the assignment path and can still open their own
 * unfinished work. This widens what an admin can watch; it narrows nothing.
 */
async function clearedVideoForAdmin(slug: string) {
  const profile = await currentProfile()
  if (profile?.role !== 'admin') return null
  // ponytail: scans the full video list rather than a slug query — there are single digits of them
  // and `allVideos()` is already cached under the `videos` tag. A `videos?slug=eq.` lookup is the
  // upgrade if this list ever grows.
  const video = (await allVideos()).find((v) => v.slug === slug)
  if (!video) return null
  return clearance(await assignmentsForVideo(video.id)).cleared ? video : null
}

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

  // Assignment-scoped, so a reviewer cannot sign a URL for a video they were never given. This is the
  // route that hands out a bearer credential for the object itself, so it is the one that matters.
  const video = (await reviewerVideoBySlug(slug, reviewer.id)) ?? (await clearedVideoForAdmin(slug))
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = await signedVideoUrl(video.storage_path)
  return NextResponse.json(
    { url, expires_in: SIGNED_URL_TTL_SECONDS },
    // The URL in this body is a bearer credential for the object. Nothing may cache it.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
