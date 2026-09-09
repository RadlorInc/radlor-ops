import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/**
 * THE ADMIN CAN READ THE FEEDBACK, NOT ONLY COUNT IT.
 *
 * Rafi, 2026-09-10: *"as an admin the notes the reviewer left for changes, I can't see them at
 * all."* He was right — the table had an *Unread notes* column and the words themselves existed
 * only in `/admin/export`, a plain-text page behind a small link. Three real notes were in the
 * production database while the dashboard showed nothing but a number.
 *
 * ⚠️ THE NOTE BODIES ARE WRITTEN OUT HERE RATHER THAN IMPORTED FROM `test/seed.sql`. Reading them
 * out of the seed would assert that the fixture equals itself and would pass through any change to
 * what the page renders. The duplication is the mechanism: changing a seeded note takes two edits.
 *
 * ⚠️ AND NOTHING IS CLICKED BEFORE THE FIRST ASSERTION. The complaint was about what the tab shows
 * when it loads, so a test that expanded a disclosure first would pass on the build being
 * complained about. `cta-cut` carries an unread note, which is what makes it open on arrival.
 */

test('the note a reviewer left is on the dashboard, in words, attributed, without a click', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const cta = page.getByTestId('video-notes').filter({ has: page.locator('code', { hasText: 'cta-cut' }) })
  await expect(cta).toContainText('good to go, but the caption needs the hashtag trimmed')
  // The moment it was left, and who left it. A wall of anonymous text is not readable feedback.
  await expect(cta).toContainText('0:07')
  await expect(cta).toContainText('Dana Reviewer')
})

/**
 * ⚠️ `hook-test-b` IS THE ONLY FIXTURE THAT CAN CARRY THIS. It is at v2 with a RESOLVED v1 note and
 * an open v2 one, so it is the one row where "did the page put an old round's note under the
 * current one" is a question with a wrong answer available. Every other video has a single round,
 * where a broken version split and a correct one look identical.
 *
 * ⚠️ IT ASSERTS COUNTS OF NOTHING. `e2e/verdict.spec.ts` adds another v2 note to this video, so any
 * assertion about how many notes are on screen would report which spec ran first.
 */
test('an earlier cut’s notes stay under the earlier cut, and an acted-on note reads as done', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const hook = page.getByTestId('video-notes').filter({ has: page.locator('code', { hasText: 'hook-test-b' }) })
  const v1 = hook.locator('[data-version="1"]')
  const v2 = hook.locator('[data-version="2"]')

  await expect(v1).toContainText('the logo lands too late')
  await expect(v2).toContainText('the text is still small on a phone')
  // The half that matters: the old note must NOT be sitting under the current version.
  await expect(v2).not.toContainText('the logo lands too late')
  await expect(v1).toContainText('an earlier cut')

  /**
   * ⚠️ THE COMPUTED STYLE, NOT THE CLASS NAME. Asserting `class="strike"` would assert that the
   * component still spells it the way the component spells it. `line-through` is what a person
   * looking at the screen can tell apart, and it survives the styling being renamed.
   */
  const resolved = hook.getByTestId('admin-note').filter({ hasText: 'the logo lands too late' }).getByTestId('note-body')
  const open = hook.getByTestId('admin-note').filter({ hasText: 'still small on a phone' }).getByTestId('note-body')
  await expect(resolved).toHaveCSS('text-decoration-line', 'line-through')
  await expect(open).not.toHaveCSS('text-decoration-line', 'line-through')
})

/** A reviewer must not reach this page at all — the notes here are everybody's, and one reviewer
 *  seeing another's is the thing `notes` has been keyed to prevent since the first migration. */
test('a reviewer cannot open the page these notes are on', async ({ page }) => {
  await signIn(page, 'dana')
  expect((await page.goto('/admin?tab=videos'))?.status()).toBe(404)
})
