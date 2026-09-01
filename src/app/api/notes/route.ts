import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { insertNote, myAssignment, reviewerByToken, reviewerVideoBySlug, setOutcome } from '@/lib/db'

/**
 * Create one timestamped note.
 *
 * The token arrives in the BODY and is resolved here, server-side, against the service role. It is
 * never a filter the browser gets to choose — the browser cannot name a `reviewer_id` at all, so
 * there is no shape of request that writes a note as somebody else.
 */
export const dynamic = 'force-dynamic'

/** Per-IP, ahead of the token lookup. This is the only limit that applies to a WRONG token, so it
 *  is what makes guessing at links expensive rather than free. Generous enough that a real
 *  reviewer typing fast never sees it. */
const IP_LIMIT = 60
/** Per-reviewer, after the lookup — the "rate limited per token" the spec asks for, keyed on the
 *  resolved id so the token itself is never used as a map key or an error string. Ten notes a
 *  minute is roughly one every six seconds, which is faster than anyone watches. */
const TOKEN_LIMIT = 10
const WINDOW_MS = 60_000

export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'notes'), IP_LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const token = typeof raw.token === 'string' ? raw.token : ''
  const slug = typeof raw.slug === 'string' ? raw.slug : ''
  const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, 4000) : ''
  const t = typeof raw.t_seconds === 'number' ? Math.round(raw.t_seconds) : NaN

  const reviewer = await reviewerByToken(token)
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

  return NextResponse.json(
    { note: { id: note.id, t_seconds: note.t_seconds, body: note.body }, reopened },
    { status: 201 },
  )
}
