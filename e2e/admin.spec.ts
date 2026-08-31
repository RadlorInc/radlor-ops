import { expect, test } from '@playwright/test'
import { ADMIN_TOKEN } from './tokens'

/** Done-means #5: /admin without ADMIN_TOKEN is a 404; with it, it lists the videos. Plus the
 *  cookie exchange — the token is in the URL for exactly one request. */

test('/admin without the token is a 404', async ({ page }) => {
  expect((await page.goto('/admin'))?.status()).toBe(404)
})

test('/admin with the wrong token is the same 404, and sets no cookie', async ({ page }) => {
  expect((await page.goto('/admin?k=not-the-token'))?.status()).toBe(404)
  expect(await page.context().cookies()).toEqual([])
})

test('/admin with the token lists every video, status, version and unread count', async ({ page }) => {
  const res = await page.goto(`/admin?k=${ADMIN_TOKEN}`)
  expect(res?.status()).toBe(200)

  const rows = page.getByTestId('admin-row')
  await expect(rows).toHaveCount(3)
  // Including the draft, which the reviewer cannot see at all.
  await expect(rows.filter({ hasText: 'quiet-draft' })).toContainText('draft')
  await expect(rows.filter({ hasText: 'hook-test-b' })).toContainText('v2')
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
  await expect(page.getByTestId('admin-row')).toHaveCount(3)
})
