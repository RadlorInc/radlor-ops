import 'server-only'
import { unstable_cache } from 'next/cache'

/**
 * Server-only data access, straight over PostgREST with `fetch` — the same shape the Milo repo's
 * `/api/lead` route uses, and for the same reason: it is the whole client this app needs, so there
 * is nothing to import.
 *
 * ⚠️ THIS MODULE HOLDS THE SERVICE ROLE KEY, WHICH BYPASSES RLS. `import 'server-only'
import { unstable_cache } from 'next/cache'` above turns
 * "don't import this from a client component" from a review comment into a build error.
 *
 * ⚠️ EVERY REQUEST CARRIES A PROFILE HEADER. These tables live in the `review` schema of a SHARED
 * project — `public` belongs to the marketing site. PostgREST's default profile is the FIRST
 * exposed schema, which is `public`, so a request without `Accept-Profile` / `Content-Profile`
 * does not read our tables: it looks for `public.reviewers` and 404s. Sending it explicitly is
 * also what stops an unqualified request ever landing in the site's schema by accident.
 *
 * ⚠️ NO REQUEST FROM THIS MODULE CARRIES A SECRET IN ITS PATH ANY MORE — the reviewer token is
 * gone, and with it the only query that ever put one in a URL. `rest()` still takes a `label` and
 * still never puts the request path into an error or a log line, and that stays: it costs nothing,
 * and the next thing anyone filters on could be an email or an id. The rule was never really about
 * tokens; it is that a fetch error which stringifies its own URL looks exactly like ordinary error
 * handling in the diff.
 */

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** The Postgres schema these three tables live in. Not `public` — see the header. */
export const SCHEMA = 'review'

export type Reviewer = { id: string; name: string; email: string; revoked_at: string | null }
export type Video = {
  id: string
  slug: string
  title: string
  storage_path: string
  version: number
  status: 'draft' | 'awaiting_review' | 'reviewed' | 'revising'
  sort_order: number
}

/**
 * One reviewer's assignment to one video, and their own verdict on it.
 *
 * ⚠️ THE VERDICT LIVES HERE, NOT ON `videos`. `review.videos.verdict` still exists as a stale
 * column that nothing reads or writes — it is dropped in its own migration once the copy has been
 * read back. Do not reintroduce a read of it; the whole point is that "what did the reviewers
 * conclude" has as many answers as there are reviewers.
 */
export type Assignment = { video_id: string; reviewer_id: string; verdict: Verdict }

export type Verdict = 'approved' | 'changes_needed' | null
export type Note = {
  id: string
  video_id: string
  t_seconds: number
  body: string
  video_version: number
  resolved_at: string | null
  created_at: string
}

function assertConfigured(): { url: string; key: string } {
  if (!URL_ || !KEY) throw new Error('supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  return { url: URL_, key: KEY }
}

/** `path` is a PostgREST path+query and MAY CONTAIN A REVIEWER TOKEN. It is never echoed anywhere. */
async function rest<T>(label: string, path: string, init?: RequestInit): Promise<T> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // GET reads a profile from `Accept-Profile`; POST/PATCH/DELETE from `Content-Profile`.
      // Sending both is harmless and means a caller cannot pick the wrong one.
      'Accept-Profile': SCHEMA,
      'Content-Profile': SCHEMA,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    // Body only — PostgREST puts the real reason (grant, RLS, constraint) there, and it contains
    // no token. The path deliberately does not appear.
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`${label} failed ${res.status}: ${detail}`)
  }
  // `Prefer: return=minimal` answers 204 with no body, and `res.json()` throws on empty input.
  if (res.status === 204) return null as T
  return (await res.json()) as T
}

/** The token → reviewer resolution. Revoked and unknown are BOTH `null` — the caller must not be
 *  able to tell them apart, or a 404 vs a 403 confirms the token once existed. */
/**
 * What a reviewer is allowed to see: a video waiting on them, or one they have already marked
 * finished. `draft` and `revising` do not exist as far as they are concerned.
 *
 * ⚠️ `reviewed` IS INCLUDED ON PURPOSE, and it is a deliberate widening of the original
 * "shows only `awaiting_review`" rule. Once a reviewer can finish a review, excluding `reviewed`
 * would make the video vanish from their list the moment they pressed the button — so anyone who
 * thought of one more thing would be locked out by the act of saying they were done. They stay
 * visible, marked finished.
 */
const REVIEWER_VISIBLE = 'status=in.(awaiting_review,reviewed)'

const VIDEO_COLS = 'id,slug,title,storage_path,version,status,sort_order'

/**
 * ⚠️ STATUS IS NOT AN AUTHORIZATION FILTER, AND FOR A LONG TIME IT WAS THE ONLY ONE HERE. Both
 * functions below used to select on `REVIEWER_VISIBLE` alone, so any valid token listed every
 * reviewable video and opened any reviewable slug. Nothing chose that; there was one video, so it
 * never showed. The assignment is the condition now: `assignedTo()` first, and a video not in it
 * does not exist as far as that reviewer is concerned. Finding #7.
 */
export async function assignmentsFor(reviewerId: string): Promise<Assignment[]> {
  return rest<Assignment[]>(
    'reviewer assignments',
    `video_reviewers?select=video_id,reviewer_id,verdict&reviewer_id=eq.${reviewerId}`,
  )
}

/** Carries THEIR verdict, not the video's — "you marked this finished" has to mean *you*, and
 *  `videos.status` is now derived from everyone, so it cannot answer that question. */
export async function videosForReviewer(reviewerId: string): Promise<(Video & { myVerdict: Verdict })[]> {
  const mine = await assignmentsFor(reviewerId)
  if (mine.length === 0) return []
  const videos = await rest<Video[]>(
    'reviewer video list',
    `videos?select=${VIDEO_COLS}&${REVIEWER_VISIBLE}&order=sort_order.asc,created_at.asc`,
  )
  const byId = new Map(mine.map((a) => [a.video_id, a.verdict]))
  return videos.filter((v) => byId.has(v.id)).map((v) => ({ ...v, myVerdict: byId.get(v.id) ?? null }))
}

/**
 * Reviewer-facing lookup: a draft, a cut being revised, OR a video they were never assigned does
 * not exist as far as they know — all three are the same 404, which is the same reason an unknown
 * and a revoked token are.
 */
export async function reviewerVideoBySlug(slug: string, reviewerId: string): Promise<Video | null> {
  const rows = await rest<Video[]>(
    'video lookup',
    `videos?select=${VIDEO_COLS}&slug=eq.${encodeURIComponent(slug)}&${REVIEWER_VISIBLE}&limit=1`,
  )
  const video = rows[0]
  if (!video) return null
  return (await myAssignment(video.id, reviewerId)) ? video : null
}

export async function myAssignment(videoId: string, reviewerId: string): Promise<Assignment | null> {
  const rows = await rest<Assignment[]>(
    'assignment lookup',
    `video_reviewers?select=video_id,reviewer_id,verdict&video_id=eq.${videoId}&reviewer_id=eq.${reviewerId}&limit=1`,
  )
  return rows[0] ?? null
}

/** Every assignment on one video — the admin's per-reviewer view, and the input to `clearance()`. */
export async function assignmentsForVideo(videoId: string): Promise<Assignment[]> {
  return rest<Assignment[]>(
    'video assignments',
    `video_reviewers?select=video_id,reviewer_id,verdict&video_id=eq.${videoId}`,
  )
}

/** ponytail: all assignments in one read, grouped in JS — same call the note list makes, same
 *  ceiling (a founder, a handful of videos), and it keeps the harness speaking plain PostgREST. */
async function allAssignmentsUncached(): Promise<Assignment[]> {
  return rest<Assignment[]>('admin assignment list', 'video_reviewers?select=video_id,reviewer_id,verdict')
}

/**
 * Who an assignment can belong to, by `user_id`.
 *
 * ⚠️ READS `profiles`, NOT `reviewers`. An assignment points at a profile, so the profile is where
 * the name has to come from — reading `reviewers` for it would answer from a table that no longer
 * has any part in deciding anything, and would go blank for a reviewer created the new way (an
 * account, no `reviewers` row). That is what made `review.reviewers` vestigial rather than merely
 * token-free.
 */
async function allReviewersUncached(): Promise<Reviewer[]> {
  const rows = await rest<{ user_id: string; name: string }[]>(
    'admin reviewer list',
    'profiles?select=user_id,name&order=name.asc',
  )
  return rows.map((r) => ({ id: r.user_id, name: r.name, email: '', revoked_at: null }))
}

/**
 * The only write the reviewer can cause besides a note. Two legal moves, both on THEIR OWN row:
 *   • "I'm finished, and here's what I think"  → their verdict
 *   • "…except I just thought of something"    → their verdict CLEARED
 *
 * ⚠️ THE VERDICT IS ALWAYS WRITTEN, INCLUDING AS NULL. A verdict that survives new feedback is a
 * lie about what the reviewer currently thinks, so reopening must clear it rather than leave the
 * old one standing next to a note that contradicts it.
 *
 * ⚠️ AND CLEARING IS PER REVIEWER. One reviewer thinking of something more does not reopen anybody
 * else's finished review, and — the direction that matters — cannot erase somebody else's
 * objection. Nothing in this file can: `changes_needed` is only ever removed by the row's own
 * reviewer, on their own row.
 */
export async function setOutcome(
  videoId: string,
  reviewerId: string,
  verdict: Verdict,
): Promise<void> {
  // ⚠️ ONE REVIEWER'S ROW, NEVER THE VIDEO'S. The filter names both keys because that is the whole
  // change: a PATCH that reached only `video_id` would set every assigned reviewer's verdict to
  // this one's answer — which is precisely the overwrite that moving the column here undid.
  await rest<unknown>('verdict update', `video_reviewers?video_id=eq.${videoId}&reviewer_id=eq.${reviewerId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ verdict }),
  })

  // `status` is the VIDEO's position, so it is derived from all the assignments rather than set by
  // whoever pressed last. Otherwise reviewer B adding a note drags the video back to
  // `awaiting_review` after reviewer A finished, and the table reports on the last click.
  const all = await assignmentsForVideo(videoId)
  const status = all.length > 0 && all.every((a) => a.verdict !== null) ? 'reviewed' : 'awaiting_review'
  await rest<unknown>('video status update', `videos?id=eq.${videoId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  })
}

/** Only this reviewer's notes, and only for the version they are looking at. */
export async function notesFor(videoId: string, reviewerId: string, version: number): Promise<Note[]> {
  return rest<Note[]>(
    'notes list',
    `notes?select=id,video_id,t_seconds,body,video_version,resolved_at,created_at&video_id=eq.${videoId}&reviewer_id=eq.${reviewerId}&video_version=eq.${version}&order=t_seconds.asc,created_at.asc`,
  )
}

export async function insertNote(n: {
  video_id: string
  reviewer_id: string
  t_seconds: number
  body: string
  video_version: number
}): Promise<Note> {
  const rows = await rest<Note[]>('note insert', 'notes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(n),
  })
  return rows[0]
}

/**
 * ⚠️ ONLY THE SERVICE-KEY READS ARE CACHED, AND THE LINE IS NOT A STYLE CHOICE. Everything in this
 * module reads with the service key and takes no user input, so every caller gets the same rows by
 * construction — a cache entry cannot leak across people because there is nothing about a person
 * in it.
 *
 * ⚠️ `src/lib/adminDb.ts` IS DELIBERATELY NOT CACHED. Those reads go through `asUser()` with the
 * caller's own JWT and RLS decides what comes back, so the SAME query returns different rows to
 * different people. A shared cache entry would hand one person another's rows. Keying it per user
 * does not rescue it either: `unstable_cache` puts every argument into the cache key, so the token
 * would become part of a key — and a token in a key is the same family of mistake as a token in a
 * URL, which this file exists to avoid. The honest answer is that those reads stay uncached.
 *
 * ⚠️ AND THE `revalidate` IS NOT A NICETY, IT IS THE ONLY WAY SOME WRITES EVER APPEAR. The app
 * invalidates its own writes by tag. But videos and assignments are added by SQL Rafi runs by hand
 * — by design, there is no UI for either — and a statement typed into the Supabase editor cannot
 * call `revalidateTag`. Without a TTL a video added that way would never show up. Sixty seconds is
 * the longest anyone should wonder whether the tool is broken.
 */
const TTL = 60

function cached<A extends unknown[], T>(fn: (...a: A) => Promise<T>, tag: string, key: string) {
  return unstable_cache(fn, [key], { tags: [tag], revalidate: TTL })
}

export const TAGS = { videos: 'videos', notes: 'notes', assignments: 'assignments', reviewers: 'reviewers' } as const

async function allVideosUncached(): Promise<Video[]> {
  return rest<Video[]>(
    'admin video list',
    `videos?select=${VIDEO_COLS}&order=sort_order.asc,created_at.asc`,
  )
}

/** ponytail: fetches every note and groups in JS instead of asking PostgREST to aggregate. The
 *  ceiling is one founder, a handful of videos and a few hundred notes — if this ever pages, swap
 *  it for an embedded `notes(count)` select. Keeping it flat is also what lets the offline test
 *  harness speak plain PostgREST. */
async function allNotesUncached(): Promise<(Note & { reviewer_id: string })[]> {
  return rest<(Note & { reviewer_id: string })[]>(
    'admin note list',
    'notes?select=id,video_id,reviewer_id,t_seconds,body,video_version,resolved_at,created_at&order=t_seconds.asc,created_at.asc',
  )
}

export const allVideos = cached(allVideosUncached, TAGS.videos, 'all-videos')
export const allNotes = cached(allNotesUncached, TAGS.notes, 'all-notes')
export const allAssignments = cached(allAssignmentsUncached, TAGS.assignments, 'all-assignments')
export const allReviewers = cached(allReviewersUncached, TAGS.reviewers, 'all-reviewers')

/**
 * The `area` and `type` values people have already used, for the filing form's suggestions.
 *
 * ⚠️ THIS DELIBERATELY WIDENS WHAT A TESTER CAN SEE, AND THE WIDENING IS THE POINT. Everywhere else
 * a tester reads issues through `asUser()`, where `issues_read_own` gives them only their own — so
 * their suggestions would be only their own vocabulary, and three people would each converge on
 * their own spelling and never see anyone else's. That is the entire failure this is meant to
 * prevent, so the list is read with the service key across ALL issues.
 *
 * ⚠️ WHAT IT EXPOSES, EXACTLY: the distinct strings in two columns. Not who wrote them, not when,
 * not how many, not the description, not the chapter, not the age band, not an id — the select
 * names two columns and the rest never leaves the database. What a tester learns is the vocabulary
 * other people type into a dropdown, which is what a shared dropdown IS.
 *
 * ⚠️ AND THE APP IS DOING THE AUTHORISING HERE, NOT RLS — the one place in this schema where that
 * is true on purpose. The database-enforced version is a column-level `grant select (area, type)`
 * plus a policy letting `authenticated` see every row of those two columns; that is the upgrade
 * path if this list ever carries anything worth protecting. Today it carries "Nest game".
 *
 * ⚠️ NOT CACHED, ON PURPOSE. A value somebody typed a minute ago has to be in the next person's
 * dropdown or the convergence never happens; it is one more query in a wave that already runs in
 * parallel, so it costs nothing to keep it fresh.
 */
export async function issueVocabulary(): Promise<{ areas: string[]; types: string[] }> {
  const rows = await rest<{ area: string | null; type: string | null }[]>(
    'issue vocabulary',
    'issues?select=area,type',
  )
  const distinct = (pick: (r: (typeof rows)[number]) => string | null) =>
    [...new Set(rows.map(pick).map((v) => v?.trim()).filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  return { areas: distinct((r) => r.area), types: distinct((r) => r.type) }
}
