/**
 * Proves at the DATABASE level — not in the UI — that a signed-in tester cannot read rows a policy
 * reserves for admins. Run against the live project; the offline harness cannot see this at all
 * (PGlite has no `auth` schema, no `auth.uid()`, and one superuser with no role switching).
 *
 * ⚠️ ONE CORRECTION TO THE BRIEF, STATED RATHER THAN QUIETLY APPLIED. The brief asked for "the same
 * treatment as check-anon-locked-out.mjs … asserting the SQLSTATE". **This design cannot ever emit
 * `42501` for a tester, so asserting it would assert something that can only fail.** Every
 * signed-in user — admin and tester alike — is the same Postgres role, `authenticated`. The
 * app-level role lives in a COLUMN, not in a database role, so GRANTs cannot tell them apart and
 * RLS is the only mechanism that can. RLS does not refuse a query; it removes rows. The denial
 * shape here is therefore **HTTP 200 with the admin's row absent**.
 *
 * That is a weaker-looking signal and it needs a stronger control, because "no rows" is also what
 * you get from an empty table, a wrong schema, a typo'd filter or a broken address. So:
 *
 *   CONTROL A  the ADMIN reads the same URL and SEES both rows   → the address and filter are right
 *   CONTROL B  the TESTER reads their OWN row and sees it        → the tester's token works at all
 *   THE CHECK  the TESTER reads the same URL as control A and does NOT see the admin's row
 *
 * Without A the check passes against a table nobody can read. Without B it passes against a token
 * that was rejected outright. Both controls must be green before the denial means anything.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… TESTER_EMAIL=… TESTER_PASSWORD=… \
 *     node --env-file=.env.local scripts/check-tester-cannot-read-admin.mjs
 *
 * ⚠️ IT NEEDS TWO ACCOUNTS AND SHOULD NOT USE ANYONE'S REAL PASSWORD. On 2026-09-01 it was run
 * against two throwaway accounts created through the Auth admin API with random passwords, and
 * both were deleted immediately afterwards — verified by re-reading `auth.users` (1 user) and
 * `review.profiles` (1 row), not by trusting the DELETE responses. Do the same next time rather
 * than putting a real password in an env file.
 */
const base = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const who = {
  admin: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  tester: { email: process.env.TESTER_EMAIL, password: process.env.TESTER_PASSWORD },
}
if (!base || !anon || !who.admin.email || !who.admin.password || !who.tester.email || !who.tester.password) {
  console.error(
    'usage: SUPABASE_URL=… SUPABASE_ANON_KEY=… ADMIN_EMAIL=… ADMIN_PASSWORD=… TESTER_EMAIL=… TESTER_PASSWORD=… node scripts/check-tester-cannot-read-admin.mjs',
  )
  process.exit(2)
}

async function signIn(label, { email, password }) {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    // Shape only — never the body, which distinguishes "wrong password" from "no such user".
    console.error(`✗ could not sign in as ${label}: HTTP ${res.status}`)
    process.exit(1)
  }
  const { access_token } = await res.json()
  const me = await (await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${access_token}` } })).json()
  return { token: access_token, id: me.id }
}

/** ⚠️ `select=user_id,role` — never `name`, and never `select=*`. The verdict needs to know WHICH
 *  rows came back, not what is in them. Not fetching is a property; redacting is a habit. */
async function readProfiles(token) {
  const res = await fetch(`${base}/rest/v1/profiles?select=user_id,role&order=role.asc`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Accept-Profile': 'review' },
  })
  const body = res.ok ? await res.json() : null
  const text = res.ok ? '' : (await res.text()).slice(0, 160)
  return { status: res.status, ok: res.ok, rows: body, text }
}

const admin = await signIn('admin', who.admin)
const tester = await signIn('tester', who.tester)
console.log(`signed in: admin=${admin.id.slice(0, 8)}…  tester=${tester.id.slice(0, 8)}…\n`)

// ── CONTROL A ────────────────────────────────────────────────────────────────────────────────
const a = await readProfiles(admin.token)
console.log(`CONTROL A  admin reads profiles      → HTTP ${a.status}  ${a.ok ? `${a.rows.length} row(s)` : a.text}`)
if (!a.ok || a.rows.length < 2) {
  console.log('\nFAIL — the control did not pass, so nothing below would mean anything.')
  console.log('       An admin must be able to see both rows, or "the tester sees fewer" proves')
  console.log('       only that the address is wrong. Check the profile rows exist and that')
  console.log('       `review` is in Exposed schemas.')
  process.exit(1)
}

// ── CONTROL B ────────────────────────────────────────────────────────────────────────────────
const b = await readProfiles(tester.token)
console.log(`CONTROL B  tester reads profiles     → HTTP ${b.status}  ${b.ok ? `${b.rows.length} row(s)` : b.text}`)
if (!b.ok || !b.rows.some((r) => r.user_id === tester.id)) {
  console.log('\nFAIL — the tester could not read even their OWN row, so a zero result below would')
  console.log('       mean "the token was rejected", not "the policy held". Fix that first.')
  process.exit(1)
}

// ── THE CHECK ────────────────────────────────────────────────────────────────────────────────
const sawAdmin = b.rows.some((r) => r.user_id === admin.id)
const sawOnlySelf = b.rows.length === 1 && b.rows[0].user_id === tester.id
console.log(`\nCHECK      tester sees the admin row  → ${sawAdmin ? 'YES ✗✗' : 'no ✔'}`)
console.log(`           tester sees only itself     → ${sawOnlySelf ? 'yes ✔' : 'NO ✗'}`)

if (sawAdmin || !sawOnlySelf) {
  console.log('\nFAIL — a tester can read rows reserved for admins. RLS is not doing the work.')
  process.exit(1)
}
// ── AND THE SAME QUESTION FOR ISSUES ─────────────────────────────────────────────────────────
// `issues_read_own` returns a tester their own rows and an admin everyone's, from the SAME query.
// The offline harness cannot see this at all — PGlite has one superuser and no policies — so this
// is the only place it is checked. The imported sheet rows have `reporter = null`, so they are
// visible to an admin and to nobody else, which makes the difference measurable.
async function readIssues(token) {
  const res = await fetch(`${base}/rest/v1/issues?select=id,reporter`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Accept-Profile': 'review' },
  })
  return res.ok ? await res.json() : null
}

const adminIssues = await readIssues(admin.token)
const testerIssues = await readIssues(tester.token)
console.log(`\nISSUES     admin sees                  → ${adminIssues ? adminIssues.length : 'ERROR'} row(s)`)
console.log(`           tester sees                 → ${testerIssues ? testerIssues.length : 'ERROR'} row(s)`)

if (!adminIssues || !testerIssues) {
  console.log('\nFAIL — could not read issues as one of the two roles.')
  process.exit(1)
}
// The control: an admin must see MORE than nothing, or "the tester sees fewer" is meaningless.
if (adminIssues.length === 0) {
  console.log('\nFAIL — the admin sees no issues at all, so the comparison below proves nothing.')
  console.log('       Import the sheet or file one, then run this again.')
  process.exit(1)
}
const testerSawSomeoneElses = testerIssues.some((i) => i.reporter !== tester.id)
if (testerSawSomeoneElses) {
  console.log("\nFAIL — a tester can read issues they did not file. `issues_read_own` is not holding.")
  process.exit(1)
}
console.log(`           tester saw only its own     → yes ✔`)

console.log('\nPASS — both controls green, the tester is limited to their own rows by policy,')
console.log('       at the database, with a token the database accepted.')
process.exit(0)
