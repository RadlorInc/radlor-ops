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

test('a renewal three days out does not look like one two months out', async ({ page }) => {
  await signIn(page, 'admin')
  const soon = page.getByTestId('cost-row').filter({ hasText: 'Higgsfield' })
  const later = page.getByTestId('cost-row').filter({ hasText: 'Vercel' })

  // The states must DIFFER — a table where everything renders the same is a table with dates in it.
  await expect(soon).toHaveAttribute('data-renewal', 'soon')
  await expect(later).toHaveAttribute('data-renewal', 'ok')
  await expect(soon.getByTestId('renewal-pill')).toHaveText('in 3d')
})

test('a typed number is labelled as typed, never as refreshed', async ({ page }) => {
  await signIn(page, 'admin')
  const fresh = page.getByTestId('credits-freshness').first()
  await expect(fresh).toContainText('you typed this')
  await expect(fresh).not.toContainText('refreshed')
})

test('the monthly total adds up the rows it shows', async ({ page }) => {
  await signIn(page, 'admin')
  await expect(page.getByTestId('monthly-total')).toContainText('49.00') // 29 + 20 + 0
  await expect(page.getByTestId('monthly-total')).toContainText('across 3')
})

test('adding a subscription writes a row and marks it typed, not fetched', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.getByTestId('cost-add').click()
  await page.getByTestId('cost-tool').fill('ElevenLabs')
  await page.getByTestId('cost-monthly_cost').fill('11')
  await page.getByTestId('cost-save').click()
  await expect(page.getByTestId('cost-row').filter({ hasText: 'ElevenLabs' })).toBeVisible()

  const [row] = await rows(request, 'subscriptions', '&tool=eq.ElevenLabs')
  expect(row).toBeTruthy()
  expect(Number(row.monthly_cost)).toBe(11)
  // ⚠️ A hand-typed number may never claim to be an API reading.
  expect(row.credits_source).toBe('manual')
})

test('a to-do can be added, renamed, advanced and reordered — and the row moves', async ({ page, request }) => {
  await signIn(page, 'admin')
  const list = page.getByTestId('todo-list')

  await page.getByTestId('todo-new').fill('Register the 1800 number')
  await page.getByTestId('todo-add').click()
  await expect(list.getByText('Register the 1800 number')).toBeVisible()

  const mine = page.getByTestId('todo-item').filter({ hasText: 'Register the 1800 number' })
  await mine.getByTestId('todo-status').click()
  await expect(mine).toHaveAttribute('data-status', 'in_progress')

  // The claim is about the DATABASE. A chip that changes colour while the row does not is the
  // failure this whole style of test exists for.
  await expect
    .poll(async () => (await rows(request, 'todos', '&task=eq.Register%20the%201800%20number'))[0]?.status)
    .toBe('in_progress')

  const before = await rows(request, 'todos', '&order=sort_order.asc')
  await mine.getByTestId('todo-up').click()
  await expect
    .poll(async () => (await rows(request, 'todos', '&order=sort_order.asc')).map((r) => r.task).join('|'))
    .not.toBe(before.map((r) => r.task).join('|'))
})

test('a done item reads as done, and the open count excludes it', async ({ page }) => {
  await signIn(page, 'admin')
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

test('a duplicate tool says so instead of failing blankly, and edit exists so nobody has to retry', async ({ page }) => {
  await signIn(page, 'admin')
  await page.getByTestId('cost-add').click()
  await page.getByTestId('cost-tool').fill('Higgsfield')   // already in the seed
  await page.getByTestId('cost-credits_remaining').fill('19973')
  await page.getByTestId('cost-save').click()

  const err = page.getByTestId('cost-error')
  await expect(err).toBeVisible()
  // Names the thing and says what to do — not "check the numbers".
  await expect(err).toContainText('Higgsfield')
  await expect(err).toContainText('Edit that one')
  await expect(err).not.toContainText('Check the numbers')
})

test('a thousands separator is a number, not an error', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.getByTestId('cost-add').click()
  await page.getByTestId('cost-tool').fill('Runway')
  await page.getByTestId('cost-credits_remaining').fill('19,973')
  await page.getByTestId('cost-save').click()
  await expect(page.getByTestId('cost-row').filter({ hasText: 'Runway' })).toBeVisible()

  const [row] = await rows(request, 'subscriptions', '&tool=eq.Runway')
  expect(Number(row.credits_remaining)).toBe(19973)
})

test('a bad number names its own field', async ({ page }) => {
  await signIn(page, 'admin')
  await page.getByTestId('cost-add').click()
  await page.getByTestId('cost-tool').fill('Whatever')
  await page.getByTestId('cost-monthly_cost').fill('twelve pounds')
  await page.getByTestId('cost-save').click()
  await expect(page.getByTestId('cost-error')).toContainText('Monthly cost must be a number')
})

test('editing a subscription updates the row rather than adding a second one', async ({ page, request }) => {
  await signIn(page, 'admin')
  const before = (await rows(request, 'subscriptions')).length
  const target = page.getByTestId('cost-row').filter({ hasText: 'Higgsfield' })
  await target.getByTestId('cost-edit').click()
  await page.getByTestId('cost-credits_remaining').fill('19973')
  await page.getByTestId('cost-save').click()

  await expect
    .poll(async () => Number((await rows(request, 'subscriptions', '&tool=eq.Higgsfield'))[0]?.credits_remaining))
    .toBe(19973)
  // The count must not move — an "edit" that inserts is the bug that started this.
  expect((await rows(request, 'subscriptions')).length).toBe(before)
})

test('tester issues appear on the dashboard, action-needed first, with null reporters named as imported', async ({ page }) => {
  await signIn(page, 'admin')
  await expect(page.getByTestId('issues-count')).toContainText('needing something')

  /**
   * ⚠️ UNCONDITIONAL. The first version wrapped each of these in `if (await group.count())` — and
   * the seed had no RESOLVED issue, so the one assertion that mattered never ran and the check
   * passed against a build where every group started expanded. A guard that can skip the assertion
   * is the same disease as a filter that can only match rows already satisfying it.
   */
  const openState = async (status: string) =>
    page.getByTestId(`issue-group-${status}`).evaluate((e: HTMLDetailsElement) => e.open)
  expect(await openState('open')).toBe(true)
  expect(await openState('ready_for_retest')).toBe(true)
  expect(await openState('resolved')).toBe(false)   // the two that need action are not buried under it

  // The absence is the fact, rendered as such.
  await expect(page.getByTestId('issue-reporter').filter({ hasText: 'imported from the sheet' }).first()).toBeVisible()
})

test('an admin can move an issue to resolved from the dashboard, and the row moves too', async ({ page, request }) => {
  await signIn(page, 'admin')
  const [target] = await rows(request, 'issues', '&status=eq.open&limit=1')
  const row = page.getByTestId('admin-issue').filter({ has: page.locator(`text=${String(target.description).slice(0, 24)}`) })
  await row.getByTestId('admin-issue-status').selectOption('resolved')

  await expect
    .poll(async () => (await rows(request, 'issues', `&id=eq.${target.id}`))[0]?.status)
    .toBe('resolved')
})
