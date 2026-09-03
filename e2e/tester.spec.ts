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
  await page.getByTestId('issue-type').selectOption('Something missing')
  await page.getByTestId('issue-chapter').fill('1')
  await page.getByTestId('issue-age').selectOption('3-5')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('repeat button is missing')

  const [filed] = await rows(request, 'issues', '&area=eq.Nest%20game')
  expect(filed).toBeTruthy()
  expect(filed.type).toBe('Something missing')   // the two columns are separately populated
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
  /**
   * ⚠️ THE WORDING IS ASSERTED, WRITTEN OUT, NOT IMPORTED. Rafi filed "the app is lagging" against
   * `ch 1` — the definition of an all-chapters issue — because the control was an unlabelled box
   * with "all chapters" beside it, which reads as a scope FILTER rather than a question about this
   * issue. The mechanism below was already right and already checked; the words were the defect.
   * So they are a decision now: changing them takes an edit here too, and the red in between is
   * the reminder that somebody got this exact control wrong once.
   */
  await expect(page.getByTestId('issue-scope')).toContainText('Not about one chapter')
  await expect(page.getByTestId('scope-hint')).toContainText('happens all over the app')
  await expect(page.getByTestId('scope-hint')).toContainText('lagging')

  await page.getByTestId('issue-all-chapters').check()
  // Ticking it clears and disables the chapter box — the two cannot both be set. And the box says
  // WHY it is disabled instead of going quietly grey.
  await expect(page.getByTestId('issue-chapter')).toBeDisabled()
  await expect(page.getByTestId('issue-chapter')).toHaveValue('')
  await expect(page.getByTestId('issue-chapter')).toHaveAttribute('placeholder', 'chapter not needed')
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

test('the kind of problem is a fixed list, and "Other…" takes whatever is typed', async ({ page, request }) => {
  await signIn(page, 'tester')
  await page.goto('/tester')

  /**
   * ⚠️ THE LIST IS WRITTEN OUT HERE, NOT IMPORTED. Rafi's call on 2026-09-03: a tester picks from
   * the kinds of thing that actually go wrong in a children's app, and "Other…" opens a box for
   * the case the list forgot. Changing an option takes an edit here too; the red in between is the
   * reminder that the words are a decision. This replaced a field that suggested whatever anybody
   * had typed before — which read as a half-built dropdown with nothing to pick.
   */
  const options = await page
    .getByTestId('issue-type')
    .evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.textContent))
  expect(options).toEqual([
    'choose…',
    'Wording',
    'Wrong answer marked',
    'Too hard for the age',
    'Too easy for the age',
    'Sound or voice',
    'Pictures or layout',
    'Button does not work',
    'Slow or freezes',
    'App crashed',
    'Progress not saved',
    'Something missing',
    'Other…',
  ])

  // `area` offers nothing — `HTMLInputElement.list` is the browser resolving the association, so a
  // null here means no suggestion is wired, not merely that an element with some id is absent.
  expect(await page.getByTestId('issue-area').evaluate((el) => (el as HTMLInputElement).list)).toBeNull()

  // The free-text box exists only once "Other…" is chosen — the state the defect would live in.
  await expect(page.getByTestId('issue-type-other')).toHaveCount(0)
  await page.getByTestId('issue-description').fill('a brand new kind of problem')
  await page.getByTestId('issue-area').fill('Weighing scales')
  await page.getByTestId('issue-type').selectOption('other')
  await page.getByTestId('issue-type-other').fill('calibration')
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('a brand new kind of problem')

  // ⚠️ The row by its description, then the property — never `?type=eq.calibration`.
  const [row] = await rows(request, 'issues', '&description=eq.a%20brand%20new%20kind%20of%20problem')
  expect(row.area).toBe('Weighing scales')
  expect(row.type).toBe('calibration')

  // And a listed kind files as its own words, not as "other".
  await page.getByTestId('issue-description').fill('the narrator cuts out on the second screen')
  await page.getByTestId('issue-type').selectOption('Sound or voice')
  await expect(page.getByTestId('issue-type-other')).toHaveCount(0)
  await page.getByTestId('issue-submit').click()
  await expect(page.getByTestId('issue-list')).toContainText('narrator cuts out')
  const [second] = await rows(request, 'issues', '&description=eq.the%20narrator%20cuts%20out%20on%20the%20second%20screen')
  expect(second.type).toBe('Sound or voice')
})
