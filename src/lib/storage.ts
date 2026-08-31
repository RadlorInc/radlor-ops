import 'server-only'

/**
 * Short-lived signed URLs for a PRIVATE bucket. There is deliberately no permanent link anywhere:
 * the bucket has no public access and no storage policy, so the only way to a byte of video is a
 * URL this function minted seconds ago.
 */

/** Must match the bucket created in SETUP.md. Not an env var: a typo'd bucket name should fail
 *  loudly on the first play, not silently point at a bucket that does not exist. */
export const VIDEO_BUCKET = 'videos'

/** Five minutes. Long enough to watch a 60-second vertical cut twice and to scrub back; short
 *  enough that a URL pasted into a chat is dead by the time anyone opens it. The player asks for a
 *  fresh one on every page load, so raising this buys nothing. */
export const SIGNED_URL_TTL_SECONDS = 300

export async function signedVideoUrl(storagePath: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

  const res = await fetch(`${url}/storage/v1/object/sign/${VIDEO_BUCKET}/${encodeURI(storagePath)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: ttl }),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`sign failed ${res.status}: ${detail}`)
  }
  // Supabase returns a path relative to /storage/v1, e.g. `/object/sign/videos/x.mp4?token=…`.
  const { signedURL } = (await res.json()) as { signedURL: string }
  return `${url}/storage/v1${signedURL}`
}
