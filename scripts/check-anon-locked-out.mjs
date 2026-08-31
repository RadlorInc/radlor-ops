/**
 * Run this ONCE against the real Supabase project, after the migration is applied.
 *
 * It asks the project's PUBLIC anon key for each of the three tables and expects to be refused
 * every time. This is the check the offline E2E harness cannot make: PGlite runs the migration's
 * `enable row level security`, but only the real PostgREST enforces it against the `anon` role.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<the publishable/anon key> \
 *     node scripts/check-anon-locked-out.mjs
 */
const base = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
if (!base || !anon) {
  console.error('usage: SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/check-anon-locked-out.mjs')
  process.exit(2)
}

let bad = 0
for (const table of ['reviewers', 'videos', 'notes']) {
  const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  })
  const body = (await res.text()).slice(0, 160)
  // A refusal is a 401/403. An EMPTY 200 also means "no rows visible", which is what RLS with no
  // policies produces on a SELECT — that is a pass too, but a 200 with rows is a failure.
  const rows = res.ok ? JSON.parse(body || '[]') : null
  const ok = !res.ok || (Array.isArray(rows) && rows.length === 0)
  if (!ok) bad++
  console.log(`${table.padEnd(10)} anon read → HTTP ${res.status} ${ok ? 'refused/empty ✔' : `LEAKED ${body}`}`)
}

// The one that matters most: a stranger with the public key must not be able to enumerate tokens.
console.log(bad === 0 ? '\nPASS — anon can read nothing.' : `\nFAIL — ${bad} table(s) readable with the public key.`)
process.exit(bad === 0 ? 0 : 1)
