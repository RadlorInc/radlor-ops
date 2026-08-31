import { expect, test } from '@playwright/test'
import { ADMIN_TOKEN } from './tokens'

/** Done-means #6, plus the thing that makes `resolved_at` a column something reads. The seed has
 *  one RESOLVED v1 note and one open v2 note on `hook-test-b`. */

/** The export is a route handler, not a page, so it still answers 404 rather than redirecting —
 *  there is no login form to render into a `text/plain` download. */
test('/admin/export without a session or key is a 404', async ({ page }) => {
  expect((await page.goto('/admin/export'))?.status()).toBe(404)
})

test('the export is open notes only, grouped by video and version, and says what it hid', async ({ page }) => {
  await page.goto(`/admin?k=${ADMIN_TOKEN}`)
  const res = await page.goto('/admin/export')
  expect(res?.status()).toBe(200)
  expect(res!.headers()['content-type']).toContain('text/plain')

  const md = await res!.text()
  expect(md).toContain('## hook-test-b — v2')
  expect(md).toContain('- 0:04 — v2: better, but the text is still small on a phone')
  // The resolved v1 note is not in the default dump...
  expect(md).not.toContain('the logo lands too late')
  // ...and the reader is told so, rather than a short export reading as a complete one.
  expect(md).toContain('1 resolved note hidden')
})

test('?all=1 includes resolved notes, struck through, under their own version heading', async ({ page }) => {
  await page.goto(`/admin?k=${ADMIN_TOKEN}`)
  const md = await (await page.goto('/admin/export?all=1'))!.text()

  expect(md).toContain('## hook-test-b — v1')
  expect(md).toContain('- 0:11 — ~~v1: the logo lands too late~~')
  // The open one is NOT struck through — the two states have to be distinguishable at a glance.
  expect(md).toContain('- 0:04 — v2: better, but the text is still small on a phone')
  expect(md).not.toContain('1 resolved note hidden')
})
