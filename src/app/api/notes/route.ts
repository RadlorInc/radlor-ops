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
import { TAGS, insertNote, myAssignment, reviewerVideoBySlug, setOutcome } from '@/lib/db'

/**
 * Create one timestamped note.
 *
 * The caller is resolved from their SESSION, server-side. It is
 * never a filter the browser gets to choose — the browser cannot name a `reviewer_id` at all, so
 * there is no shape of request that writes a note as somebody else.
 */
export const dynamic = 'force-dynamic'

/** Per-IP, ahead of the identity lookup. This is the only limit that applies to a caller who is
 *  not signed in at all, so it
 *  is what makes guessing at links expensive rather than free. Generous enough that a real
 *  reviewer typing fast never sees it. */
const IP_LIMIT = 60
/** Per-reviewer, after the lookup, keyed on the resolved user_id. Ten notes a
 *  minute is roughly one every six seconds, which is faster than anyone watches. */
const TOKEN_LIMIT = 10
const WINDOW_MS = 60_000

export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'notes'), IP_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const slug = typeof raw.slug === 'string' ? raw.slug : ''
  const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, 4000) : ''
  const t = typeof raw.t_seconds === 'number' ? Math.round(raw.t_seconds) : NaN

  // The session says who is asking. There is no other way in.
  const reviewer = await reviewerIdentity()
  // 404, not 401/403 — same answer for unknown, revoked and malformed.
  if (!reviewer) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (overLimit(`notes:reviewer:${reviewer.id}`, TOKEN_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  if (!body) return NextResponse.json({ error: 'empty_body' }, { status: 400 })
  if (!Number.isFinite(t) || t < 0 || t > 86_400) {
    return NextResponse.json({ error: 'bad_timestamp' }, { status: 400 })
  }

  const video = await reviewerVideoBySlug(slug, reviewer.id)
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // The version is stamped from the video row HERE, not sent by the client: it is what tells v1
  // notes from v2 notes once this video is re-cut.
  const note = await insertNote({
    video_id: video.id,
    reviewer_id: reviewer.id,
    t_seconds: t,
    body,
    video_version: video.version,
  })

  // ⚠️ A NOTE AFTER "DONE" REOPENS THE REVIEW AND CLEARS THE VERDICT. Otherwise Rafi is told a
  // review is complete — or worse, APPROVED — while the reviewer is still adding to it. A verdict
  // that survives new feedback is a lie about what the reviewer currently thinks, and "approved"
  // sitting above a note that contradicts it is the shape that gets something posted. The client
  // is told, so the page can say what happened rather than changing underneath them.
  // ⚠️ THEIR OWN VERDICT, AND ONLY THEIRS. A note is this reviewer changing their mind, not a
  // reason to reopen anybody else's finished review — and emphatically not a way for a note to
  // clear somebody else's `changes_needed`.
  const mine = await myAssignment(video.id, reviewer.id)
  const reopened = mine?.verdict != null
  if (reopened) await setOutcome(video.id, reviewer.id, null)


  /**
   * ⚠️ INVALIDATE WHAT THIS WRITE ACTUALLY CHANGED, BY NAME. `/admin` and the markdown export read
   * these four lists through a cache; without this, a note or a verdict would sit invisible behind
   * it for up to the TTL — and "I saved it and the dashboard still says the old thing" is the one
   * failure that makes somebody stop trusting the tool rather than report a bug.
   *
   * Named tags rather than one blanket flush: a note does not change the video list, and throwing
   * it away teaches the cache to be worthless.
   */
  revalidateTag(TAGS.notes, NOW)
  // `setOutcome` moves the reviewer's verdict AND the video's derived status, so both when reopened.
  if (reopened) {
    revalidateTag(TAGS.assignments, NOW)
    revalidateTag(TAGS.videos, NOW)
  }

  return NextResponse.json(
    { note: { id: note.id, t_seconds: note.t_seconds, body: note.body }, reopened },
    { status: 201 },
  )
}
