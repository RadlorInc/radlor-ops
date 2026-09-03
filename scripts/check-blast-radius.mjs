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
import { spawnSync } from 'node:child_process'

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
  let error = null
  let code = null
  if (!res.ok) {
    error = (await res.text()).slice(0, 160)
    try {
      code = JSON.parse(error)?.code ?? null
    } catch {
      /* non-JSON error body: fall through to the raw text */
    }
  }
  const rows = Number((res.headers.get('content-range') ?? '/?').split('/')[1])
  return { status: res.status, ok: res.ok, error, code, rows: Number.isFinite(rows) ? rows : null }
}

/**
 * ⚠️ WRONG ADDRESS AND REFUSED ARE NOT THE SAME FAILURE, AND THIS SCRIPT USED TO CONFLATE THEM.
 * Its failure branch said "someone has changed the key or the grants" for ANY non-ok response — so
 * a renamed or dropped `waitlist` (PGRST205) would have been reported as a permissions finding,
 * and a schema missing from Exposed schemas (PGRST106) as the same. That is the identical
 * ambiguity `check-anon-locked-out.mjs` was rewritten to remove and `check-signed-url-expiry.mjs`
 * had in its `NoSuchKey` handling: an address problem wearing a permission problem's clothes.
 * Swept into all three at once on 2026-08-31, rather than fixing the one that happened to bite.
 */
function explain(r) {
  if (r.code === 'PGRST106') return 'the schema is not in Exposed schemas — WRONG ADDRESS, not a permission change'
  if (r.code === 'PGRST205') return 'no such table — WRONG ADDRESS (renamed, dropped, or never created), not a permission change'
  if (r.code === '42501') return 'permission denied — an ACTUAL privilege change'
  if (r.status === 401 || r.status === 403) return 'rejected credential — check the key, not the grants'
  return `unclassified: ${r.error}`
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
  console.log(`FAIL — our own schema is unreachable: ${explain(ours)}`)
  console.log('       This says nothing about the blast radius; fix the address and run again.')
  process.exit(1)
}
if (!theirs.ok) {
  console.log(`FAIL — \`public.waitlist\` was NOT readable: ${explain(theirs)}`)
  console.log('       ⚠️ Read that reason before celebrating. Only "permission denied" would mean the')
  console.log('       exposure has actually closed and SETUP.md needs updating. A wrong address means')
  console.log('       this script is pointed at the wrong thing and has measured nothing.')
  process.exit(1)
}
console.log('PASS — the exposure matches what SETUP.md records. This is documentation, not protection.')

// ── Trigger 1: the marketing site's table stops being empty ─────────────────────────────────
if (rows && rows > 0) {
  console.log(`\n⚠️  ${rows} waitlist row(s). The decision to share this project was made about an EMPTY table.`)
  console.log('   Per SETUP.md, the separation question reopens now that it holds real people.')
}

// ── Trigger 2: THIS schema starts holding money ─────────────────────────────────────────────
// The original trigger was about the OTHER schema filling up. This one is about ours: the admin
// dashboard holds subscription costs, renewal dates and spend. A forwarded link exposing a draft
// reel is embarrassing; one exposing what Radlor spends and when its subscriptions lapse is
// different in kind — and it now sits in a project whose own public /api/waitlist route holds the
// same service_role key.
const fin = await probe('review', 'subscriptions')
if (fin.ok) {
  console.log(`\n⚠️  review.subscriptions exists and holds ${fin.rows ?? '?'} row(s) — FINANCIAL DATA.`)
  console.log('   Second reopening trigger, per SETUP.md: this schema is no longer only about video')
  console.log('   notes. The same key that reads it is held by radlor-site\'s public waitlist route.')
} else if (fin.code === 'PGRST205') {
  console.log('\n   (review.subscriptions does not exist yet — the financial trigger has not fired.)')
}

// ── Trigger 3: this repo's own visibility ───────────────────────────────────────────────────
/**
 * ⚠️ EVERYTHING ABOVE — the project ref, the table names, which one holds children's age-bands,
 * which public route shares the key — is written down in a repo that CLAIMS to be private. On
 * 2026-09-04 that claim had been false for five days (finding #10) and nothing noticed, because
 * the only place it was ever checked was the sentence asserting it.
 *
 * So it is asked of GitHub here, beside the exposure it is supposed to contain. A standing
 * assertion with no scheduled re-check is a belief, not a control.
 *
 * ⚠️ AND IT FAILS CLOSED. "gh is missing" and "gh is not logged in" must never read as "it is
 * private" — the same shape as check-config.mjs refusing to treat a schema it could not fetch as
 * a passing one.
 */
const REPO = 'RadlorInc/radlor-ops'
const gh = spawnSync('gh', ['repo', 'view', REPO, '--json', 'visibility'], { encoding: 'utf8' })
if (gh.error || gh.status !== 0) {
  console.log(`\nFAIL — could not ask GitHub whether ${REPO} is private.`)
  console.log('       That is NOT the same as "it is private". Install/authenticate gh and re-run:')
  console.log('         gh auth status')
  process.exit(1)
}
const visibility = JSON.parse(gh.stdout).visibility
if (visibility !== 'PRIVATE') {
  console.log(`\nFAIL — ${REPO} is ${visibility}. Everything this script just printed is public, and`)
  console.log('       so is docs/security-findings.md. Finding #10 — the fix is one command:')
  console.log(`         gh repo edit ${REPO} --visibility private`)
  console.log('       ⚠️ And private-again is mitigation, not erasure: the history was already out.')
  process.exit(1)
}
console.log(`\n   (${REPO} is PRIVATE — asked of GitHub, not of CLAUDE.md.)`)
process.exit(0)
