/**
 * ONE-TIME import of the `do list for MVP` Google Sheet into `review.todos`.
 *
 * ⚠️ ONCE. AFTER THIS THE DASHBOARD IS THE SOURCE OF TRUTH AND THE SHEET IS ARCHIVE, NOT A COPY
 * THAT IS KEPT UP TO DATE. There is deliberately no sync back to Sheets: two places to edit the
 * same list is how you end up with neither being right, and nobody notices until a decision gets
 * made off the stale one. If sync is ever asked for, say this again before building it.
 *
 * The rows are written out here rather than fetched at run time, on purpose: it makes the import
 * reviewable in a diff, and it is a record of exactly what the sheet said on 2026-09-01 rather than
 * whatever it says the next time anyone runs this.
 *
 * ⚠️ VERBATIM, INCLUDING THE TYPOS. `Website SCO` is almost certainly SEO and `supporet` is
 * certainly support — both are imported as written and flagged separately. Silently fixing
 * someone's data teaches them that the tool edits what they wrote, which is a worse property than
 * a typo.
 *
 * Re-runnable: it refuses to import if `review.todos` already has rows.
 *
 *   node --env-file=.env.local scripts/import-todo-sheet.mjs [--commit]
 */

/** `Sheet1` — Go-Live Task, Status. Row order IS the priority order and becomes `sort_order`. */
const SHEET1 = [
  ['Design Logo', 'In Progress'],
  ['Website Content', 'In Progress'],
  ['Website Images', 'Not Started'],
  ['Website SCO', 'In Progress'],
  ['Update all subscriptions', 'Not Started'],
  ['Virtual Machine Setup', 'Not Started'],
  ['Marketing content Creation (Videos)', 'Not Started'],
  ['Facebook Account Setup', 'In Progress'],
  ['Instagram', 'In Progress'],
  ['Tiktok', 'In Progress'],
  ['LinkedIn', 'In Progress'],
  ['Stripe Setup', 'Not Started'],
  ['COPPA Disclaimer', 'In Progress'],
  ['Terms & Conditions Of usage', 'In Progress'],
  ['Payment Terms & Conditions', 'In Progress'],
  ['Partnership Agreement', 'In Progress'],
  ['Content Testing', 'In Progress'],
  ['Performance Testing', 'In Progress'],
  ['Business Case Validation', 'In Progress'],
  ['Brush-up Adaptive Learning Portal', 'Not Started'],
  ['My Cloud', 'Not Started'],
  ['Marketing Partner', 'Not Started'],
  ['Need to register 1800 number for supporet', 'Not Started'],
]

/**
 * The `Marketing` tab: one unlabelled column, no header, NO STATUS. Folded in as an `area` field
 * rather than kept as a second tab — marketing work already existed in Sheet1 WITH a status
 * (`Marketing content Creation (Videos)`, `Marketing Partner`), so the same idea was recorded two
 * different ways. Having no status, these arrive as `not_started`.
 */
const MARKETING = ['organise Events', 'contact Homeschooling']

const STATUS = { 'In Progress': 'in_progress', 'Not Started': 'not_started' }

const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const commit = process.argv.includes('--commit')
if (!base || !key) {
  console.error('usage: node --env-file=.env.local scripts/import-todo-sheet.mjs [--commit]')
  process.exit(2)
}
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'review', 'Content-Profile': 'review' }

const existing = await (await fetch(`${base}/rest/v1/todos?select=id`, { headers: H })).json()
if (!Array.isArray(existing)) {
  console.error('could not read review.todos:', JSON.stringify(existing).slice(0, 200))
  process.exit(1)
}
if (existing.length > 0) {
  console.error(`✗ review.todos already has ${existing.length} row(s). This import runs ONCE.`)
  console.error('  The dashboard is the source of truth now; re-importing would overwrite edits')
  console.error('  made since, with a snapshot of a sheet nobody maintains.')
  process.exit(1)
}

const rows = [
  ...SHEET1.map(([task, status], i) => ({ task, status: STATUS[status], area: null, sort_order: i })),
  ...MARKETING.map((task, i) => ({ task, status: 'not_started', area: 'Marketing', sort_order: SHEET1.length + i })),
]

console.log(`${rows.length} row(s) to import — ${SHEET1.length} from Sheet1, ${MARKETING.length} from the Marketing tab\n`)
const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})
console.log(`  status: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  ⚠️ imported verbatim, flagged not fixed: "Website SCO" (SEO?), "supporet" (support?)\n`)

if (!commit) {
  console.log('DRY RUN. Nothing written. Re-run with --commit.')
  process.exit(0)
}

const res = await fetch(`${base}/rest/v1/todos`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows) })
if (!res.ok) {
  console.error(`insert failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const written = await res.json()

// ⚠️ Verified by reading back, not by the insert's response.
const after = await (await fetch(`${base}/rest/v1/todos?select=id,status&order=sort_order.asc`, { headers: H })).json()
console.log(`inserted ${written.length}, read back ${after.length}`)
console.log(after.length === rows.length ? '\nPASS — the sheet is now archive. Do not edit it; edit /admin.' : '\nFAIL — row count does not match.')
process.exit(after.length === rows.length ? 0 : 1)
