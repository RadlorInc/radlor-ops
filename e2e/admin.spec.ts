import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/**
 * The admin surface, now gated by an account rather than a shared `?k=` secret.
 *
 * ⚠️ THE CONTRACT CHANGED WITH ACCOUNTS. A signed-OUT visitor to /admin gets the LOGIN PAGE, not a
 * 404: admins and testers are expected users, and hiding the door from someone who is supposed to
 * walk through it is a support ticket, not security. The 404 is reserved for someone who IS signed
 * in and is not an admin — a tester must not learn that /admin is a real page.
 */

test('/admin signed out goes to the login page', async ({ page }) => {
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/login')
  await expect(page.getByTestId('sign-in')).toBeVisible()
})

test('a wrong password is refused, and says nothing about whether the account exists', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email').fill('admin@harness.test')
  await page.getByTestId('password').fill('not-the-password')
  await page.getByTestId('sign-in').click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  const real = await page.getByTestId('login-error').innerText()

  await page.goto('/login')
  await page.getByTestId('email').fill('nobody-here@harness.test')
  await page.getByTestId('password').fill('not-the-password')
  await page.getByTestId('sign-in').click()
  // Identical wording for "wrong password" and "no such account" — otherwise the form is an
  // account-enumeration oracle, and with self-signup off, knowing who has an account is knowing
  // who works here.
  await expect(page.getByTestId('login-error')).toHaveText(real)
})

test('an admin signs in and sees the video list', async ({ page }) => {
  await signIn(page, 'admin', { fresh: true })   // this test is about the form itself
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(200)

  const rows = page.getByTestId('admin-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.filter({ hasText: 'quiet-draft' })).toContainText('draft')
  await expect(rows.filter({ hasText: 'hook-test-b' })).toContainText('v2')
  await expect(rows.filter({ hasText: 'cta-cut' })).toContainText('approved')
  await expect(rows.filter({ hasText: 'equals-reel-final' })).toContainText('—')
})

test('a TESTER gets 404 on /admin — and the admin still gets 200, or that proves nothing', async ({ page, browser }) => {
  await signIn(page, 'tester')
  await expect(page.getByTestId('tester-greeting')).toBeVisible()
  expect((await page.goto('/admin'))?.status()).toBe(404)
  expect((await page.goto('/tester'))?.status()).toBe(200)

  /**
   * ⚠️ THE POSITIVE CONTROL, IN THE SAME TEST ON PURPOSE. A build that 404s /admin for EVERYONE
   * satisfies the assertion above completely. The tester's 404 only means "role gating works"
   * while an admin, in a separate session, still gets 200 from the same URL.
   */
  const other = await browser.newContext()
  const adminPage = await other.newPage()
  await signIn(adminPage, 'admin')
  expect((await adminPage.goto('/admin'))?.status()).toBe(200)
  await other.close()
})

test('the session cookies are httpOnly and page script cannot read them', async ({ page }) => {
  await signIn(page, 'admin', { fresh: true })   // the flags are set by the login ROUTE
  const jar = await page.context().cookies()
  const at = jar.find((c) => c.name === 'rvr_at')
  const rt = jar.find((c) => c.name === 'rvr_rt')
  expect(at?.httpOnly).toBe(true)
  expect(rt?.httpOnly).toBe(true)
  expect(await page.evaluate(() => document.cookie)).toBe('')
})

test('signing out ends the session', async ({ page }) => {
  await signIn(page, 'admin', { fresh: true })
  expect((await page.goto('/admin'))?.status()).toBe(200)

  await page.getByTestId('sign-out').click()
  await page.waitForLoadState('networkidle')

  /**
   * ⚠️ ASSERTED ON THE SESSION, NOT ON THE LANDING URL. The first version waited for `/login`, and
   * against a broken logout that leaves the cookies intact `/login` REDIRECTS A SIGNED-IN USER
   * STRAIGHT BACK to /admin — so the test timed out instead of failing an assertion. Red, but not
   * for a reason anyone could read. These two facts are what "signed out" means.
   */
  expect((await page.context().cookies()).filter((c) => c.value !== '')).toEqual([])
  await page.goto('/admin')
  expect(new URL(page.url()).pathname).toBe('/login')
})
