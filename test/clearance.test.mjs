/**
 * The clearing rule, checked without a browser. `node --test test/clearance.test.mjs`
 *
 * If this is wrong, /admin says "cleared to post" over an objection, which is the one failure the
 * multi-reviewer change exists to prevent.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearance, progressLabel } from '../src/lib/clearance.ts'

const a = (reviewer_id, verdict) => ({ video_id: 'v', reviewer_id, verdict })

test('one changes_needed is not cleared, however many approvals sit beside it', () => {
  assert.equal(clearance([a('r1', 'approved'), a('r2', 'approved'), a('r3', 'changes_needed')]).cleared, false)
  assert.equal(clearance([a('r1', 'approved'), a('r2', 'approved'), a('r3', 'approved')]).cleared, true)
})

test('a later approval does not clear a video that still holds an objection', () => {
  // The order rows arrive in must not matter — an objection is not something a subsequent yes undoes.
  const objectionFirst = [a('r1', 'changes_needed'), a('r2', 'approved')]
  assert.equal(clearance(objectionFirst).cleared, false)
  assert.equal(clearance([...objectionFirst].reverse()).cleared, false)
})

test('a part-done review is not cleared, and says how far along it is', () => {
  const c = clearance([a('r1', 'approved'), a('r2', null)])
  assert.equal(c.cleared, false)
  assert.equal(progressLabel(c), '1 of 2 reviewers finished')
})

test('nobody assigned is not everybody approved', () => {
  // `[].every(...)` is true. That is how "cleared to post" lands on a video no human has opened.
  assert.equal(clearance([]).cleared, false)
  assert.equal(progressLabel(clearance([])), 'nobody assigned')
})

test('disagreement is reported as disagreement, not resolved into one label', () => {
  const split = clearance([a('r1', 'approved'), a('r2', 'changes_needed')])
  assert.equal(split.disagreement, true)
  assert.equal(split.approved, 1)
  assert.equal(split.changesNeeded, 1)
  assert.equal(clearance([a('r1', 'approved'), a('r2', 'approved')]).disagreement, false)
  // Not yet answered is not disagreement — it is a review still running.
  assert.equal(clearance([a('r1', 'approved'), a('r2', null)]).disagreement, false)
})
