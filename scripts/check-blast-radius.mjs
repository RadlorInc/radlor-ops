/**
 * ⚠️⚠️ THIS IS A DOCUMENTATION TEST, NOT A BOUNDARY. IT PROTECTS NOTHING.
 *
 * It exists because this tool shares a Supabase project with the marketing site, and its server
 * routes hold that project's `service_role` key — which is per-PROJECT and bypasses RLS. So a
 * compromise of this tool reads and writes EVERY table in `radlor-site`, `public.waitlist`
 * included. That is a known, accepted cost, written down in SETUP.md.
 *
 * What this script does is assert that the written radius is STILL TRUE. It deliberately tries to
 * read the marketing site's table with this tool's own key and **expects to succeed** — a failure
 * here means the documented exposure has changed and the docs are now lying in one direction or
 * the other. It is the opposite of a security check: green means "yes, we really are this
 * exposed, exactly as recorded".
 *
 * ⚠️ DO NOT READ A PASS AS PROTECTION, and do not let this file's existence stand in for the
 * boundary it is not. The real separation — a dedicated Postgres role over a direct connection,
 * plus a storage-only S3 key — was costed at 5–7 hours and deliberately not built, because
 * radlor-site's own public `/api/waitlist` route already holds the same key over the same table.
 * Hardening this door while that one stands open would be a receipt, not a boundary.
 *
 * Run it against the real project after setup:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
 *     node scripts/check-blast-radius.mjs
 */
const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-blast-radius.mjs')
  process.exit(2)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

/** Reads with an explicit profile, the way `src/lib/db.ts` does. */
async function read(schema, table) {
  const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, 'Accept-Profile': schema },
  })
  return { status: res.status, ok: res.ok, body: (await res.text()).slice(0, 160) }
}

console.log('This tool holds a PROJECT-WIDE key. Confirming the radius SETUP.md records:\n')

// 1. Our own schema — must be reachable, or the tool is broken rather than safe.
const ours = await read('review', 'videos')
console.log(`review.videos      → HTTP ${ours.status} ${ours.ok ? 'readable ✔ (expected — this is our schema)' : `UNREACHABLE ${ours.body}`}`)

// 2. The marketing site's table — must ALSO be reachable. That is the cost of sharing.
const theirs = await read('public', 'waitlist')
console.log(`public.waitlist    → HTTP ${theirs.status} ${theirs.ok ? 'readable ⚠️ (expected — THIS IS THE BLAST RADIUS)' : `refused ${theirs.body}`}`)

// 3. How much is actually at stake right now. The decision to share was made about an EMPTY
//    table; SETUP.md says the question reopens when it fills up. This prints the number so that
//    reopening is triggered by a fact rather than by someone remembering.
let rows = null
if (theirs.ok) {
  const res = await fetch(`${base}/rest/v1/waitlist?select=id`, {
    headers: { ...headers, 'Accept-Profile': 'public', Prefer: 'count=exact', Range: '0-0' },
  })
  rows = Number((res.headers.get('content-range') ?? '/0').split('/')[1])
  console.log(`public.waitlist    → ${rows} row(s) of real emails and child age-bands reachable from this tool`)
}

console.log()
if (!ours.ok) {
  console.log('FAIL — our own schema is unreachable. Check API Settings → Exposed schemas includes `review`.')
  process.exit(1)
}
if (!theirs.ok) {
  console.log('FAIL — `public.waitlist` was NOT readable. Good news, but SETUP.md says it is: the docs')
  console.log('       are now wrong, and someone has changed the key or the grants. Update the radius.')
  process.exit(1)
}
console.log('PASS — the exposure matches what SETUP.md records. This is documentation, not protection.')
if (rows && rows > 0) {
  console.log(`\n⚠️  ${rows} waitlist row(s). The decision to share this project was made about an EMPTY table.`)
  console.log('   Per SETUP.md, the separation question reopens now that it holds real people.')
}
process.exit(0)
