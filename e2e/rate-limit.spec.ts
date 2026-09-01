import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/** Done-means #4: the rate limit actually rejects. This trips it rather than reading the constant.
 *  ⚠️ It signs in as its OWN reviewer, so tripping the per-reviewer window cannot fail the other
 *  specs — the same reason it used its own token before. `page.request` is used rather than the
 *  `request` fixture because the limit is keyed on the resolved user_id, which needs the session
 *  cookie; the bare fixture carries none and would be rate-limited as a signed-out caller. */
test('the eleventh note in a minute is rejected', async ({ page }) => {
  await signIn(page, 'flood')
  const statuses: number[] = []
  for (let i = 0; i < 12; i++) {
    const res = await page.request.post('/api/notes', {
      data: { slug: 'equals-reel-final', t_seconds: i, body: `flood ${i}` },
    })
    statuses.push(res.status())
  }

  // The limit is ten per minute per reviewer, so the first ten must be accepted — a suite that only
  // asserts "a 429 appeared" would also pass against a limiter that rejects everything.
  expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201))
  expect(statuses.slice(10)).toEqual([429, 429])
})
