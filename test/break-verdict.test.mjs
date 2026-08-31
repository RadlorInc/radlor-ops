/**
 * The verdict logic is the thing that decides whether a broken-state run counts as evidence, so it
 * gets its own check. Two of its four outcomes — "red, but not on an assertion" and "never reached
 * the spec" — are awkward to produce from a real run precisely BECAUSE the specs in this repo put
 * their assertions first, so they are driven here from crafted reports instead. The other two are
 * exercised for real by `scripts/break-check.sh`.
 *
 *   node --test test/break-verdict.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'break-verdict-'))

/** Runs the verdict against a report and returns its exit code. */
function verdict(report, spec = 'e2e/thing.spec.ts') {
  const path = join(dir, `${Math.abs(JSON.stringify(report).length)}-${spec.replace(/\W/g, '')}.json`)
  writeFileSync(path, JSON.stringify(report))
  try {
    execFileSync('node', ['scripts/break-verdict.mjs', path, spec], { stdio: 'pipe' })
    return 0
  } catch (e) {
    return e.status
  }
}

const spec = (results) => ({
  suites: [{ specs: [{ file: 'thing.spec.ts', title: 'a test', ok: !results.some((r) => r.status !== 'passed'), tests: [{ results }] }] }],
})

test('an assertion failure in the named spec is the only thing that counts as proof', () => {
  assert.equal(verdict(spec([{ status: 'failed', error: { message: 'Error: expect(received).toBe(expected)' } }])), 0)
})

test('a matcher TIMEOUT is still an assertion — toBeVisible carries its expect() into the message', () => {
  assert.equal(verdict(spec([{ status: 'timedOut', error: { message: 'expect(locator).toBeVisible() failed\nTimeout: 15000ms' } }])), 0)
})

test('a spec that passed on the broken state means the check does not bind', () => {
  assert.equal(verdict(spec([{ status: 'passed' }])), 1)
})

test('red from a thrown error is NOT proof — this is the semicolon case', () => {
  assert.equal(verdict(spec([{ status: 'failed', error: { message: "TypeError: Cannot read properties of null (reading 'width')" } }])), 4)
})

test('red from a bare test timeout is NOT proof either', () => {
  assert.equal(verdict(spec([{ status: 'timedOut', error: { message: 'Test timeout of 60000ms exceeded.' } }])), 4)
})

test('a compile or config error means nothing was tested', () => {
  assert.equal(verdict({ suites: [], errors: [{ message: 'Error: Cannot find module ./gone' }] }), 5)
})

test('a run that never reached the named spec means nothing was tested', () => {
  assert.equal(verdict(spec([{ status: 'failed', error: { message: 'expect(x).toBe(y)' } }]), 'e2e/other.spec.ts'), 5)
})
