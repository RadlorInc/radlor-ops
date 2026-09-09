import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/**
 * EVERYONE WITH A REVIEWER ACCOUNT SEES EVERY PUBLISHED CUT AND MAY LEAVE NOTES; ONE PERSON PER
 * CUT APPROVES OR REJECTS IT. Rafi's call, 2026-09-09.
 *
 * ⚠️ THE FIXTURE IS `flood-only` AS SEEN BY DANA, and it is the only one that can carry this. It is
 * `awaiting_review` with Flood as its single approver. Under the rule this replaced Dana got a 404
 * on the list, the page, the signed URL and the note route alike — so every "she can" below is
 * red on the old code. And she is NOT its approver, so "she cannot decide" is the assignment
 * refusing her and nothing else: `status` lets it through, and the role gate let her in.
 *
 * ⚠️ IT WRITES ONE NOTE AND NO VERDICT. Flood's row on `flood-only` must stay `null`; the last
 * assertion reads it back so a verdict route that quietly accepted Dana's answer cannot pass.
 */

async function floodsRow(request: import('@playwright/test').APIRequestContext) {
  const v = await request.get(`${SUPABASE_URL}/rest/v1/videos?select=id&slug=eq.flood-only`, {
    headers: { 'Accept-Profile': 'review' },
  })
  const { id } = ((await v.json()) as { id: string }[])[0]
  const a = await request.get(
    `${SUPABASE_URL}/rest/v1/video_reviewers?select=reviewer_id,verdict&video_id=eq.${id}`,
    { headers: { 'Accept-Profile': 'review' } },
  )
  return (await a.json()) as { reviewer_id: string; verdict: string | null }[]
}

test('a reviewer who is not the approver can watch and note a cut, and cannot decide it', async ({ page, request }) => {
  await signIn(page, 'dana')

  // The list says up front whose call it is.
  await page.goto('/review')
  const card = page.getByTestId('video-card').filter({ hasText: 'Flood only' })
  await expect(card).toBeVisible()
  await expect(card.getByTestId('video-pill')).toHaveText('Feedback welcome')

  // The page, the player's credential, and a note — all hers now.
  await card.click()
  await expect(page).toHaveURL(/\/review\/flood-only$/)
  await expect(page.getByTestId('player')).toBeVisible()
  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('feedback from somebody who is not the approver')
  await page.getByTestId('save-note').click()
  await expect(page.getByTestId('note-list')).toContainText('feedback from somebody who is not the approver')

  // ⚠️ AFTER THE NOTE, NOT BEFORE. The verdict panel renders below the note list, and a note is
  // the one thing on this page that could plausibly reopen it into existence.
  await expect(page.getByTestId('verdict-approved')).toHaveCount(0)
  await expect(page.getByTestId('verdict-changes')).toHaveCount(0)
  await expect(page.getByText('Someone else gives the final approve or reject')).toBeVisible()

  // And the route, driven directly, because a hidden button is a rendering decision.
  const res = await page.request.post('/api/review-done', { data: { slug: 'flood-only', verdict: 'approved' } })
  expect(res.status()).toBe(404)

  // Nothing landed on the approver's row, and Dana gained no row of her own.
  expect(await floodsRow(request)).toEqual(
    expect.arrayContaining([{ reviewer_id: USERS.flood, verdict: null }]),
  )
  expect((await floodsRow(request)).some((r) => r.reviewer_id === USERS.dana)).toBe(false)
})

test('the approver sees the two buttons on the same cut — the positive control', async ({ page }) => {
  await signIn(page, 'flood')
  await page.goto('/review/flood-only')
  await expect(page.getByTestId('player')).toBeVisible()
  await expect(page.getByTestId('verdict-approved')).toBeVisible()
  await expect(page.getByTestId('verdict-changes')).toBeVisible()
  // Read, not clicked: `flood-only` stays undecided for the spec above and for verdict.spec.
})
