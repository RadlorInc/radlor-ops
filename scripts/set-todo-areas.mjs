/**
 * ONE-TIME backfill of `review.todos.area` for the 25 rows imported from the sheet on 2026-09-01.
 * The sheet only labelled two of them (`Marketing`); the rest arrived `null`.
 *
 * ⚠️ THREE OF THESE ARE GUESSES, AND THEY ARE MARKED AS SUCH BELOW AND IN THE OUTPUT. `Business
 * Case Validation`, `Brush-up Adaptive Learning Portal` and `My Cloud` are task names only their
 * author can decode. They were held back from an earlier pass for exactly that reason, and are
 * written here only because Rafi asked for a call rather than another question. A guess stored
 * without its label becomes a fact by the next session, which is the failure this comment exists
 * to prevent — if one is wrong, correct it in /admin, and it is one word.
 *
 * ⚠️ IT WRITES ONLY WHERE `area IS NULL`. A row somebody has since labelled by hand is left alone
 * and reported as skipped, so re-running this cannot quietly revert a human edit with a snapshot
 * of what a script thought in September.
 *
 *   node --env-file=.env.local scripts/set-todo-areas.mjs [--commit]
 */

/** task text (verbatim, typos included — it is the join key) → area. `?` = a guess, see above. */
const AREAS = [
  ['Website Content',                            'Website'],
  ['Website Images',                             'Website'],
  ['Website SCO',                                'Website'],
  ['Design Logo',                                'Marketing'],
  ['Marketing content Creation (Videos)',        'Marketing'],
  ['Marketing Partner',                          'Marketing'],
  ['Facebook Account Setup',                     'Social'],
  ['Instagram',                                  'Social'],
  ['Tiktok',                                     'Social'],
  ['LinkedIn',                                   'Social'],
  ['COPPA Disclaimer',                           'Legal'],
  ['Terms & Conditions Of usage',                'Legal'],
  ['Payment Terms & Conditions',                 'Legal'],
  ['Partnership Agreement',                      'Legal'],
  ['Content Testing',                            'Testing'],
  ['Performance Testing',                        'Testing'],
  ['Update all subscriptions',                   'Ops'],
  ['Virtual Machine Setup',                      'Ops'],
  ['Stripe Setup',                               'Ops'],
  ['Need to register 1800 number for supporet',  'Ops'],
  ['My Cloud',                                   'Ops',     '?'],
  ['Brush-up Adaptive Learning Portal',          'Product', '?'],
  ['Business Case Validation',                   'Product', '?'],
]

const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const commit = process.argv.includes('--commit')
if (!base || !key) {
  console.error('usage: node --env-file=.env.local scripts/set-todo-areas.mjs [--commit]')
  process.exit(2)
}
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'review', 'Content-Profile': 'review' }

const before = await (await fetch(`${base}/rest/v1/todos?select=id,task,area`, { headers: H })).json()
if (!Array.isArray(before)) {
  console.error('could not read review.todos:', JSON.stringify(before).slice(0, 200))
  process.exit(1)
}

// The task text is the join key, so a row this script cannot find is a row it would silently skip.
const known = new Set(before.map(r => r.task))
const missing = AREAS.filter(([task]) => !known.has(task)).map(([task]) => task)
const unlisted = before.filter(r => r.area === null && !AREAS.some(([task]) => task === r.task))
if (missing.length) {
  console.error(`✗ ${missing.length} task(s) in this script do not exist in review.todos:`)
  for (const t of missing) console.error(`    ${JSON.stringify(t)}`)
  console.error('  The task text was edited, or this is the wrong database. Not writing a partial pass.')
  process.exit(1)
}

for (const [task, area, guess] of AREAS) {
  const row = before.find(r => r.task === task)
  const state = row.area === null ? `→ ${area}` : `keeps "${row.area}", skipped`
  console.log(`  ${guess ? '?' : ' '} ${task.padEnd(42)} ${state}`)
}
if (unlisted.length) console.log(`\n  ${unlisted.length} row(s) with no area and no entry here: ${unlisted.map(r => r.task).join(', ')}`)
console.log(`\n  ⚠️ the 3 rows marked "?" are GUESSES at what the task means, not something Rafi said.`)

if (!commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.')
  process.exit(0)
}

let wrote = 0
for (const [task, area] of AREAS) {
  const q = `task=eq.${encodeURIComponent(task)}&area=is.null`
  const res = await fetch(`${base}/rest/v1/todos?${q}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ area }) })
  if (!res.ok) {
    console.error(`\n✗ ${task}: PATCH failed ${res.status}: ${(await res.text()).slice(0, 200)}`)
    process.exit(1)
  }
  wrote += (await res.json()).length
}

// ⚠️ Verified by reading back, not by what the PATCHes returned.
const after = await (await fetch(`${base}/rest/v1/todos?select=task,area`, { headers: H })).json()
const wrong = AREAS.filter(([task, area]) => after.find(r => r.task === task)?.area !== area)
const nulls = after.filter(r => r.area === null)
console.log(`\npatched ${wrote} row(s); read back ${after.length} row(s), ${nulls.length} still without an area`)
if (wrong.length) {
  console.error('FAIL — read back an area this script did not intend:')
  for (const [task, area] of wrong) console.error(`    ${task}: wanted ${area}, got ${JSON.stringify(after.find(r => r.task === task)?.area)}`)
  process.exit(1)
}
console.log('PASS — every task named here carries the area named here.')
