/**
 * Decides whether a broken-state run proved anything.
 *
 * ⚠️ RED IS NOT EVIDENCE ON ITS OWN. If a break stops the code compiling, or throws before the
 * assertion runs, or hangs the dev server, every spec goes red — and "I broke it and watched it go
 * red" then certifies a check that would also go red if you deleted a semicolon. That is the exact
 * mirror of the green-for-the-wrong-reason class this whole discipline exists to catch, and it
 * fails in the direction that produces confidence.
 *
 * So the red has to be attributable: the named spec, failing on its own ASSERTION.
 *
 *   node scripts/break-verdict.mjs <playwright-json-report> <spec expected to go red>
 *
 * exit 0  the named spec failed on an assertion            → the check binds
 * exit 1  the named spec passed                            → the check does not bind
 * exit 4  the named spec failed, but not on an assertion   → red for the wrong reason
 * exit 5  the run never reached the named spec             → nothing was tested
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [reportPath, expectedSpec] = process.argv.slice(2)
if (!reportPath || !expectedSpec) {
  console.error('usage: node scripts/break-verdict.mjs <report.json> <spec expected to go red>')
  process.exit(2)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch {
  // No report at all: playwright died before it could write one (webServer timeout, config error).
  console.error('✗ no JSON report — the run died before any test executed. Nothing was tested.')
  process.exit(5)
}

/** Playwright nests suites per file and per describe; specs can be at any depth. */
function collect(suites, out = []) {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) out.push(spec)
    collect(s.suites, out)
  }
  return out
}

/** Reporter messages carry colour codes; strip them before matching. */
const strip = (s) => String(s ?? '').replace(/\[[0-9;]*m/g, '')

/**
 * Every matcher failure Playwright prints — including a `toBeVisible` timeout and an `expect.poll`
 * — carries the `expect(` call in its message. A thrown TypeError, a module-resolution error and a
 * bare test timeout do not, which is the whole distinction this file exists to draw.
 */
const isAssertion = (msg) => /\bexpect\s*\(|\bexpect\.\w+\(/.test(strip(msg))

const specs = collect(report.suites)
const wanted = specs.filter((s) => basename(s.file) === basename(expectedSpec))

// Top-level errors are compile/config failures: the suite never ran as written.
if (report.errors?.length) {
  console.error(`✗ the run reported ${report.errors.length} top-level error(s) — the break stopped the suite`)
  console.error(`  ${strip(report.errors[0].message).split('\n')[0].slice(0, 200)}`)
  console.error('  Red here says nothing about the check. Narrow the break.')
  process.exit(5)
}

if (!wanted.length) {
  console.error(`✗ ${expectedSpec} never ran — nothing was tested.`)
  process.exit(5)
}

const results = wanted.flatMap((s) =>
  (s.tests ?? []).flatMap((t) => (t.results ?? []).map((r) => ({ title: s.title, r }))),
)
const failed = results.filter(({ r }) => r.status === 'failed' || r.status === 'timedOut')

if (!failed.length) {
  console.error(`✗ ${expectedSpec} PASSED on the broken state. The check does not bind — you have the mechanism wrong.`)
  process.exit(1)
}

const messagesOf = (r) => [r.error?.message, ...(r.errors ?? []).map((e) => e.message)]
const onAssertion = failed.filter(({ r }) => messagesOf(r).some(isAssertion))

// Collateral is worth printing even when the verdict is good: a break that also took down
// unrelated specs is usually broader than the defect it was meant to model.
const others = specs.filter((s) => basename(s.file) !== basename(expectedSpec) && s.ok === false)
if (others.length) {
  const files = [...new Set(others.map((s) => s.file))].join(', ')
  console.error(`  note: ${others.length} test(s) in other specs also went red — ${files}`)
}

if (!onAssertion.length) {
  console.error(`✗ ${expectedSpec} went red, but NOT on an assertion — red for the wrong reason:`)
  for (const { title, r } of failed) {
    console.error(`    ${title}: ${strip(r.error?.message ?? r.status).split('\n')[0].slice(0, 160)}`)
  }
  console.error('  A break that stops the code running turns every spec red and proves nothing. Narrow it.')
  process.exit(4)
}

console.log(`✓ ${expectedSpec} went red on its own assertion${onAssertion.length > 1 ? `s (${onAssertion.length})` : ''}:`)
for (const { title, r } of onAssertion) {
  const line = strip(r.error?.message ?? '')
    .split('\n')
    .find((l) => /expect/.test(l))
  console.log(`    ${title}\n      ${(line ?? '').trim().slice(0, 160)}`)
}
process.exit(0)
