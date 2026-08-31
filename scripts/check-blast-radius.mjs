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

/**
 * Probes reachability with an explicit profile, the way `src/lib/db.ts` does.
 *
 * ⚠️ `select=id`, NEVER `select=*`, AND THE BODY IS NEVER RETAINED ON SUCCESS.
 * The table this script is pointed at holds email addresses and children's age-bands, and the
 * script's whole reason to exist is to keep running as the project changes — its trigger condition
 * is literally that the table STOPS being empty. The first draft asked for `select=*`. It did not
 * print the row (the success branch prints no body), but it pulled a parent's address into memory
 * and parked it in a variable that the FAILURE branch prints verbatim — one edit away from a leak,
 * with a timer on it.
 *
 * Not fetching is stronger than redacting: you cannot leak what you never asked for. `count=exact`
 * gives the number of rows at stake without a single value crossing the wire, and the reachability
 * verdict is the HTTP status, which needs no data at all.
 */
async function probe(schema, table) {
  const res = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, {
    headers: { ...headers, 'Accept-Profile': schema, Prefer: 'count=exact' },
  })
  // Errors only. A PostgREST error body carries a reason, never a row; a success body is discarded
  // unread rather than trusted to be harmless.
  const error = res.ok ? null : (await res.text()).slice(0, 160)
  const rows = Number((res.headers.get('content-range') ?? '/?').split('/')[1])
  return { status: res.status, ok: res.ok, error, rows: Number.isFinite(rows) ? rows : null }
}

console.log('This tool holds a PROJECT-WIDE key. Confirming the radius SETUP.md records:\n')

// 1. Our own schema — must be reachable, or the tool is broken rather than safe.
const ours = await probe('review', 'videos')
console.log(`review.videos      → HTTP ${ours.status} ${ours.ok ? 'readable ✔ (expected — this is our schema)' : `UNREACHABLE ${ours.error}`}`)

// 2. The marketing site's table — must ALSO be reachable. That is the cost of sharing.
//    Shape only: the verdict is the status, and the stake is the row COUNT. No values, ever.
const theirs = await probe('public', 'waitlist')
console.log(`public.waitlist    → HTTP ${theirs.status} ${theirs.ok ? 'readable ⚠️ (expected — THIS IS THE BLAST RADIUS)' : `refused ${theirs.error}`}`)

// 3. How much is actually at stake right now. The decision to share was made about an EMPTY
//    table; SETUP.md says the question reopens when it fills up. Printing the number makes that
//    reopening a fact rather than something someone has to remember.
const rows = theirs.ok ? theirs.rows : null
if (theirs.ok) {
  console.log(`public.waitlist    → ${rows ?? '?'} row(s) reachable from this tool — each an email address and a child's age-band (values deliberately not fetched)`)
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
