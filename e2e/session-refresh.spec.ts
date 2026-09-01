import { expect, test } from '@playwright/test'
import { ACCOUNTS } from './tokens'
import { signIn } from './signIn'

/**
 * The proxy's token refresh — what decides whether a tester mid-write-up is thrown back to a login
 * form an hour in. "Logged out and lost what I typed" is what makes someone stop using a tool
 * rather than report a bug, so it does not get to sit in the untested column.
 *
 * ⚠️ THE EXPIRY IS FORGED, NOT WAITED FOR. The access token cookie is replaced with one whose `exp`
 * is in the past, keeping the real refresh token. That is deterministic, needs no clock, and — the
 * reason it beats shortening the token lifetime globally — leaves every other spec alone. A short
 * global TTL was tried first and broke the suite's cached sessions, because refresh tokens are
 * single-use and a cached one had already been spent.
 *
 * Forging is safe here precisely because the proxy does not verify signatures: it reads `exp` to
 * decide whether a refresh is worth attempting, and the REAL check happens afterwards in
 * `currentUser()`, against the auth server.
 */
async function loginFresh(page: import('@playwright/test').Page) {
  const { email, password } = ACCOUNTS.admin
  await page.goto('/login')
  await page.getByTestId('email').fill(email)
  await page.getByTestId('password').fill(password)
  await page.getByTestId('sign-in').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

const forged = (value: string) => ({ name: 'rvr_at', value, domain: '127.0.0.1', path: '/' })

/** Swaps the access token for `value`, leaving every other cookie exactly as it was. */
async function replaceAccessToken(context: import('@playwright/test').BrowserContext, value: string) {
  const others = (await context.cookies()).filter((c) => c.name !== 'rvr_at')
  await context.clearCookies()
  await context.addCookies([...others, forged(value)])
}

/** Same shape the harness issues: `x.<base64url payload>.y`, with `exp` already gone. */
function expiredAccessToken(sub: string) {
  const payload = { sub, email: ACCOUNTS.admin.email, exp: Math.floor(Date.now() / 1000) - 60 }
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`
}

test('an expired access token is refreshed, and the page renders signed in', async ({ page, context }) => {
  await loginFresh(page)
  const before = (await context.cookies()).find((c) => c.name === 'rvr_at')!.value
  const sub = JSON.parse(Buffer.from(before.split('.')[1], 'base64url').toString()).sub

  /**
   * ⚠️ REPLACE THE JAR, DO NOT ADD TO IT. `addCookies` with a name that already exists but a
   * different domain/path spec creates a SECOND cookie rather than overwriting — both get sent, the
   * server reads the valid one, no refresh happens, and the test passes for the wrong reason. It
   * did exactly that on the first run: HTTP 200, admin rows visible, and the token unchanged.
   */
  const rtBefore = (await context.cookies()).find((c) => c.name === 'rvr_rt')!.value
  const dead = expiredAccessToken(sub)
  await replaceAccessToken(context, dead)

  const res = await page.goto('/admin')
  expect(res?.status()).toBe(200)
  await expect(page.getByTestId('admin-row').first()).toBeVisible()

  const after = (await context.cookies()).find((c) => c.name === 'rvr_at')!.value
  const rtAfter = (await context.cookies()).find((c) => c.name === 'rvr_rt')!.value

  // Three separate facts, because "the page rendered" is true of a proxy that refreshed nothing:
  expect(after).not.toBe(dead) //   the expired token was not quietly accepted
  expect(after).not.toBe(before) //  a new one was minted, not the old one restored
  expect(rtAfter).not.toBe(rtBefore) // the refresh token rotated — it was actually spent
  const exp = JSON.parse(Buffer.from(after.split('.')[1], 'base64url').toString()).exp
  expect(exp * 1000).toBeGreaterThan(Date.now())
})

test('with no refresh token, an expired session is over', async ({ page, context }) => {
  /**
   * ⚠️ THE CACHED SESSION, NOT A FRESH ONE — and the reason is a limit, not a preference. The
   * login route allows ten attempts a minute per IP, the suite now signs in as four different
   * people, and this test was the one that tipped over: it passed alone and went red in the full
   * run. It does not need a fresh login. The test above does — it SPENDS the refresh token, and
   * those are single-use — but this one deletes the refresh token before doing anything, so a
   * cached session is exactly as good and costs no attempt.
   */
  await signIn(page, 'admin')
  const at = (await context.cookies()).find((c) => c.name === 'rvr_at')!.value
  const sub = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString()).sub

  /**
   * ⚠️ THE CONTROL. Without it, "the session survived" is equally consistent with a proxy that
   * refreshes nothing and an expired token that was never actually rejected. Same forged expiry,
   * nothing to refresh WITH — so the session must end at the login page.
   */
  const keep = (await context.cookies()).filter((c) => c.name !== 'rvr_rt' && c.name !== 'rvr_at')
  await context.clearCookies()
  await context.addCookies([...keep, forged(expiredAccessToken(sub))])

  await page.goto('/admin')
  expect(new URL(page.url()).pathname).toBe('/login')
})
