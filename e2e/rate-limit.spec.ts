import { expect, test } from '@playwright/test'
import { TOKENS } from './tokens'

/** Done-means #4: the rate limit actually rejects. This trips it rather than reading the constant.
 *  It uses its own reviewer token so tripping the per-token window cannot fail the other specs. */
test('the eleventh note in a minute is rejected', async ({ request }) => {
  const statuses: number[] = []
  for (let i = 0; i < 12; i++) {
    const res = await request.post('/api/notes', {
      data: { token: TOKENS.flood, slug: 'equals-reel-final', t_seconds: i, body: `flood ${i}` },
    })
    statuses.push(res.status())
  }

  // The limit is ten per minute per token, so the first ten must be accepted — a suite that only
  // asserts "a 429 appeared" would also pass against a limiter that rejects everything.
  expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201))
  expect(statuses.slice(10)).toEqual([429, 429])
})
