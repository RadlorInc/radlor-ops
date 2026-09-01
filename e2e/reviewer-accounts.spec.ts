import { expect, test } from '@playwright/test'
import { SUPABASE_URL, TOKENS, USERS } from './tokens'
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
 * ⚠️ THE ONE THAT MAKES THE REPOINT SAFE TO TRUST. Both doors must reach the same person, or a
 * reviewer's history splits in half depending on how they arrived — and the half they cannot see
 * looks exactly like work that was lost. Written from one door and read from the other, in both
 * directions.
 */
test('the token door and the login door are the same person', async ({ page, request }) => {
  await signIn(page, 'dana')
  await page.goto('/review/equals-reel-final')
  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('written while signed in')
  await page.getByTestId('save-note').click()
  await expect(page.getByTestId('note-list')).toContainText('written while signed in')

  // Read it back through the OLD door, with no session at all.
  const anon = await page.context().browser()!.newContext()
  const tokenPage = await anon.newPage()
  await tokenPage.goto(`/r/${TOKENS.valid}/equals-reel-final`)
  await expect(tokenPage.getByTestId('note-list')).toContainText('written while signed in')

  // And the other direction: written through the token door, visible signed in.
  await tokenPage.getByTestId('add-note').click()
  await tokenPage.getByTestId('note-body').fill('written through the link')
  await tokenPage.getByTestId('save-note').click()
  await expect(tokenPage.getByTestId('note-list')).toContainText('written through the link')
  await anon.close()

  await page.reload()
  await expect(page.getByTestId('note-list')).toContainText('written through the link')

  // Both are one author in the database, not two.
  const bodies = (await notesOf(request, USERS.dana)).map((n) => n.body)
  expect(bodies).toContain('written while signed in')
  expect(bodies).toContain('written through the link')
})
