import { expect, test } from '@playwright/test'
import { ADMIN_TOKEN } from './tokens'

/** Done-means #5: /admin without ADMIN_TOKEN is a 404; with it, it lists the videos. Plus the
 *  cookie exchange — the token is in the URL for exactly one request. */

/**
 * ⚠️ THE CONTRACT CHANGED WHEN ACCOUNTS ARRIVED, AND THIS IS THE NEW ONE.
 * A signed-out visitor to /admin now gets the LOGIN PAGE, not a 404. That is deliberate: admins and
 * testers are expected users, and hiding the door from someone who is supposed to walk through it
 * is a support ticket, not security. The 404 is reserved for someone who IS signed in and is not
 * an admin — see `auth.spec.ts`, which can only run against the live project.
 *
 * What did NOT change is that a wrong key is indistinguishable from no key.
 */
test('/admin signed out goes to the login page', async ({ page }) => {
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/login')
  await expect(page.getByTestId('sign-in')).toBeVisible()
})

test('a wrong admin key is indistinguishable from no key, and sets no cookie', async ({ page }) => {
  await page.goto('/admin?k=not-the-token')
  const wrong = { path: new URL(page.url()).pathname, body: await page.locator('body').innerText() }
  expect(await page.context().cookies()).toEqual([])

  await page.goto('/admin')
  expect({ path: new URL(page.url()).pathname, body: await page.locator('body').innerText() }).toEqual(wrong)
})

test('/admin with the token lists every video, status, version and unread count', async ({ page }) => {
  const res = await page.goto(`/admin?k=${ADMIN_TOKEN}`)
  expect(res?.status()).toBe(200)

  const rows = page.getByTestId('admin-row')
  await expect(rows).toHaveCount(4)
  // Including the draft, which the reviewer cannot see at all.
  await expect(rows.filter({ hasText: 'quiet-draft' })).toContainText('draft')
  await expect(rows.filter({ hasText: 'hook-test-b' })).toContainText('v2')
  // Verdict is its own column, separate from status.
  await expect(rows.filter({ hasText: 'cta-cut' })).toContainText('approved')
  await expect(rows.filter({ hasText: 'equals-reel-final' })).toContainText('—')
})

test('the token leaves the URL after one request and the cookie carries it after that', async ({ page }) => {
  await page.goto(`/admin?k=${ADMIN_TOKEN}`)

  // The parameter is gone from the address the browser ends up on — so it is not in the history,
  // not in a referrer, and not in any later request line.
  expect(page.url()).not.toContain(ADMIN_TOKEN)
  expect(new URL(page.url()).search).toBe('')

  const cookie = (await page.context().cookies()).find((c) => c.name === 'rvr_admin')
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.path).toBe('/admin')

  // A bare /admin now works, with no secret anywhere in the request line.
  expect((await page.goto('/admin'))?.status()).toBe(200)
  await expect(page.getByTestId('admin-row')).toHaveCount(4)
})
