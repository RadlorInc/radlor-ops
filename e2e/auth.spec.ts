import { expect, test, type APIRequestContext } from '@playwright/test'
import { SUPABASE_URL } from './tokens'
import { signIn } from './signIn'

/**
 * Accounts by invitation, passwords by emailed link, resets by emailed link.
 *
 * The mailer is the fake's `outbox` (test/fake-supabase.mjs): every link Supabase would have
 * emailed is there, as a path, and the specs open it the way a person would — in a FRESH browser
 * context with no cookies, because the invitee is not the admin who sent it.
 *
 * ⚠️ WHAT THIS CANNOT SEE: whether a real email arrives. That is SMTP on the live project, and it
 * is in the handoff's waiting-on-Rafi list. These specs prove the app's half — the right link is
 * asked for, the link signs in exactly once, the password lands on the auth server.
 */
type Mail = { to: string; type: string; link: string }
const outbox = async (request: APIRequestContext) => (await request.get(`${SUPABASE_URL}/_outbox`)).json() as Promise<Mail[]>
async function latest(request: APIRequestContext, to: string, type: string): Promise<Mail | undefined> {
  const mine = (await outbox(request)).filter((m) => m.to === to && m.type === type)
  return mine[mine.length - 1]
}
/** Asks the AUTH SERVER whether a password is the one on file — not the app's login form, which is
 *  rate-limited at ten a minute per IP and already near that across the suite. */
const passwordWorks = async (request: APIRequestContext, email: string, password: string) =>
  (await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { headers: { apikey: 'x' }, data: { email, password } })).ok()

test('an admin invites someone; the link confirms them, sets a password, and the role is the one chosen', async ({ page, request, browser }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')
  await page.getByTestId('invite-name').fill('Newbie Reviewer')
  await page.getByTestId('invite-email').fill('newbie@example.com')
  await page.getByTestId('invite-role').selectOption('reviewer')
  await page.getByTestId('invite-send').click()
  await expect(page.getByTestId('invite-sent')).toContainText('newbie@example.com')
  await expect(page.getByTestId('people-list')).toContainText('Newbie Reviewer')

  const mail = await latest(request, 'newbie@example.com', 'invite')
  expect(mail).toBeTruthy()

  // The invitee, in their own browser, with nothing.
  const ctx = await browser.newContext()
  const them = await ctx.newPage()
  await them.goto(mail!.link)
  await expect(them).toHaveURL(/\/set-password$/)
  await them.getByTestId('new-password').fill('a-long-enough-password')
  await them.getByTestId('confirm-password').fill('a-long-enough-password')
  await them.getByTestId('save-password').click()
  // ⚠️ /review, not /tester or /admin — the ROLE the admin picked is what routes them.
  await expect(them).toHaveURL(/\/review$/)
  await expect(them.getByTestId('nothing-assigned')).toBeVisible()
  await ctx.close()

  expect(await passwordWorks(request, 'newbie@example.com', 'a-long-enough-password')).toBe(true)

  // ⚠️ THE LINK IS SINGLE-USE. Opened again, it signs nobody in and says so with a fixed word.
  const again = await (await browser.newContext()).newPage()
  await again.goto(mail!.link)
  await expect(again).toHaveURL(/\/login\?error=link$/)
  expect((await again.context().cookies()).some((c) => c.name === 'rvr_at')).toBe(false)
})

test('forgot password: a reset link sets a new password; an unknown address gets the same answer and no mail', async ({ page, request, browser }) => {
  // Its own account, so no other spec's sign-in is disturbed by a password changing under it.
  await signIn(page, 'admin')
  const r = await page.request.post('/api/admin/invite', { data: { name: 'Reset Me', email: 'resetme@example.com', role: 'tester' } })
  expect(r.status()).toBe(200)
  const invite = await latest(request, 'resetme@example.com', 'invite')
  const ctx = await browser.newContext()
  const them = await ctx.newPage()
  await them.goto(invite!.link)
  await them.getByTestId('new-password').fill('first-password-123')
  await them.getByTestId('confirm-password').fill('first-password-123')
  await them.getByTestId('save-password').click()
  await expect(them).toHaveURL(/\/tester$/)
  await them.getByTestId('sign-out').click()
  await expect(them).toHaveURL(/\/login$/)

  // The way in from the sign-in page, then the form.
  await them.getByTestId('forgot-link').click()
  await expect(them).toHaveURL(/\/forgot$/)
  await them.getByTestId('forgot-email').fill('resetme@example.com')
  await them.getByTestId('forgot-send').click()
  await expect(them).toHaveURL(/\/forgot\?sent=1$/)
  await expect(them.getByTestId('forgot-sent')).toBeVisible()
  const reset = await latest(request, 'resetme@example.com', 'recovery')
  expect(reset).toBeTruthy()

  // ⚠️ AN UNKNOWN ADDRESS: same page, same sentence, and the outbox does not grow. A different
  // answer here is a list of who has an account, one guess at a time.
  const before = (await outbox(request)).length
  await them.goto('/forgot')
  await them.getByTestId('forgot-email').fill('nobody@example.com')
  await them.getByTestId('forgot-send').click()
  await expect(them).toHaveURL(/\/forgot\?sent=1$/)
  await expect(them.getByTestId('forgot-sent')).toBeVisible()
  expect((await outbox(request)).length).toBe(before)

  // The reset link: choose again, land home, and only the NEW password is on file.
  await them.goto(reset!.link)
  await expect(them).toHaveURL(/\/set-password$/)
  await them.getByTestId('new-password').fill('second-password-456')
  await them.getByTestId('confirm-password').fill('second-password-456')
  await them.getByTestId('save-password').click()
  await expect(them).toHaveURL(/\/tester$/)
  await ctx.close()
  expect(await passwordWorks(request, 'resetme@example.com', 'second-password-456')).toBe(true)
  expect(await passwordWorks(request, 'resetme@example.com', 'first-password-123')).toBe(false)
})

test('a tester cannot invite; an existing address is refused in words; a dead link and a bare /set-password both bounce', async ({ page, browser }) => {
  await signIn(page, 'tester')
  // Same 404 a tester gets for every admin route — not a 403 that confirms the route exists.
  const r = await page.request.post('/api/admin/invite', { data: { name: 'X', email: 'x@example.com', role: 'admin' } })
  expect(r.status()).toBe(404)

  await page.context().clearCookies()
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')
  await page.getByTestId('invite-name').fill('Dana Again')
  await page.getByTestId('invite-email').fill('dana@example.com')
  await page.getByTestId('invite-send').click()
  await expect(page.getByTestId('invite-error')).toContainText('already has an account')

  const nobody = await (await browser.newContext()).newPage()
  await nobody.goto('/auth/confirm?token_hash=not-a-real-hash&type=invite')
  await expect(nobody).toHaveURL(/\/login\?error=link$/)
  await expect(nobody.getByTestId('login-error')).toContainText('expired or was already used')
  await nobody.goto('/set-password')
  await expect(nobody).toHaveURL(/\/login\?error=link$/)
  // The mismatch and too-short paths need a session; they are covered by the browser's own
  // `minLength` plus the route's checks, which the invite spec exercises on the happy path.
})
