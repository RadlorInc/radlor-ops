/**
 * Evidence for "a signed video URL stops working after it expires" — it signs a real URL with a
 * 2-second life, fetches it (expects a hit), waits past the expiry, and fetches the SAME URL again
 * (expects a failure). It prints both responses; it does not read the config that sets the TTL.
 *
 * Against the fake harness:
 *   SUPABASE_URL=http://127.0.0.1:54329 SUPABASE_SERVICE_ROLE_KEY=x \
 *     node scripts/check-signed-url-expiry.mjs equals-reel-final-v1.webm [bucket]
 *
 * ⚠️ THE BUCKET NAME LIVES HERE AND DRIFTED ONCE ALREADY. It was hardcoded as `videos`; the bucket
 * was renamed `review-videos` when this tool moved into the shared marketing project, and this
 * script was not updated. It had only ever run against the offline stand-in, which accepts any
 * bucket in its URL pattern, so nothing failed until the first live run — and when it did, Supabase
 * answered `NoSuchKey / Object not found`, which reads as "the file is missing" when it means "the
 * bucket is wrong". That is the same ambiguity the anon check was rewritten to remove, sitting
 * unfixed in its sibling. Hence: the bucket is an argument, and a 404 now prints the buckets the
 * project ACTUALLY has, so a wrong address answers itself instead of sending you looking for a file.
 *
 * Against the real project (run this once, after SETUP.md):
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
 *     node scripts/check-signed-url-expiry.mjs <object path in the videos bucket>
 */
const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const path = process.argv[2]
const bucket = process.argv[3] || 'review-videos'
if (!base || !key || !path) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-signed-url-expiry.mjs <storage path> [bucket=review-videos]')
  process.exit(2)
}

const TTL = 2

const signRes = await fetch(`${base}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: TTL }),
})
if (!signRes.ok) {
  const detail = await signRes.text()
  console.error(`sign failed ${signRes.status}: ${detail}`)
  // ⚠️ Turn a guess into an answer. `NoSuchKey` is returned both for a missing object AND for a
  // bucket that does not exist, so print what the project actually has rather than leaving the
  // reader to assume the first.
  if (/NoSuchKey|not_found|404/.test(detail)) {
    const list = await fetch(`${base}/storage/v1/bucket`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (Array.isArray(list)) {
      console.error(`\n  you asked for bucket: ${bucket}`)
      console.error(`  this project has:     ${list.map((b) => `${b.id} (public=${b.public})`).join(', ') || '(no buckets at all)'}`)
      console.error(`  if the bucket is right, the OBJECT is missing — upload it, or pass the correct path.`)
    }
  }
  process.exit(1)
}
const { signedURL } = await signRes.json()
const url = `${base}/storage/v1${signedURL}`
// The URL itself is a bearer credential — print only its shape, never the token.
console.log(`bucket  : ${bucket}`)
console.log(`signed  : ${url.split('?')[0]}?token=<redacted>   (expiresIn=${TTL}s)`)

const before = await fetch(url)
console.log(`t+0s    : HTTP ${before.status} ${before.ok ? 'OK' : await before.text()}`)

await new Promise((r) => setTimeout(r, (TTL + 2) * 1000))

const after = await fetch(url)
const body = after.ok ? '' : ` ${(await after.text()).slice(0, 200)}`
console.log(`t+${TTL + 2}s    : HTTP ${after.status}${body}`)

if (before.ok && !after.ok) {
  console.log('\nPASS — the same URL worked before the expiry and failed after it.')
  process.exit(0)
}
console.log('\nFAIL — expected a hit before the expiry and a failure after it.')
process.exit(1)
