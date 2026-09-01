import { expect, test } from '@playwright/test'
import { SUPABASE_URL, TOKENS } from './tokens'
import { signIn } from './signIn'

/** `hook-test-b`, so this cannot collide with the note round-trip spec on `equals-reel-final`. */
const PAGE = `/r/${TOKENS.valid}/hook-test-b`

/** Reads the row out of the DATABASE, not off the page that just wrote it. A verdict button that
 *  updates the UI while the row stays null is the failure this whole spec exists for. */
async function rowOf(request: import('@playwright/test').APIRequestContext, slug: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/videos?select=status,verdict&slug=eq.${slug}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json())[0]
}

test('choosing "Needs changes" records status AND verdict in the row', async ({ page, request }) => {
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'awaiting_review', verdict: null })

  await page.goto(PAGE)
  await expect(page.getByTestId('verdict-approved')).toBeVisible()
  await page.getByTestId('verdict-changes').click()

  await expect(page.getByTestId('verdict-label')).toHaveText('Changes needed.')
  await expect(page.getByTestId('verdict-approved')).toHaveCount(0)
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'changes_needed' })
})

test('a note afterwards CLEARS the verdict, not just the status', async ({ page, request }) => {
  await page.goto(PAGE)
  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('one more — the end card sits too long')
  await page.getByTestId('save-note').click()

  await expect(page.getByTestId('reopened-notice')).toBeVisible()
  await expect(page.getByTestId('verdict-approved')).toBeVisible()
  // Both halves. A cleared status with a surviving verdict would still tell Rafi "approved".
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'awaiting_review', verdict: null })
})

test('approving records the other verdict, and the reviewer is not locked out', async ({ page, request }) => {
  await page.goto(PAGE)
  await page.getByTestId('verdict-approved').click()
  await expect(page.getByTestId('verdict-label')).toHaveText('Approved — good to post.')
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'approved' })

  await page.reload()
  await expect(page.getByTestId('verdict-label')).toHaveText('Approved — good to post.')
  await expect(page.getByTestId('add-note')).toBeVisible()
  await expect(page.getByTestId('note-list')).toContainText('the end card sits too long')
})

test('the route refuses a bad token, a bad verdict, and a video the reviewer cannot see', async ({ request }) => {
  // Ported from the spec this replaced: unknown and revoked are the same 404 here too.
  for (const token of [TOKENS.revoked, TOKENS.unknown]) {
    const res = await request.post('/api/review-done', { data: { token, slug: 'hook-test-b', verdict: 'approved' } })
    expect(res.status(), token).toBe(404)
  }
  const bad = await request.post('/api/review-done', {
    data: { token: TOKENS.valid, slug: 'hook-test-b', verdict: 'shipped' },
  })
  expect(bad.status()).toBe(400)
  const draft = await request.post('/api/review-done', {
    data: { token: TOKENS.valid, slug: 'quiet-draft', verdict: 'approved' },
  })
  expect(draft.status()).toBe(404)
  // Neither attempt moved anything.
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'approved' })
  expect(await rowOf(request, 'quiet-draft')).toEqual({ status: 'draft', verdict: null })
})

test('/admin surfaces approved-with-open-notes instead of letting it pass silently', async ({ page }) => {
  await signIn(page, 'admin')
  const banner = page.getByTestId('approved-with-notes')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('cta-cut')
  await expect(banner).toContainText('1 open note')
})

test('the export puts the verdict in the heading', async ({ page }) => {
  await signIn(page, 'admin')
  const md = await (await page.goto('/admin/export'))!.text()
  expect(md).toContain('## cta-cut — v1 — APPROVED')
  expect(md).toContain('## hook-test-b — v2 — APPROVED')
})

/**
 * ⚠️ ASSERTED AGAINST `?all=1`, AND THAT IS THE WHOLE POINT OF THIS TEST.
 * The first version checked the DEFAULT export — where hook-test-b's v1 note is resolved and
 * therefore hidden, so no v1 heading is emitted at all and there is nothing for the assertion to
 * bind to. It passed with the version guard deleted. `?all=1` is the only state in which the older
 * heading exists, so it is the only state in which "did it borrow the current verdict?" is a
 * question that can be answered.
 */
test('an older version does not borrow the current verdict', async ({ page }) => {
  await signIn(page, 'admin')
  const md = await (await page.goto('/admin/export?all=1'))!.text()
  // The v1 heading must exist, or the next assertion proves nothing.
  expect(md).toContain('## hook-test-b — v1')
  expect(md).not.toContain('## hook-test-b — v1 — APPROVED')
  expect(md).toContain('## hook-test-b — v2 — APPROVED')
})
