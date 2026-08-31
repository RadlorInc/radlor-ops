import { expect, test } from '@playwright/test'
import { SUPABASE_URL, TOKENS } from './tokens'

/**
 * The reviewer's completion signal. Uses `hook-test-b` so it cannot collide with the note
 * round-trip spec, which drives `equals-reel-final`.
 */
const PAGE = `/r/${TOKENS.valid}/hook-test-b`

/** Reads the row straight out of the harness database — NOT out of the page that just wrote it.
 *  A button that turns green while the row stays `awaiting_review` is the whole failure mode. */
async function statusInDb(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/videos?select=status&slug=eq.hook-test-b`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json())[0].status
}

test('pressing Done sets the row to reviewed and swaps the button for a confirmation', async ({ page, request }) => {
  expect(await statusInDb(request)).toBe('awaiting_review')

  await page.goto(PAGE)
  await expect(page.getByTestId('done-reviewing')).toBeVisible()
  await page.getByTestId('done-reviewing').click()

  await expect(page.getByTestId('done-confirmation')).toBeVisible()
  await expect(page.getByTestId('done-reviewing')).toHaveCount(0)
  // The claim is about the DATABASE, not about the button's appearance.
  expect(await statusInDb(request)).toBe('reviewed')

  // Their notes are still there and the video still resolves — finishing must not lock them out.
  await page.reload()
  await expect(page.getByTestId('done-confirmation')).toBeVisible()
  await expect(page.getByTestId('note-list')).toContainText('text is still small on a phone')
  await expect(page.getByTestId('add-note')).toBeVisible()
})

test('a note added after finishing reopens the review and says so', async ({ page, request }) => {
  expect(await statusInDb(request)).toBe('reviewed')   // left by the test above

  await page.goto(PAGE)
  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('one more thing — the end card sits too long')
  await page.getByTestId('save-note').click()

  await expect(page.getByTestId('note-list')).toContainText('the end card sits too long')
  await expect(page.getByTestId('reopened-notice')).toBeVisible()
  await expect(page.getByTestId('done-reviewing')).toBeVisible()
  expect(await statusInDb(request)).toBe('awaiting_review')
})

test('the token authorises the status change and nothing else', async ({ request }) => {
  for (const token of [TOKENS.revoked, TOKENS.unknown]) {
    const res = await request.post('/api/review-done', { data: { token, slug: 'hook-test-b' } })
    expect(res.status(), token).toBe(404)
  }
  // A video the reviewer cannot see is a 404 too, not a silent success.
  const draft = await request.post('/api/review-done', { data: { token: TOKENS.valid, slug: 'quiet-draft' } })
  expect(draft.status()).toBe(404)
  expect(await statusInDb(request)).toBe('awaiting_review')
})
