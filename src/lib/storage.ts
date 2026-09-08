import 'server-only'

/**
 * Short-lived signed URLs for a PRIVATE bucket. There is deliberately no permanent link anywhere:
 * the bucket has no public access and no storage policy, so the only way to a byte of video is a
 * URL this function minted seconds ago.
 */

/**
 * Must match the bucket created in SETUP.md. Not an env var: a typo'd bucket name should fail
 * loudly on the first play, not silently point at a bucket that does not exist.
 *
 * ⚠️ ITS OWN NAME, IN A SHARED PROJECT. Not `videos` — this project belongs to the marketing site
 * too, and a generic name is how two tools end up writing into one bucket. Today it is the only
 * bucket in the project; that is not a reason to take the generic name.
 */
export const VIDEO_BUCKET = 'review-videos'

/** Five minutes. Long enough to watch a 60-second vertical cut twice and to scrub back; short
 *  enough that a URL pasted into a chat is dead by the time anyone opens it. The player asks for a
 *  fresh one on every page load, so raising this buys nothing. */
export const SIGNED_URL_TTL_SECONDS = 300

function env() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  return { url, key }
}

export async function signedVideoUrl(storagePath: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const { url, key } = env()

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

/**
 * A one-shot URL the BROWSER can PUT a file to, for one object, in a bucket that has no policy.
 *
 * ⚠️ THE FILE NEVER PASSES THROUGH THIS APP, AND THAT IS NOT AN OPTIMISATION. A route that
 * accepted the upload and forwarded it would have to hold a video in a serverless function whose
 * request body cap is a few megabytes — a 40 MB cut fails there, and fails as a generic 413 that
 * looks like a bug in the form. Supabase takes the bytes directly; this app only ever hands out
 * permission to send them.
 *
 * ⚠️ AND THE PATH IS CHOSEN HERE, NEVER BY THE CLIENT. The token is scoped to exactly the path it
 * was minted for, so a caller cannot redirect their upload over `equals-reel-v1.mp4` by asking
 * nicely — but only because the server, not the form, decides what the path says.
 */
export async function signedUploadUrl(storagePath: string): Promise<string> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${VIDEO_BUCKET}/${encodeURI(storagePath)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`sign upload failed ${res.status}: ${detail}`)
  }
  const { url: signed } = (await res.json()) as { url: string }
  return `${url}/storage/v1${signed}`
}

/**
 * Is the object actually there and readable?
 *
 * ⚠️ IT ASKS THROUGH THE REVIEWER'S OWN PATH — sign, then fetch — NOT through the API that wrote
 * it. On 2026-08-31 an upload to this bucket returned a `Key`, wrote an 82 KB row into
 * `storage.objects`, and was then unreachable through list, GET, sign AND delete. A "did the
 * upload work" check that trusts the upload's own answer would have said yes about that object,
 * and the first person to find out would have been a reviewer looking at a dead player. See
 * docs/security-findings.md #4.
 */
export async function videoIsReadable(storagePath: string): Promise<boolean> {
  try {
    /* ⚠️ ONE BYTE, VIA `Range`, AND THE BODY IS READ RATHER THAN CANCELLED. Two reasons, both
     * found the hard way. A plain GET pulls the whole cut through a route handler to answer a
     * yes/no question — tens of megabytes for one bit of information. And `res.body.cancel()`,
     * the tidy-looking way to avoid that, never settled against the offline harness: the publish
     * step hung with the form still saying "Checking it plays back…" and nothing to see. Asking
     * for a single byte makes the body small enough to just read. */
    const res = await fetch(await signedVideoUrl(storagePath, 60), {
      cache: 'no-store',
      headers: { Range: 'bytes=0-0' },
    })
    await res.arrayBuffer()
    return res.ok
  } catch {
    return false
  }
}

/**
 * Remove one object. Answers whether it is actually gone, and the caller is expected to care.
 *
 * ⚠️ A DELETE THAT REPORTS SUCCESS IS NOT PROOF THE OBJECT LEFT — this bucket has form. On
 * 2026-08-31 an object here survived a delete that returned 200 and stayed unreachable through
 * every other verb too (docs/security-findings.md #4). So the row goes first and this runs after:
 * an object left behind is invisible litter, whereas a row whose file has gone is a reviewer
 * staring at a dead player. Failure is returned rather than thrown so the admin is told which of
 * the two happened.
 */
export async function deleteVideoObject(storagePath: string): Promise<boolean> {
  const { url, key } = env()
  try {
    const res = await fetch(`${url}/storage/v1/object/${VIDEO_BUCKET}/${encodeURI(storagePath)}`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    await res.arrayBuffer()
    return res.ok
  } catch {
    return false
  }
}
