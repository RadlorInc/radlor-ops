/**
 * The urgency logic, checked without a browser. `node --test test/renewal.test.mjs`
 *
 * The point of the costs table is answering "what lapses next"; if this is wrong, the table is
 * decoration with dates in it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysUntil, freshness, renewalLabel, renewalState } from '../src/lib/renewal.ts'

const TODAY = new Date('2026-09-01T12:00:00Z')

test('a date seven days out does not look like one three months out', () => {
  assert.equal(renewalState('2026-09-08', TODAY), 'soon')
  assert.equal(renewalState('2026-12-01', TODAY), 'ok')
  assert.notEqual(renewalState('2026-09-08', TODAY), renewalState('2026-12-01', TODAY))
})

test('the boundaries are where they claim to be', () => {
  assert.equal(renewalState('2026-08-31', TODAY), 'lapsed')
  assert.equal(renewalState('2026-09-01', TODAY), 'soon')   // today still needs paying
  assert.equal(renewalState('2026-09-08', TODAY), 'soon')   // 7 days
  assert.equal(renewalState('2026-09-09', TODAY), 'upcoming')
  assert.equal(renewalState('2026-10-01', TODAY), 'upcoming') // 30 days
  assert.equal(renewalState('2026-10-02', TODAY), 'ok')
  assert.equal(renewalState(null, TODAY), 'none')
})

test('the time of day cannot move the answer by a day', () => {
  for (const h of ['00:00:01', '12:00:00', '23:59:59']) {
    assert.equal(daysUntil('2026-09-08', new Date(`2026-09-01T${h}Z`)), 7, h)
  }
})

test('labels read like a human wrote them', () => {
  assert.equal(renewalLabel('2026-09-01', TODAY), 'today')
  assert.equal(renewalLabel('2026-09-02', TODAY), 'tomorrow')
  assert.equal(renewalLabel('2026-08-29', TODAY), 'lapsed 3d ago')
  assert.equal(renewalLabel(null, TODAY), '—')
})

test('a typed number is never described as refreshed', () => {
  assert.match(freshness('2026-08-29T10:00:00Z', 'manual', TODAY), /you typed this/)
  assert.match(freshness('2026-08-29T10:00:00Z', 'api', TODAY), /refreshed/)
  assert.match(freshness(TODAY.toISOString(), 'manual', TODAY), /today/)
})
