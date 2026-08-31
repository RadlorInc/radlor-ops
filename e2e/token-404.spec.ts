import { expect, test } from '@playwright/test'
import { TOKENS } from './tokens'

/** Done-means #2: a revoked token 404s AND a token that never existed 404s. Both paths, and
 *  indistinguishably — a different answer for "revoked" tells whoever holds it that it was real. */

test('a revoked token gets a 404', async ({ page }) => {
  const res = await page.goto(`/r/${TOKENS.revoked}`)
  expect(res?.status()).toBe(404)
})

test('a token that never existed gets a 404', async ({ page }) => {
  const res = await page.goto(`/r/${TOKENS.unknown}`)
  expect(res?.status()).toBe(404)
})

test('revoked and never-existed are indistinguishable', async ({ page }) => {
  await page.goto(`/r/${TOKENS.revoked}`)
  const revoked = await page.locator('body').innerText()
  await page.goto(`/r/${TOKENS.unknown}`)
  expect(await page.locator('body').innerText()).toBe(revoked)
})

test('the API answers both the same way, without confirming either', async ({ request }) => {
  for (const token of [TOKENS.revoked, TOKENS.unknown]) {
    const res = await request.post('/api/notes', {
      data: { token, slug: 'equals-reel-final', t_seconds: 1, body: 'should not land' },
    })
    expect(res.status(), token).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  }
})
