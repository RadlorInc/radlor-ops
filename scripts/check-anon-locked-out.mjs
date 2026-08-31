/**
 * Run this ONCE against the real Supabase project, after the migration is applied and `review` is
 * in Exposed schemas. Until it passes, the security posture of this tool is UNVERIFIED — the
 * offline harness runs the migration's `enable row level security` in real Postgres, but only real
 * PostgREST enforces it against the `anon` role.
 *
 * ⚠️ IT ASSERTS THE DENIAL, NOT THE ABSENCE OF DATA — because four different things produce the
 * same "no rows came back", and only one of them is security:
 *
 *   1. anon is genuinely denied            → 403 + Postgres SQLSTATE `42501`   ← the only pass
 *   2. `review` is not in Exposed schemas  → 404 + `PGRST106`
 *   3. the table does not exist            → 404 + `PGRST205`
 *   4. the grant was restored, RLS holding → 200 + `[]`
 *
 * The first version of this script accepted "not ok, or ok-and-empty" as a pass, which is 1, 2, 3
 * AND 4 — so it would have reported a clean bill of health against a project where the migration
 * had never been applied at all. An unconfigured database is the most comfortable pass there is.
 *
 * ⚠️ AND IT RUNS A POSITIVE CONTROL FIRST. The identical request, same profile header, with the
 * SERVICE key, which must SUCCEED. Without it, a passing anon check still cannot tell denial from
 * misconfiguration: it proves the address is right, so that the credential is the only variable
 * left. If the control fails, the anon result is not reported at all — it would mean nothing.
 *
 * Case 4 is not a leak and is reported as its own failure rather than a pass: RLS alone is holding,
 * the migration's `revoke` has been undone, and one accidental policy would open the table.
 *
 * ⚠️ AND IT NEVER FETCHES A ROW VALUE. See `probe()` — if `anon` really can read `reviewers`, the
 * rows are working credentials. The count header says whether any came back, which is all the
 * verdict needs.
 *
 *   SUPABASE_URL=https://ghuvnqbthbcmqfxcrjrh.supabase.co \
 *   SUPABASE_ANON_KEY=<the publishable/anon key> \
 *   SUPABASE_SERVICE_ROLE_KEY=<service key, for the control> \
 *     node scripts/check-anon-locked-out.mjs
 */
const base = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !anon || !service) {
  console.error(
    'usage: SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-anon-locked-out.mjs',
  )
  console.error('  (the service key is the POSITIVE CONTROL — without it this script cannot tell denial from a typo)')
  process.exit(2)
}

const TABLES = ['reviewers', 'videos', 'notes']

/**
 * The identical request in both roles. `Accept-Profile: review` because these tables live in the
 * `review` schema of a project shared with the marketing site — asking without it resolves against
 * the default profile, `public`, where they do not exist, and a 404 there means "wrong address",
 * not "denied".
 *
 * ⚠️ `select=id`, NEVER `select=*`. If `anon` really can read `reviewers`, the rows coming back are
 * REVIEWER TOKENS — working credentials — and this script's job is to report that, not to hold
 * them. An earlier version fetched every column and withheld the values when printing; that is a
 * decision which has to keep being made correctly on every future branch, and one of them will get
 * it wrong. Not fetching is a property instead of a habit: you cannot leak what you never asked
 * for. The leak verdict needs to know rows CAME BACK, not what is in them, and `count=exact`
 * answers that in a header.
 *
 * The error body IS read when the request fails — that is where PostgREST puts the SQLSTATE this
 * whole script turns on, and an error body carries a reason, never a row.
 */
async function probe(table, key) {
  const res = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'review', Prefer: 'count=exact' },
  })
  let code = null
  let text = ''
  if (!res.ok) {
    text = (await res.text()).slice(0, 200)
    try {
      code = JSON.parse(text)?.code ?? null
    } catch {
      /* non-JSON error body: fall through to the raw text in the report */
    }
  }
  const rows = Number((res.headers.get('content-range') ?? '/?').split('/')[1])
  return { status: res.status, ok: res.ok, code, text, rows: Number.isFinite(rows) ? rows : null }
}

// ── The control ────────────────────────────────────────────────────────────────────────────────
// Runs first and gates everything else. A green anon result against an address that answers
// nothing for anybody is not evidence.
console.log('POSITIVE CONTROL — same request, same profile header, service key. Must succeed.\n')
let controlFailed = false
for (const t of TABLES) {
  const r = await probe(t, service)
  console.log(`  review.${t.padEnd(10)} service_role → HTTP ${r.status} ${r.ok ? `reachable ✔ ${r.rows ?? '?'} row(s)` : `✗ ${r.code ?? ''} ${r.text}`}`)
  if (!r.ok) controlFailed = true
}

if (controlFailed) {
  console.log('\nFAIL — the control did not pass, so nothing below would mean anything.')
  console.log('  PGRST106 → add `review` to Settings → API → Exposed schemas (last in the list).')
  console.log('  PGRST205 → the migration has not been applied; paste it into the SQL editor.')
  console.log('  401/403  → wrong service key.')
  console.log('\nThe anon check was NOT run. Fix the address first — a denial you cannot distinguish')
  console.log('from a typo is not a check.')
  process.exit(1)
}

// ── The check ──────────────────────────────────────────────────────────────────────────────────
console.log('\nANON — identical request with the PUBLIC key. Must be refused with SQLSTATE 42501.\n')
const verdicts = []
for (const t of TABLES) {
  const r = await probe(t, anon)
  let verdict
  if (r.code === '42501') verdict = { ok: true, note: 'permission denied ✔' }
  else if (r.code === 'PGRST106') verdict = { ok: false, note: '✗ schema not exposed — MISCONFIGURATION, not denial' }
  else if (r.code === 'PGRST205') verdict = { ok: false, note: '✗ table not found — WRONG ADDRESS, not denial' }
  else if (r.ok && r.rows) verdict = { ok: false, note: `✗✗ LEAKED — ${r.rows} row(s) readable by anon (values deliberately not fetched)` }
  else if (r.ok)
    // Reached, not refused. Whether nothing is visible because RLS is holding or because the table
    // happens to be empty, the GRANT is back and the denial this script asserts is gone.
    verdict = { ok: false, note: '✗ 200 — readable, no rows visible. The GRANT is back; only RLS or an empty table is in the way' }
  else verdict = { ok: false, note: `✗ refused, but not with 42501: ${r.code ?? r.text}` }

  console.log(`  review.${t.padEnd(10)} anon         → HTTP ${r.status} ${r.code ?? ''} ${verdict.note}`)
  verdicts.push(verdict.ok)
}

const bad = verdicts.filter((v) => !v).length
if (bad === 0) {
  console.log('\nPASS — the address is proven reachable by the control, and anon is denied at it.')
  console.log('       A stranger with the public key cannot enumerate reviewer tokens.')
  process.exit(0)
}
console.log(`\nFAIL — ${bad} of ${TABLES.length} table(s) did not answer with a permission denial.`)
console.log('       Read the lines above before treating any of them as safe: three of the four')
console.log('       failure shapes look exactly like security from the outside.')
process.exit(1)
