import { expect, test } from '@playwright/test'
import { SUPABASE_URL } from './tokens'
import { signIn } from './signIn'

async function rows(request: import('@playwright/test').APIRequestContext, table: string, q = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json()) as Record<string, unknown>[]
}

test.describe.configure({ mode: 'serial' })

test('the form has no date field and no hours field, and filing sets both itself', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')

  /**
   * ⚠️ THE ABSENCE IS THE ASSERTION. The sheet had testers typing a date — in two formats, with one
   * row missing it — and a `Working Record` tab for hours that held ZERO rows from the day it was
   * created. Neither field exists here; both are captured.
   */
  await expect(page.getByTestId('issue-form')).toBeVisible()
  await expect(page.locator('[data-testid="issue-form"] input[type="date"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="issue-form"]').getByText(/hours/i)).toHaveCount(0)

  const before = await rows(request, 'testing_sessions')
  await page.getByTestId('issue-description').fill('The repeat button is missing on the nest game')
  await page.getByTestId('issue-area').fill('Nest game')
  await page.getByTestId('issue-type').fill('missing control')
  await page.getByTestId('issue-chapter').fill('1')
  await page.getByTestId('issue-age').selectOption('3-5')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('repeat button is missing')

  const [filed] = await rows(request, 'issues', '&area=eq.Nest%20game')
  expect(filed).toBeTruthy()
  expect(filed.type).toBe('missing control')   // the two columns are separately populated
  expect(filed.chapter).toBe('1')
  expect(filed.all_chapters).toBe(false)
  expect(filed.age_band).toBe('3-5')
  expect(String(filed.created_at).slice(0, 4)).toMatch(/^20\d\d$/)   // set on submit

  // The Working Record, captured rather than typed. The row is written by the POST; the summary
  // is server-rendered, so it appears on the next load — asserted after a reload rather than
  // pretending it is instant.
  const after = await rows(request, 'testing_sessions')
  expect(after.length).toBeGreaterThan(before.length)
  await page.reload()
  await expect(page.getByTestId('working-record')).toContainText('Captured from when you file')
})

test('filing again extends the same session rather than starting a new one', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')
  const before = await rows(request, 'testing_sessions')

  await page.getByTestId('issue-description').fill('Second issue in the same sitting')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('same sitting')

  const after = await rows(request, 'testing_sessions')
  // Same count — a sitting is one session. A new row per issue would make "hours" meaningless.
  expect(after.length).toBe(before.length)
  expect(Number(after[0].issue_count)).toBeGreaterThan(Number(before[0].issue_count))
})

test('"all chapters" is a scope, not a chapter', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')
  await page.getByTestId('issue-description').fill('Every heading uses "shall"')
  await page.getByTestId('issue-chapter').fill('7')
  await page.getByTestId('issue-all-chapters').check()
  // Ticking it clears and disables the chapter box — the two cannot both be set.
  await expect(page.getByTestId('issue-chapter')).toBeDisabled()
  await expect(page.getByTestId('issue-chapter')).toHaveValue('')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('Every heading uses')

  /**
   * ⚠️ THE NEWEST ISSUE, NOT "the newest row WHERE all_chapters IS TRUE".
   * The first version filtered on `all_chapters=eq.true` — the very property under test — so when
   * the flag was broken it simply selected the seed's imported all-chapters row instead and passed.
   * A filter that can only return rows already satisfying the assertion is not a query, it is a
   * way of not looking.
   */
  const [row] = await rows(request, 'issues', '&order=created_at.desc&limit=1')
  expect(row.all_chapters).toBe(true)
  expect(row.chapter).toBe(null)
})

test('the reporter comes from the session, never from the request body', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')

  // Post a reporter the client has no business naming. It must be ignored — and `issues_insert_own`
  // would refuse it at the database anyway, which is the belt to this braces.
  const res = await page.request.post('/api/tester/issue', {
    data: {
      description: 'filed with someone else in the reporter field',
      reporter: '55555555-5555-4555-8555-555555555555', // the harness ADMIN's id
    },
  })
  expect(res.status()).toBe(201)

  const [row] = await rows(request, 'issues', '&order=created_at.desc&limit=1')
  expect(row.description).toContain('someone else in the reporter field')
  expect(row.reporter).toBe('66666666-6666-4666-8666-666666666666') // the harness TESTER's id
})

test('a TESTER cannot move a status; an ADMIN can — and the row proves it', async ({ page, browser, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')
  // A tester sees the state, but not a control to change it.
  await expect(page.getByTestId('issue-status').first()).toBeVisible()
  await expect(page.locator('[data-testid="issue-list"] select')).toHaveCount(0)

  const [target] = await rows(request, 'issues', '&status=eq.open&limit=1')
  const res = await page.request.patch('/api/tester/issue', {
    data: { id: target.id, status: 'resolved' },
  })
  expect(res.status()).toBe(404)
  const [unchanged] = await rows(request, 'issues', `&id=eq.${target.id}`)
  expect(unchanged.status).toBe('open')

  /**
   * ⚠️ THE POSITIVE CONTROL. Without it, "the tester was refused" is equally consistent with a
   * route that refuses everyone and a status nothing can ever change.
   */
  const ctx = await browser.newContext()
  const admin = await ctx.newPage()
  await signIn(admin, 'admin')
  const ok = await admin.request.patch('/api/tester/issue', {
    data: { id: target.id, status: 'resolved' },
  })
  expect(ok.status()).toBe(200)
  const [changed] = await rows(request, 'issues', `&id=eq.${target.id}`)
  expect(changed.status).toBe('resolved')
  await ctx.close()
})

/**
 * ⚠️ "A TESTER SEES ONLY THEIR OWN ISSUES" IS NOT TESTED HERE, AND CANNOT BE.
 * That property is `issues_read_own`, an RLS policy — and PGlite runs as one superuser with no role
 * switching, so every policy in this schema is invisible to this harness by construction. A version
 * of this test did exist and failed for exactly that reason: the stand-in handed the tester every
 * row, because there is nothing there to stop it.
 *
 * Writing it anyway with a workaround would be worse than not having it: it would report green on a
 * property nothing offline can observe. It is verified against the live project instead, by
 * `scripts/check-tester-cannot-read-admin.mjs`, with the same two controls.
 *
 * What IS testable here, and is tested above, is the app's half: a tester gets no status control and
 * the route refuses their PATCH with a 404 while an admin's succeeds.
 */

/**
 * ⚠️ BOTH HALVES, BECAUSE EITHER ONE ALONE IS THE WRONG FEATURE. A list that suggests nothing is
 * the free-text field we are replacing; a list that only ACCEPTS its own options is a restriction
 * nobody asked for, and the first person with a genuinely new area either gets stuck or hides it
 * in the description where nothing can group it.
 *
 * ⚠️ THE PROPERTY THAT MATTERS MOST IS NOT ASSERTED HERE, AND CANNOT BE. "The suggestions include
 * values from rows this tester cannot read" is the whole reason the list is built with the service
 * key — and PGlite runs as one superuser with no policies, so offline the tester sees every issue
 * anyway and a list of everyone's values is indistinguishable from a list of their own. An
 * assertion here would go green on a build where the vocabulary was scoped to the caller, which is
 * the exact bug. It is in the handoff's unverified list, where the other RLS-shaped facts live.
 */
test('the area field suggests what other people already typed, and still takes a new value', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')

  /**
   * ⚠️ ASKED OF THE INPUT, NOT OF THE `<datalist>`. Reading `#area-options option` directly passed
   * with `list=` deleted from the input — a list rendered on the page and attached to nothing,
   * which is a suggestion no user is ever offered. `HTMLInputElement.list` is the BROWSER
   * resolving the association, so a null here is the wiring being gone rather than the markup
   * being different from what I expected.
   */
  const areaOptions = () =>
    page.getByTestId('issue-area').evaluate((el) => {
      const dl = (el as HTMLInputElement).list
      return dl ? [...dl.options].map((o) => o.value) : null
    })
  expect(await areaOptions()).toContain('Smallest first game')

  // ⚠️ And a value that is in no list still files. This is the half that stops the fix becoming a
  // cage: `type` gets one nobody has used.
  await page.getByTestId('issue-description').fill('a brand new kind of problem')
  await page.getByTestId('issue-area').fill('Weighing scales')
  await page.getByTestId('issue-type').fill('measurement')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('a brand new kind of problem')

  const [row] = await rows(request, 'issues', '&description=eq.a%20brand%20new%20kind%20of%20problem')
  expect(row.area).toBe('Weighing scales')
  expect(row.type).toBe('measurement')

  // And the new value joins the list for whoever files next — that is the convergence working.
  await page.reload()
  expect(await areaOptions()).toContain('Weighing scales')
})
