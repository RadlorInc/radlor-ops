import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/**
 * AN ADMIN CAN WATCH A CLEARED CUT, AND ONLY A CLEARED ONE.
 *
 * ⚠️ THE FIXTURES ARE THE ARGUMENT. Three videos, each of which some plausible wrong
 * implementation would answer differently:
 *
 *   • `cta-cut`    — cleared, and the admin is NOT one of its reviewers. The assignment-only rule
 *                    this change replaced 404s it, so a green here means the new door opened.
 *   • `split-cut`  — `status = 'reviewed'` and NOT cleared: one approved, one asked for changes.
 *                    An implementation keyed on `videos.status` hands out a URL for a cut somebody
 *                    is still objecting to. This is the row that tells the two rules apart.
 *   • `quiet-draft`— a draft nobody has been asked about. Still nothing.
 *
 * ⚠️ AND THE VERDICTS ARE NEVER WRITTEN HERE. This spec only reads, so it cannot be the test that
 * decides another one's result — `split-cut` is a fixture for several specs and stays one.
 */

test('the dashboard offers a player on a cleared cut and a dash on the rest', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const row = (slug: string) => page.getByTestId('admin-row').filter({ has: page.locator('code', { hasText: slug }) })

  await expect(row('cta-cut').getByTestId('admin-watch')).toBeVisible()
  await expect(row('split-cut').getByTestId('admin-watch')).toHaveCount(0)
  await expect(row('split-cut').getByTestId('watch-cell')).toHaveText('—')
  await expect(row('quiet-draft').getByTestId('admin-watch')).toHaveCount(0)

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
  expect((await url('split-cut')).status()).toBe(404)
  expect((await url('quiet-draft')).status()).toBe(404)
  // The admin's own assignment still works and is NOT cleared — the reviewer path is untouched.
  expect((await url('flood-only')).status()).toBe(200)
})

/** ⚠️ ITS OWN `page`, because signing in as a second role on top of the first leaves two sessions
 *  in one jar and the login form never lands — which fails as "sign-in broke", four lines away
 *  from the thing being tested. */
test('the new door is for admins only — a tester still gets a 404', async ({ page }) => {
  await signIn(page, 'tester')
  expect((await page.request.get('/api/video-url?slug=cta-cut')).status()).toBe(404)
})
