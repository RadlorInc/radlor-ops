import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/**
 * Reviewers sign in. The token door is still open and stays open until a human has confirmed this
 * one works — these specs are what makes that confirmation cheap rather than a leap.
 */

async function notesOf(request: import('@playwright/test').APIRequestContext, reviewerId: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/notes?select=body,t_seconds,reviewer_id&reviewer_id=eq.${reviewerId}`,
    { headers: { 'Accept-Profile': 'review' } },
  )
  return (await res.json()) as { body: string; t_seconds: number; reviewer_id: string }[]
}

test('a signed-in reviewer lands on their own list, scoped by assignment', async ({ page }) => {
  await signIn(page, 'dana')
  await expect(page).toHaveURL(/\/review$/)
  await expect(page.getByTestId('video-card').filter({ hasText: 'Hook test B' })).toBeVisible()
  // `flood-only` is awaiting review and is somebody else's. Status alone would have listed it.
  await expect(page.getByText('Flood only')).toHaveCount(0)
})

test('every other surface 404s for a reviewer, and the admin still gets 200', async ({ page, browser }) => {
  await signIn(page, 'dana')
  expect((await page.goto('/admin'))?.status()).toBe(404)
  expect((await page.goto('/tester'))?.status()).toBe(404)
  expect((await page.goto('/admin/export'))?.status()).toBe(404)

  /**
   * ⚠️ THE POSITIVE CONTROL, IN THE SAME TEST. A build that 404s /admin for EVERYONE satisfies
   * every line above. The admin getting 200 from the same URL, in a separate session, is what
   * makes them mean "role gating", the same way the anon script's service_role control does.
   */
  const other = await browser.newPage()
  await signIn(other, 'admin')
  expect((await other.goto('/admin'))?.status()).toBe(200)
  await other.close()
})

test('a tester cannot open the reviewer surface', async ({ page }) => {
  await signIn(page, 'tester')
  expect((await page.goto('/review'))?.status()).toBe(404)
})

test('signed out, /review sends you to the login form rather than 404ing', async ({ page, context }) => {
  await context.clearCookies()
  await page.goto('/review')
  // Reviewers are EXPECTED at the door. Hiding it from someone who belongs there is a support
  // ticket, not security — the same split requireRole() has always made.
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId('email')).toBeVisible()
})

test('an admin opens the reviewer surface and sees THEIR assignments, not everyone’s', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/review')
  // ⚠️ This is the "why can the admin see a reviewer page" answer, as an assertion. The admin is
  // assigned to flood-only and to nothing else, so seeing Dana's hook-test-b here would mean the
  // surface is gated by role instead of scoped by assignment.
  await expect(page.getByTestId('video-card').filter({ hasText: 'Flood only' })).toBeVisible()
  await expect(page.getByText('Hook test B')).toHaveCount(0)
})

test('a reviewer notes and finishes WITHOUT a token, and it lands on their own row', async ({ page, request }) => {
  await signIn(page, 'dana')
  await page.goto('/review/equals-reel-final')

  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('signed in, no token in sight')
  await page.getByTestId('save-note').click()
  await expect(page.getByTestId('note-list')).toContainText('signed in, no token in sight')

  const mine = await notesOf(request, USERS.dana)
  expect(mine.map((n) => n.body)).toContain('signed in, no token in sight')
  // Nothing was written under anybody else.
  const theirs = await notesOf(request, USERS.flood)
  expect(theirs.map((n) => n.body)).not.toContain('signed in, no token in sight')
})

/**
 * ⚠️ THE "TWO DOORS ARE ONE PERSON" TEST LIVED HERE AND IS DELETED, NOT REWRITTEN. It wrote a note
 * through /review and read it back through /r/<token>, both directions. There is no second door
 * any more, so there is nothing for it to compare — a rewrite would have been a second copy of
 * "a reviewer sees their own notes", dressed as the stronger property it can no longer check.
 *
 * What it bought is already banked: it went red under break-check when the bridge was broken, and
 * on that evidence the token path was removed without a single note changing owner. A check whose
 * subject has been deleted is deleted with it — see CLAUDE.md on when removing a check is the
 * honest option.
 *
 * What survives it, and is checked above: notes written before the swap still belong to the
 * account, because the seeded notes render on the signed-in page.
 */
