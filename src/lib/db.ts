import 'server-only'

/**
 * Server-only data access, straight over PostgREST with `fetch` — the same shape the Milo repo's
 * `/api/lead` route uses, and for the same reason: it is the whole client this app needs, so there
 * is nothing to import.
 *
 * ⚠️ THIS MODULE HOLDS THE SERVICE ROLE KEY, WHICH BYPASSES RLS. `import 'server-only'` above turns
 * "don't import this from a client component" from a review comment into a build error.
 *
 * ⚠️ EVERY REQUEST CARRIES A PROFILE HEADER. These tables live in the `review` schema of a SHARED
 * project — `public` belongs to the marketing site. PostgREST's default profile is the FIRST
 * exposed schema, which is `public`, so a request without `Accept-Profile` / `Content-Profile`
 * does not read our tables: it looks for `public.reviewers` and 404s. Sending it explicitly is
 * also what stops an unqualified request ever landing in the site's schema by accident.
 *
 * ⚠️ AND IT IS THE ONE PLACE A REVIEWER TOKEN IS EVER PUT IN A URL — `reviewers?token=eq.<token>`.
 * That is why `rest()` below takes a `label` and NEVER puts the request path into an error or a
 * log line. A thrown fetch error that stringifies its own URL is how a token ends up in Vercel's
 * log drain in plain text, and it would look like ordinary error handling in the diff.
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
  return (await res.json()) as T
}

/** The token → reviewer resolution. Revoked and unknown are BOTH `null` — the caller must not be
 *  able to tell them apart, or a 404 vs a 403 confirms the token once existed. */
export async function reviewerByToken(token: string): Promise<Reviewer | null> {
  if (!token || token.length < 8 || token.length > 200) return null
  const rows = await rest<Reviewer[]>(
    'reviewer lookup',
    `reviewers?select=id,name,email,revoked_at&token=eq.${encodeURIComponent(token)}&limit=1`,
  )
  const r = rows[0]
  if (!r || r.revoked_at) return null
  return r
}

export async function videosAwaitingReview(): Promise<Video[]> {
  return rest<Video[]>(
    'awaiting-review list',
    'videos?select=id,slug,title,storage_path,version,status,sort_order&status=eq.awaiting_review&order=sort_order.asc,created_at.asc',
  )
}

/** Reviewer-facing lookup: a video that is NOT awaiting review does not exist as far as they know. */
export async function awaitingVideoBySlug(slug: string): Promise<Video | null> {
  const rows = await rest<Video[]>(
    'video lookup',
    `videos?select=id,slug,title,storage_path,version,status,sort_order&slug=eq.${encodeURIComponent(slug)}&status=eq.awaiting_review&limit=1`,
  )
  return rows[0] ?? null
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

export async function allVideos(): Promise<Video[]> {
  return rest<Video[]>(
    'admin video list',
    'videos?select=id,slug,title,storage_path,version,status,sort_order&order=sort_order.asc,created_at.asc',
  )
}

/** ponytail: fetches every note and groups in JS instead of asking PostgREST to aggregate. The
 *  ceiling is one founder, a handful of videos and a few hundred notes — if this ever pages, swap
 *  it for an embedded `notes(count)` select. Keeping it flat is also what lets the offline test
 *  harness speak plain PostgREST. */
export async function allNotes(): Promise<(Note & { reviewer_id: string })[]> {
  return rest<(Note & { reviewer_id: string })[]>(
    'admin note list',
    'notes?select=id,video_id,reviewer_id,t_seconds,body,video_version,resolved_at,created_at&order=t_seconds.asc,created_at.asc',
  )
}
