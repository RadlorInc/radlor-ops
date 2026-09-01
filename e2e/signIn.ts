import type { Cookie, Page } from '@playwright/test'
import { ACCOUNTS } from './tokens'

/**
 * Signs a Playwright page in through the real login form.
 *
 * ⚠️ IT DRIVES THE FORM, IT DOES NOT FORGE A COOKIE. Setting the session cookie directly would skip
 * `/api/auth/login` — the route that decides what goes in the cookie and with which flags — and
 * every admin test would then pass against a build whose login was broken.
 *
 * ⚠️ AND IT CACHES THE RESULT PER ROLE, because the login route is RATE LIMITED at ten attempts a
 * minute per IP and that is not a number to raise for a test suite's convenience. Discovered the
 * way these things should be: the full suite went red on an export assertion, and the cause was a
 * dozen sign-ins from one address in under a minute — the limiter working exactly as intended, on
 * us. Tests that are ABOUT the form pass `fresh: true` and drive it every time.
 */
const sessions = new Map<string, Cookie[]>()

export async function signIn(page: Page, who: keyof typeof ACCOUNTS, opts: { fresh?: boolean } = {}) {
  const cached = sessions.get(who)
  if (!opts.fresh && cached) {
    await page.context().addCookies(cached)
    // ⚠️ AND NAVIGATE. The form path lands on the role's home page, so callers reasonably expect to
    // BE there afterwards. The first cached version only set cookies and returned, leaving the page
    // on about:blank — three tests then asserted against a blank page and one of them noticed.
    await page.goto(who === 'tester' ? '/tester' : who === 'admin' ? '/admin' : '/review')
    return
  }
  /**
   * ⚠️ ONE RETRY, BECAUSE THE SUITE LEGITIMATELY TRIPS ITS OWN RATE LIMIT. The login route allows
   * ten attempts a minute per IP. A full run now spends: four cached sign-ins (admin, tester,
   * dana, flood), three deliberate fresh ones in admin.spec, two deliberate WRONG passwords, and
   * one in session-refresh — right at the edge, which is why this arrived as an intermittent
   * failure in a spec about token refresh rather than as anything resembling a rate limit.
   *
   * ⚠️ THE LIMIT IS NOT RAISED FOR THE TESTS, AND MUST NOT BE. Ten a minute is a real property of
   * the product; a suite that needs it loosened is a suite quietly testing a different build. So
   * the suite waits the window out instead. It costs a minute on the rare run that hits it.
   *
   * The retry is only ever reached with CORRECT credentials — the wrong-password specs drive the
   * form themselves and never come through here — so a second failure is a real one.
   */
  const { email, password } = ACCOUNTS[who]
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('/login')
    await page.getByTestId('email').fill(email)
    await page.getByTestId('password').fill(password)
    await page.getByTestId('sign-in').click()
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10_000 })
      sessions.set(who, await page.context().cookies())
      return
    } catch {
      if (attempt === 1) throw new Error(`sign-in as ${who} failed twice, a minute apart — not the rate limit`)
      await page.waitForTimeout(61_000)
    }
  }
}
