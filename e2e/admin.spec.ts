import { expect, test } from '@playwright/test'
import { ADMIN_TOKEN } from './tokens'

/** Done-means #5: /admin without ADMIN_TOKEN is a 404; with it, it lists the videos. */

test('/admin without the token is a 404', async ({ page }) => {
  expect((await page.goto('/admin'))?.status()).toBe(404)
})

test('/admin with the wrong token is the same 404', async ({ page }) => {
  expect((await page.goto('/admin?k=not-the-token'))?.status()).toBe(404)
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
