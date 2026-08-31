/**
 * Evidence for "a signed video URL stops working after it expires" — it signs a real URL with a
 * 2-second life, fetches it (expects a hit), waits past the expiry, and fetches the SAME URL again
 * (expects a failure). It prints both responses; it does not read the config that sets the TTL.
 *
 * Against the fake harness:
 *   SUPABASE_URL=http://127.0.0.1:54329 SUPABASE_SERVICE_ROLE_KEY=x \
 *     node scripts/check-signed-url-expiry.mjs equals-reel-final-v1.webm
 *
 * Against the real project (run this once, after SETUP.md):
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
 *     node scripts/check-signed-url-expiry.mjs <object path in the videos bucket>
 */
const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const path = process.argv[2]
if (!base || !key || !path) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-signed-url-expiry.mjs <storage path>')
  process.exit(2)
}

const TTL = 2

const signRes = await fetch(`${base}/storage/v1/object/sign/videos/${encodeURI(path)}`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: TTL }),
})
if (!signRes.ok) {
  console.error(`sign failed ${signRes.status}: ${await signRes.text()}`)
  process.exit(1)
}
const { signedURL } = await signRes.json()
const url = `${base}/storage/v1${signedURL}`
// The URL itself is a bearer credential — print only its shape, never the token.
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
