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

/**
 * ⚠️ THIS COMPARES WHAT A HUMAN SEES — `innerText` — AND THAT IS THE CLAIM. Do not describe it as
 * "identical responses": the raw HTML is NOT identical, because Next serialises the `[token]` route
 * param into the RSC payload, so each 404 carries its own token. Nothing in either body says
 * "revoked", which is the property that matters — but the stronger sentence was written into a
 * report once, and a passing test wearing an overstated claim is harder to catch than a failure.
 */
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
