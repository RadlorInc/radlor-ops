import { expect, test } from '@playwright/test'
import { SUPABASE_URL } from './tokens'
import { signIn } from './signIn'

/** Reads rows out of the DATABASE, not off the page that just wrote them. */
async function rows(request: import('@playwright/test').APIRequestContext, table: string, q = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json()) as Record<string, string>[]
}

test.describe.configure({ mode: 'serial' })

test('a to-do can be added, renamed, advanced and reordered — and the row moves', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=todo')
  const list = page.getByTestId('todo-list')

  await page.getByTestId('todo-new').fill('Register the 1800 number')
  await page.getByTestId('todo-add').click()
  await expect(list.getByText('Register the 1800 number')).toBeVisible()

  const mine = page.getByTestId('todo-item').filter({ hasText: 'Register the 1800 number' })
  await mine.getByTestId('todo-status').selectOption('in_progress')
  await expect(mine).toHaveAttribute('data-status', 'in_progress')

  // The claim is about the DATABASE. A control that changes colour while the row does not is the
  // failure this whole style of test exists for.
  const statusInDb = async () =>
    (await rows(request, 'todos', '&task=eq.Register%20the%201800%20number'))[0]?.status
  await expect.poll(statusInDb).toBe('in_progress')

  /**
   * ⚠️ BACKWARDS, IN ONE MOVE — THE CASE THE OLD CONTROL COULD NOT DO. It was a button that cycled
   * not_started → in_progress → done → not_started, so "this is not finished after all" meant two
   * presses and a trip through `not_started` that the database really held on the way. Going
   * straight from done to in_progress is the assertion a cycling implementation fails, and going
   * only FORWARDS is the assertion it passes — which is why that is not the one written here.
   */
  await mine.getByTestId('todo-status').selectOption('done')
  await expect.poll(statusInDb).toBe('done')
  await mine.getByTestId('todo-status').selectOption('in_progress')
  await expect(mine).toHaveAttribute('data-status', 'in_progress')
  await expect.poll(statusInDb).toBe('in_progress')

  const before = await rows(request, 'todos', '&order=sort_order.asc')
  await mine.getByTestId('todo-up').click()
  await expect
    .poll(async () => (await rows(request, 'todos', '&order=sort_order.asc')).map((r) => r.task).join('|'))
    .not.toBe(before.map((r) => r.task).join('|'))
})

test('a done item reads as done, and the open count excludes it', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=todo')
  const done = page.getByTestId('todo-item').filter({ hasText: 'Pick a domain' })
  await expect(done).toHaveAttribute('data-status', 'done')
  await expect(done.getByTestId('todo-task')).toHaveClass(/strike/)
  // Open count is the number that matters; it must not count finished work.
  const total = await page.getByTestId('todo-item').count()
  await expect(page.getByTestId('todo-open-count')).toContainText(`of ${total}`)
  await expect(page.getByTestId('todo-open-count')).not.toContainText(`(${total} open`)
})

test('a TESTER is refused these tables by the route AND by the database', async ({ page, request }) => {
  await signIn(page, 'tester')
  expect((await page.goto('/admin'))?.status()).toBe(404)

  /**
   * ⚠️ `page.request`, NOT the standalone `request` fixture. They are different contexts and the
   * standalone one carries NO COOKIES — the first version of this test posted as a signed-out
   * stranger and called that "as a tester". It also passed for the wrong reason for a while,
   * because the route redirected a signed-out caller to /login and Playwright followed it to a
   * 200. Both were real: the test was asking the wrong question, and the route was answering the
   * wrong way. See `requireRoleApi`.
   */
  const res = await page.request.post('/api/admin/todo', { data: { task: 'should not land' } })
  expect(res.status()).toBe(404)
  const after = await rows(request, 'todos', '&task=eq.should%20not%20land')
  expect(after).toEqual([])
})

test('and a signed-OUT caller gets 404 from the API, not a redirect that reads as success', async ({ request }) => {
  const res = await request.post('/api/admin/todo', { data: { task: 'should not land either' } })
  expect(res.status()).toBe(404)
})

/**
 * ⚠️ THE "ISSUES APPEAR ON THE DASHBOARD, ACTION-NEEDED FIRST" SPEC IS DELETED, NOT MOVED. Its
 * subject was the admin Issues tab's collapsible status groups — open and ready-for-retest
 * expanded, resolved shut — and that tab is gone: it was `/tester` under a second name. `/tester`
 * has never had groups; it filters. Rewriting the assertion to fit the filter chips would have
 * been a new test wearing an old test's name and its record of having once caught something.
 *
 * The one half that survived the page is kept below, because it survived for a reason: an issue
 * with no reporter says so, and a triager needs to know whose issue they are moving.
 */
test('an admin triages from the issue list, and the row it names is the row that moves', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/tester')

  // ⚠️ THE UI PATH, NOT THE API. tester.spec.ts already proves the ROUTE lets an admin move a
  // status and refuses a tester. Neither of those would notice a <select> that is rendered and
  // wired to nothing, which is the whole of this control on the page it now lives on.
  const [target] = await rows(request, 'issues', '&status=eq.open&limit=1')
  const row = page
    .getByTestId('issue-item')
    .filter({ has: page.locator(`text=${String(target.description).slice(0, 24)}`) })
  await row.getByTestId('issue-status').selectOption('resolved')

  await expect
    .poll(async () => (await rows(request, 'issues', `&id=eq.${target.id}`))[0]?.status)
    .toBe('resolved')

  // The absence of a reporter is a fact, rendered as such — these rows came from the sheet and
  // will never have one.
  await expect(
    page.getByTestId('issue-reporter').filter({ hasText: 'imported from the sheet' }).first(),
  ).toBeVisible()
})

/**
 * ⚠️ A SUMMARY THAT SILENTLY DROPS ROWS IS WORSE THAN NO SUMMARY. The per-area meters are derived
 * — they group the to-do list — and that is one `.slice()` or one `reduce` away from quietly
 * leaving something out. Nothing else on the page would go red if it did: the list underneath
 * would still be complete and correct, and the number above it would just be wrong.
 *
 * ⚠️ THIS USED TO WATCH TWO PICTURES. The spend bar was the other, and it went with the costs tab.
 *
 * So the assertion is the ARITHMETIC, against the rendered list, not the presence of a bar.
 */
test('the meters account for every row they summarise', async ({ page }) => {
  await signIn(page, 'admin')

  await page.goto('/admin?tab=todo')

  // Every to-do is in exactly one area meter: the denominators must sum to the list length.
  const items = await page.getByTestId('todo-task').count()
  const counts = await page.getByTestId('area-progress').locator('.count').allInnerTexts()
  const totals = counts.map((c) => Number(c.split('/')[1]))
  expect(totals.length).toBeGreaterThan(0)
  expect(totals.reduce((a, b) => a + b, 0)).toBe(items)
})

/**
 * ⚠️ A SUMMARY THAT DISAGREES WITH THE THING IT SUMMARISES IS WORSE THAN NO SUMMARY, and this one
 * is newly able to: the per-section figures are computed inside the client components that own
 * those lists, and the Dashboard card recomputes the same numbers on the server from the same
 * data. Two computations of one number is exactly the shape that drifts — one gets a filter, the
 * other does not, and the card quietly reports a different tool.
 *
 * So the assertion is that the two AGREE, read from the two places a person would read them.
 * Nothing else here would fail if they stopped: each page is internally consistent and separately
 * plausible.
 */
test('the Dashboard cards agree with the tabs they summarise', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=summary')
  const todoCard = await page.getByTestId('summary-todo').innerText()
  const issuesCard = await page.getByTestId('summary-issues').innerText()

  await page.goto('/admin?tab=todo')
  // "3 open of 4" on the card, "3 open of 4" on the tab — same two numbers, either order of words.
  const todoTab = await page.getByTestId('todo-open-count').innerText()
  expect(todoCard.match(/\d+/g)).toEqual(todoTab.match(/\d+/g))

  /**
   * ⚠️ COUNTED OFF THE LIST, NOT READ OFF A SECOND CAPTION. The admin Issues tab had an
   * "N needing something of M" line to compare against; it was deleted with the tab. Counting the
   * rendered rows is the stronger comparison anyway — the card now has to agree with the issues
   * themselves rather than with another sentence that could be wrong in the same way.
   */
  await page.goto('/tester')
  const all = await page.getByTestId('issue-item').count()
  const resolved = await page.locator('[data-testid="issue-item"][data-status="resolved"]').count()
  expect(issuesCard.match(/\d+/g)).toEqual([String(all - resolved), String(all)])
})
