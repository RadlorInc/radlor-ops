import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/**
 * AN ADMIN CAN WATCH ANY PUBLISHED CUT, AND NOT A DRAFT.
 *
 * ⚠️ THIS USED TO SAY "A CLEARED CUT, AND ONLY A CLEARED ONE". On 2026-09-09 Rafi decided the
 * admin and every reviewer see all marketing material; the dashboard's Watch button follows.
 * The fixtures still each answer a different wrong implementation:
 *
 *   • `cta-cut`    — cleared, and the admin is NOT its approver. Assignment-scoped visibility 404s it.
 *   • `split-cut`  — `status = 'reviewed'` and NOT cleared. The old cleared-only door 404s it; the
 *                    new rule opens it. This is the row that tells the two rules apart.
 *   • `quiet-draft`— a draft. Still nothing, for anyone, which is what keeps this a rule rather
 *                    than "admin can sign anything".
 *
 * ⚠️ AND THE VERDICTS ARE NEVER WRITTEN HERE. This spec only reads, so it cannot be the test that
 * decides another one's result — `split-cut` is a fixture for several specs and stays one.
 */

test('the dashboard offers a player on every published cut and a dash on a draft', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const row = (slug: string) => page.getByTestId('admin-row').filter({ has: page.locator('code', { hasText: slug }) })

  await expect(row('cta-cut').getByTestId('admin-watch')).toBeVisible()
  await expect(row('split-cut').getByTestId('admin-watch')).toBeVisible()
  await expect(row('quiet-draft').getByTestId('admin-watch')).toHaveCount(0)
  await expect(row('quiet-draft').getByTestId('watch-cell')).toHaveText('—')

  // ⚠️ AFTER THE CLICK, NOT BEFORE. The button existing is the tidy dashboard; the player carrying
  // a real `src` is the feature. Asserting the button alone passes on a build where the route says
  // 404 and the component shows its error line instead.
  await row('cta-cut').getByTestId('admin-watch').click()
  const player = row('cta-cut').getByTestId('admin-player')
  await expect(player).toBeVisible()
  await expect(player).toHaveAttribute('src', /object\/sign\/review-videos\/.+token=/)
  await expect(row('cta-cut').getByTestId('admin-watch-error')).toHaveCount(0)
})

test('the route itself decides, not the dashboard — and a tester gets nothing at all', async ({ page }) => {
  // ⚠️ THROUGH THE ROUTE, NOT THE BUTTON. The dashboard hides the button on an uncleared row, so a
  // UI-only check cannot tell "the route refuses" from "the button was never rendered" — and the
  // route is the thing holding the signing key.
  await signIn(page, 'admin')

  const url = (slug: string) => page.request.get(`/api/video-url?slug=${slug}`)

  expect((await url('cta-cut')).status()).toBe(200)
  // Not cleared, and open anyway: the thing that changed on 2026-09-09.
  expect((await url('split-cut')).status()).toBe(200)
  expect((await url('quiet-draft')).status()).toBe(404)
  // The admin's own assignment still works — the approver path is untouched.
  expect((await url('flood-only')).status()).toBe(200)
})

/** ⚠️ ITS OWN `page`, because signing in as a second role on top of the first leaves two sessions
 *  in one jar and the login form never lands — which fails as "sign-in broke", four lines away
 *  from the thing being tested. */
test('the door is for reviewers and admins only — a tester still gets a 404', async ({ page }) => {
  await signIn(page, 'tester')
  expect((await page.request.get('/api/video-url?slug=cta-cut')).status()).toBe(404)
})
