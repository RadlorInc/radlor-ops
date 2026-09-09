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
  /**
   * ⚠️ AN EMPTY BODY IS NOT A 204-ONLY CASE, AND ASSUMING IT WAS WOULD HAVE SHIPPED BROKEN.
   * A PATCH with `Prefer: return=minimal` answers 204; a POST with the same header answers **201
   * with Content-Length: 0**, and `res.json()` throws `Unexpected end of JSON input` on that. The
   * offline harness answered `null` — valid JSON — so every minimal insert passed here and would
   * have failed in production. Read the text and decide on its emptiness, which is the property
   * that actually matters.
   */
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
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
 * ⚠️ VISIBILITY IS BY ROLE AGAIN, AND THIS TIME SOMEBODY DECIDED IT. Finding #7 recorded that any
 * valid TOKEN once opened any reviewable video, and nobody had chosen that. On 2026-09-09 Rafi
 * chose it, for accounts: every reviewer and the admin see every published cut and may leave notes
 * on it. The token is gone, so "who is holding it" is answered by the session, and the thing the
 * assignment used to gate — seeing the video — is now gated by `requireRole` on the page.
 *
 * What the assignment STILL gates is the verdict. One `video_reviewers` row per video names the
 * one person who approves or rejects it; everyone else is there for feedback. `/api/review-done`
 * refuses anyone without a row, and `clearance()` reads that row alone.
 */
export async function assignmentsFor(reviewerId: string): Promise<Assignment[]> {
  return rest<Assignment[]>(
    'reviewer assignments',
    `video_reviewers?select=video_id,reviewer_id,verdict&reviewer_id=eq.${reviewerId}`,
  )
}

/** Every published cut, each saying whether THIS person is the one who decides it, and what they
 *  decided. `decides` is the assignment row existing; `myVerdict` is null for everyone else. */
export async function videosForReviewer(
  reviewerId: string,
): Promise<(Video & { decides: boolean; myVerdict: Verdict })[]> {
  const [mine, videos] = await Promise.all([
    assignmentsFor(reviewerId),
    rest<Video[]>('reviewer video list', `videos?select=${VIDEO_COLS}&${REVIEWER_VISIBLE}&order=sort_order.asc,created_at.asc`),
  ])
  const byId = new Map(mine.map((a) => [a.video_id, a.verdict]))
  return videos.map((v) => ({ ...v, decides: byId.has(v.id), myVerdict: byId.get(v.id) ?? null }))
}

/**
 * Reviewer-facing lookup: a draft or a cut being revised does not exist as far as they know —
 * both are the same 404. Who may look is decided before this is called (`requireRole` on the
 * page, `reviewerIdentity()` in the routes); who may DECIDE is `myAssignment()`, asked separately
 * by the one route that writes a verdict.
 */
export async function reviewerVideoBySlug(slug: string): Promise<Video | null> {
  const rows = await rest<Video[]>(
    'video lookup',
    `videos?select=${VIDEO_COLS}&slug=eq.${encodeURIComponent(slug)}&${REVIEWER_VISIBLE}&limit=1`,
  )
  return rows[0] ?? null
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
 * A NEW CUT, AS A DRAFT. Written before a single byte has been uploaded, on purpose.
 *
 * ⚠️ `draft` IS THE POINT, NOT A PLACEHOLDER. The row has to exist before the upload so the
 * storage path has something to belong to and the admin can see the attempt at all — and `draft`
 * is the one status reviewers cannot see (`REVIEWER_VISIBLE`), so an upload that fails half way
 * leaves a row only the admin looks at rather than a video in somebody's queue with no file behind
 * it. `publishVideo` is what moves it, and only after the object has been read back.
 */
export async function insertVideo(v: {
  slug: string
  title: string
  storage_path: string
  sort_order: number
}): Promise<{ id: string }> {
  const rows = await rest<{ id: string }[]>('video insert', 'videos', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...v, version: 1, status: 'draft' }),
  })
  return rows[0]
}

/**
 * Who decides. Since 2026-09-09 the upload route sends exactly ONE id here — the approver — and
 * refuses more; everyone else with a reviewer account sees the cut without a row. The function
 * still takes a list because the table does, and a second row is what `clearance()` would treat
 * as a second approval required.
 *
 * ⚠️ IT DOES NOT SEND `verdict`, AND THAT IS LOAD-BEARING RATHER THAN TIDY. The grant this call
 * runs under is COLUMN-LEVEL — `insert (video_id, reviewer_id)` — so naming `verdict` at all, even
 * as `null`, is refused by Postgres with `42501`. The column is nullable with no default, so an
 * assignment lands as "not finished" on its own. See 20260909100000: the web tier can ask somebody
 * to review a cut and can never write what they concluded.
 */
export function assignReviewers(videoId: string, reviewerIds: string[]): Promise<null> {
  return rest<null>('assignment insert', 'video_reviewers', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(reviewerIds.map((reviewer_id) => ({ video_id: videoId, reviewer_id }))),
  })
}

/** Draft → out for review. The only status write outside `setOutcome`, and it is the admin's. */
export function publishVideo(videoId: string): Promise<null> {
  return rest<null>('video publish', `videos?id=eq.${videoId}&status=eq.draft`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'awaiting_review' }),
  })
}

/**
 * REMOVE A CUT ENTIRELY. The notes and the verdicts go with it, by cascade.
 *
 * ⚠️ THAT CASCADE IS THE WHOLE WEIGHT OF THIS FUNCTION AND IT IS NOT VISIBLE HERE. One statement
 * against `videos` also destroys every row in `notes` and `video_reviewers` that pointed at it —
 * other people's timestamped feedback, and their conclusions. The interface has to say so before
 * it calls this; nothing downstream can put it back.
 *
 * ⚠️ AND `service_role` COULD NOT DO THIS UNTIL 20260908120000. Every other table in this schema
 * arrives with `select, insert` from a default privilege and nothing more, so the DELETE that was
 * never written read as a denial and was not one — it was an omission that would have surfaced as
 * `42501` in production and nowhere in the offline suite.
 */
export function deleteVideo(videoId: string): Promise<null> {
  return rest<null>('video delete', `videos?id=eq.${videoId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  })
}

/** ⚠️ A SLUG IS IN A URL AND IN AN OBJECT NAME, so a second one is not a cosmetic clash. */
export async function slugTaken(slug: string): Promise<boolean> {
  const rows = await rest<{ id: string }[]>('slug check', `videos?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`)
  return rows.length > 0
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

/**
 * WHO GETS ASKED ON THE NEXT CUT. The one profile (the route keeps it to one) with `can_approve`.
 * Not cached: the admin flips it and uploads in the same minute, and a stale answer here would put
 * the cut in front of the person they just took it away from.
 */
export function approverIds(): Promise<string[]> {
  return rest<{ user_id: string }[]>('approver lookup', 'profiles?select=user_id&can_approve=eq.true').then((rows) =>
    rows.map((r) => r.user_id),
  )
}

/**
 * MAKE ONE PERSON THE APPROVER, OR MAKE THEM FEEDBACK-ONLY.
 *
 * ⚠️ ONE HOLDER: setting it on clears everyone else first, because that is what "only one person
 * has the authority" means and the alternative is a People list the admin has to police. Two
 * PATCHes, not one transaction — PostgREST has none — so a failure between them leaves NOBODY
 * flagged, which the upload form reports in words rather than silently assigning nobody.
 *
 * ⚠️ IT TOUCHES THE FLAG AND NOTHING ELSE. `update (can_approve)` is the only UPDATE the web tier
 * holds on `profiles`; naming `role` here would be refused with 42501, and that is the point.
 */
export async function setApprover(userId: string, on: boolean): Promise<void> {
  if (on) {
    await rest<null>('approver clear', 'profiles?can_approve=eq.true', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_approve: false }),
    })
  }
  await rest<null>('approver set', `profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ can_approve: on }),
  })
}

export const allVideos = cached(allVideosUncached, TAGS.videos, 'all-videos')
export const allNotes = cached(allNotesUncached, TAGS.notes, 'all-notes')
export const allAssignments = cached(allAssignmentsUncached, TAGS.assignments, 'all-assignments')
export const allReviewers = cached(allReviewersUncached, TAGS.reviewers, 'all-reviewers')

/**
 * Creates the Supabase Auth user from an EMAIL ALONE — no password is set here, and none is ever
 * typed by the admin. The person chooses theirs through their link (`/join/<token>`), so there is
 * nothing to hand over and nothing to leak in a forward.
 *
 * ⚠️ NO EMAIL IS SENT BY ANYONE, which is the whole design (Rafi, 2026-09-03: "meko email nahi
 * bhejna"). The admin API, so the service key; `email_confirm: true` is what stops GoTrue queuing
 * a confirmation mail. Until the link is opened the account has no password at all, so it cannot
 * be signed into — the link is the only door, and it is single use.
 */
export async function createUser(email: string, name: string): Promise<{ id: string }> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    cache: 'no-store',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { name } }),
  })
  if (res.status === 422) throw new Error('exists')
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`create user failed ${res.status}: ${detail}`)
  }
  const u = (await res.json()) as { id?: string }
  if (!u.id) throw new Error('create user returned no id')
  return { id: u.id }
}

/** Sets somebody's password from the server — the second half of every link. */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`set password failed ${res.status}: ${detail}`)
  }
}

/** The role row. Service key: `profiles` is insertable by `service_role` only, on purpose — an
 *  admin's own session cannot hand out roles, only a route running on the server can. */
export function insertProfile(row: {
  user_id: string
  role: 'admin' | 'tester' | 'reviewer'
  name: string
  can_approve?: boolean
}): Promise<null> {
  return rest<null>('profile insert', 'profiles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  })
}

/**
 * ONE PERSON'S LINK TO CHOOSE THEIR PASSWORD. ⚠️ THE TABLE HOLDS A HASH, NEVER THE TOKEN — the
 * raw token lives only in the URL the admin copied, so a dump of this table is not a way in.
 *
 * Single use, and re-issuing is what revoking looks like: `newInviteLink` spends every unused link
 * the person already has before writing the new one, so the line the admin has just copied is the
 * only live one.
 */
export type InviteLink = { id: string; user_id: string; expires_at: string; used_at: string | null }
const LINK_COLS = 'id,user_id,expires_at,used_at'

/** Spends every unused link for one person. See the note above: this IS the revoke. */
function spendUnusedLinks(userId: string): Promise<null> {
  return rest<null>('link supersede', `invite_links?user_id=eq.${userId}&used_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  })
}

export async function newInviteLink(userId: string, tokenHash: string, days: number): Promise<void> {
  await spendUnusedLinks(userId)
  await rest<null>('link insert', 'invite_links', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      token_hash: tokenHash,
      user_id: userId,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    }),
  })
}

/**
 * A link that can still be used, or null. Spent, superseded, expired and unknown are all the same
 * null, so the page can answer all four with the same 404 — a different answer for "expired" tells
 * whoever is holding it that the link was once real.
 */
export async function usableInviteLink(tokenHash: string): Promise<InviteLink | null> {
  const rows = await rest<InviteLink[]>('link lookup', `invite_links?select=${LINK_COLS}&token_hash=eq.${tokenHash}&limit=1`)
  const l = rows[0]
  if (!l || l.used_at || Date.parse(l.expires_at) <= Date.now()) return null
  return l
}

export function spendInviteLink(id: string): Promise<null> {
  return rest<null>('link use', `invite_links?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  })
}

/**
 * Every link's state, newest first — for the *People* list's "not joined yet" chip.
 *
 * ⚠️ SERVICE KEY, BECAUSE THE ADMIN'S OWN TOKEN CANNOT READ THIS TABLE. `invite_links` has RLS on
 * and no policies at all, deliberately, so `adminDb`'s read-as-the-user pattern would return zero
 * rows here and the chip would say "not joined yet" about everybody, for ever. This is the same
 * reason videos and notes go through the service key.
 *
 * ⚠️ AND IT IS NOT CACHED. The `unstable_cache` reads beside it have a 60-second TTL, which is
 * fine for a video list and wrong for this: the admin makes a link and looks straight at the row
 * to check it worked. A minute of the page insisting nothing happened is indistinguishable from
 * the button being broken.
 */
export function inviteLinkStates(): Promise<{ user_id: string; used_at: string | null; expires_at: string }[]> {
  return rest<{ user_id: string; used_at: string | null; expires_at: string }[]>(
    'link states',
    'invite_links?select=user_id,used_at,expires_at&order=created_at.desc',
  )
}

/** The address a link belongs to, so the join page can say whose account it is setting up. */
export async function userEmail(userId: string): Promise<string> {
  const { url, key } = assertConfigured()
  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    cache: 'no-store',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`read user failed ${res.status}`)
  return ((await res.json()) as { email?: string }).email ?? ''
}
