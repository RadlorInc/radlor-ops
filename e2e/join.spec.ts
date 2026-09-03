import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { SUPABASE_URL } from './tokens'
import { signIn } from './signIn'

/**
 * Accounts by link, and NOTHING IS EMAILED. The admin pastes addresses; the server makes an
 * account per address WITH NO PASSWORD and one single-use link each; the admin sends the block to
 * whoever is organising the testers, who forwards each person their own line.
 *
 * The links are read out of the page the admin actually copies from — `links-out` — because that
 * textarea is the product. A spec that asked the API for them would still pass on a build where
 * the admin can never see them.
 *
 * ⚠️ WHAT THIS CANNOT SEE: that `service_role` may UPDATE `invite_links` on the live project.
 * PGlite runs as one superuser, so the grant is invisible here by construction (see the blind spot
 * at the top of test/fake-supabase.mjs). Marking a link used is an UPDATE; if that grant is
 * missing in production every link stays alive after use and this suite stays green.
 */
const passwordWorks = async (request: APIRequestContext, email: string, password: string) =>
  (
    await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: 'x' },
      data: { email, password },
    })
  ).ok()

/**
 * Drives the admin's form and reads back the block of `email  url` lines it prints.
 *
 * ⚠️ THE BLOCK IS ASSERTED *AFTER* THE LIST BELOW HAS REDRAWN, AND THAT ORDERING IS THE TEST.
 * Making links calls `router.refresh()` to update *Who has access*, which REMOUNTS the component
 * holding the links — and they cannot be fetched again, because only their hash is stored. Three
 * of them were lost that way with the accounts already created. Asserting the block right after
 * the click passed anyway: it was there for the moment between the fetch resolving and the refresh
 * landing. Waiting for the row count to move first is what puts the assertion on the far side of
 * the thing that destroys it.
 */
async function makeLinks(page: Page, emails: string[], role: string): Promise<Map<string, string>> {
  await page.goto('/admin?tab=people')
  const before = await page.getByTestId('person').count()
  await page.getByTestId('bulk-emails').fill(emails.join('\n'))
  await page.getByTestId('bulk-role').selectOption(role)
  await page.getByTestId('bulk-make').click()
  await expect(page.getByTestId('person')).not.toHaveCount(before)
  await expect(page.getByTestId('links-out')).toBeVisible()
  return parse(await page.getByTestId('links-out').innerText())
}

/** Pulls the `email → url` pairs out of whatever the block renders as. Matched as pairs rather
 *  than split by line: the rows carry a Copy button now, and where the browser puts its newlines
 *  inside a flex row is not a property this suite should be asserting. */
function parse(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/(\S+@\S+)\s+(\S*\/join\/[\w-]+)/g)) out.set(m[1], m[2])
  return out
}

/** A browser that has never been anywhere — the person who was forwarded the link, not the admin
 *  who made it. The admin's own session must play no part in whether a link works. */
async function stranger(browser: Browser) {
  const ctx = await browser.newContext()
  return { ctx, page: await ctx.newPage() }
}

test('the admin pastes emails and gets one link each; the link sets the password and signs them in', async ({ page, request, browser }) => {
  await signIn(page, 'admin')
  const links = await makeLinks(page, ['ada@example.com', 'grace@example.com'], 'reviewer')
  expect([...links.keys()].sort()).toEqual(['ada@example.com', 'grace@example.com'])

  // ⚠️ BEFORE. The account exists and has NO password, so nothing signs into it — asked of the
  // auth server directly rather than through the login form, which is rate limited at ten a minute
  // and is already close to that across this suite.
  expect(await passwordWorks(request, 'ada@example.com', 'a-long-enough-password')).toBe(false)

  const { ctx, page: them } = await stranger(browser)
  await them.goto(links.get('ada@example.com')!)
  await expect(them.getByText('ada@example.com')).toBeVisible()
  await them.getByTestId('new-password').fill('a-long-enough-password')
  await them.getByTestId('confirm-password').fill('a-long-enough-password')
  await them.getByTestId('save-password').click()
  // ⚠️ /review, NOT /tester — the role the admin chose for that address is what routes them, and
  // it is read back through a real sign-in rather than asserted about the request that made it.
  await expect(them).toHaveURL(/\/review$/)
  await expect(them.getByTestId('nothing-assigned')).toBeVisible()

  // AFTER: the password they chose is the one on file.
  expect(await passwordWorks(request, 'ada@example.com', 'a-long-enough-password')).toBe(true)

  // ⚠️ SINGLE USE. The same link, in a browser with nothing, is the same 404 as a link that never
  // existed — not a page saying it was already used, which would confirm that it once was.
  const second = await ctx.newPage()
  expect((await second.goto(links.get('ada@example.com')!))?.status()).toBe(404)
  await ctx.close()

  // Grace's link is untouched by Ada using hers.
  expect(links.get('grace@example.com')).toMatch(/\/join\/[\w-]{20,}$/)
})

test('the block survives a reload, and every line has its own Copy button', async ({ page }) => {
  await signIn(page, 'admin')
  const links = await makeLinks(page, ['perrow.one@example.com', 'perrow.two@example.com'], 'tester')

  // One row per person, each carrying that person's own URL — copying one line out of a single
  // blob by hand is exactly where the wrong link reaches the wrong person.
  await expect(page.getByTestId('link-row')).toHaveCount(2)
  await expect(page.getByTestId('copy-one')).toHaveCount(2)
  const theirRow = page.getByTestId('link-row').filter({ hasText: 'perrow.two@example.com' })
  await expect(theirRow).toContainText(links.get('perrow.two@example.com')!.replace(/^https?:\/\/[^/]+/, ''))

  /**
   * ⚠️ A RELOAD USED TO LOSE THEM FOR EVER — the table stores a hash, so nothing can print them a
   * second time, and the admin would be left with accounts nobody can reach. Asserted on the page
   * the admin comes back to, not on a variable this test is holding.
   */
  await page.reload()
  await expect(page.getByTestId('links-out')).toContainText('perrow.one@example.com')
  await expect(page.getByTestId('links-out')).toContainText(links.get('perrow.one@example.com')!.replace(/^https?:\/\/[^/]+/, ''))

  // And they go away when the admin says so, rather than lingering in a tab for the afternoon.
  await page.getByTestId('links-done').click()
  await expect(page.getByTestId('links-out')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('links-out')).toHaveCount(0)
})

test('a new link for somebody kills the one they were already holding', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const first = await makeLinks(page, ['supersede@example.com'], 'tester')
  const old = first.get('supersede@example.com')!

  // ⚠️ THE OLD LINK IS NEVER OPENED. If the test spent it first, "dead" would be explained by it
  // having been used, and the property under test — that ISSUING a new one kills the old — would
  // never be exercised. This is the fixture the previous code answers wrong: without the
  // supersede write, `old` below is still perfectly usable.
  // ⚠️ WAIT FOR THE BLOCK TO CHANGE, not merely to be visible. It is already on screen holding the
  // link we just made, so `toBeVisible()` is satisfied instantly and the value read back is the
  // OLD one — the assertion below then compares a string to itself and passes on any build.
  /**
   * ⚠️ WAIT FOR THE OLD TOKEN TO LEAVE THE SCREEN, not for "the text is different". `toHaveText`
   * normalises whitespace, so comparing it against a raw `innerText` snapshot is satisfied the
   * instant it is evaluated — by the newlines, not by anything changing — and the read below then
   * returns the STALE link and compares it to itself. It did exactly that.
   */
  const oldPath = old.replace(/^https?:\/\/[^/]+/, '')
  await page
    .getByTestId('person')
    .filter({ hasText: 'supersede' })
    .getByTestId('person-newlink')
    .click()
  await expect(page.getByTestId('links-out')).not.toContainText(oldPath)
  const fresh = parse(await page.getByTestId('links-out').innerText()).get('supersede@example.com')!
  expect(fresh).not.toBe(old)

  const { ctx, page: them } = await stranger(browser)
  expect((await them.goto(old))?.status()).toBe(404)

  await them.goto(fresh)
  await them.getByTestId('new-password').fill('second-password-456')
  await them.getByTestId('confirm-password').fill('second-password-456')
  await them.getByTestId('save-password').click()
  await expect(them).toHaveURL(/\/tester$/)
  await ctx.close()
})

test('a tester cannot make links; a known address is refused in words without losing the others; junk is a 404', async ({ page, browser }) => {
  await signIn(page, 'tester')
  // The same 404 a tester gets for every admin route — not a 403, which confirms the route is real.
  const denied = await page.request.post('/api/admin/links', { data: { emails: ['x@example.com'], role: 'admin' } })
  expect(denied.status()).toBe(404)

  await page.context().clearCookies()
  await signIn(page, 'admin')
  // ⚠️ A LIST WITH A BAD LINE IN THE MIDDLE. `dana@example.com` already has an account and `notanemail`
  // is not an address; the third one must still come back with a link, because the input is a list
  // somebody pasted and one typo must not cost the other forty their links.
  const links = await makeLinks(page, ['dana@example.com', 'notanemail', 'lovelace@example.com'], 'tester')
  expect([...links.keys()]).toEqual(['lovelace@example.com'])
  await expect(page.getByTestId('links-skipped')).toContainText('already has an account')
  await expect(page.getByTestId('links-skipped')).toContainText('not an email address')

  const nobody = await (await browser.newContext()).newPage()
  expect((await nobody.goto('/join/not-a-real-token'))?.status()).toBe(404)
})

test('the People list says who has not opened their link yet, and stops saying it once they have', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const links = await makeLinks(page, ['newjoin@example.com'], 'tester')

  const theirRow = page.getByTestId('person').filter({ hasText: 'newjoin' })
  await expect(theirRow.getByTestId('person-join')).toContainText('Not joined yet')
  /**
   * ⚠️ THE NUMBER, NOT JUST THE WORD "expires". A link is made with seven days on it, so a row
   * made a second ago has 6.99 left and must read **7**. Asserting only that the phrase appears
   * let an off-by-one ship that told the admin every fresh link died a day early — under-reporting
   * an expiry is the direction somebody plans around and gets wrong.
   */
  await expect(theirRow.getByTestId('person-join')).toContainText('link expires in 7 days')

  /**
   * ⚠️ THE FIXTURE THE NAIVE VERSION GETS WRONG. The admin account was made by hand and has no
   * link row at all. "No used link" and "has not joined" are the same condition for anybody who
   * arrived some other way, so a chip driven off the absence of a link would brand the one row the
   * admin is certain about — their own — as never having joined.
   */
  await expect(page.getByTestId('person').filter({ hasText: 'Harness Admin' }).getByTestId('person-join')).toHaveCount(0)

  const { ctx, page: them } = await stranger(browser)
  await them.goto(links.get('newjoin@example.com')!)
  await them.getByTestId('new-password').fill('a-long-enough-password')
  await them.getByTestId('confirm-password').fill('a-long-enough-password')
  await them.getByTestId('save-password').click()
  await expect(them).toHaveURL(/\/tester$/)
  await ctx.close()

  // ⚠️ ASSERTED AFTER A RELOAD, on the surface the admin actually looks at. The chip is server
  // rendered, so a check against the page still open from before the join would pass on a build
  // where `used_at` is never written.
  await page.goto('/admin?tab=people')
  await expect(page.getByTestId('person').filter({ hasText: 'newjoin' })).toBeVisible()
  await expect(page.getByTestId('person').filter({ hasText: 'newjoin' }).getByTestId('person-join')).toHaveCount(0)
})
