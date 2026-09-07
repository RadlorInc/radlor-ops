import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/**
 * THE TO-DO LIST FILTERS BY STATUS, AND THE METERS ABOVE IT DO NOT.
 *
 * ⚠️ THE SECOND HALF IS THE HALF WORTH HAVING. Filtering a list is three lines and hard to get
 * wrong; the mistake this catches is the tidy-looking one — recomputing the area meters over the
 * VISIBLE rows, which turns every filter into "3 of 3 done" and makes the summary a picture of the
 * filter rather than of the work. A spec that only asserted "the rows narrowed" would pass on that
 * build, and the meters are the number an admin plans around.
 *
 * ⚠️ AND IT ASSERTS AFTER THE CLICK. A filter's defect lives in the filtered state; every
 * assertion here is made with a filter on, not on the list as it loads.
 */
test('filtering narrows the rows and leaves the meters counting everything', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=todo')

  const rows = page.getByTestId('todo-item')
  const total = await rows.count()
  expect(total).toBeGreaterThan(1)

  // The meters' denominators sum to the WHOLE list. Read before, and read again after filtering:
  // the same two numbers, which is the property the filter must not touch.
  const denominators = async () =>
    (await page.getByTestId('area-progress').locator('.count').allInnerTexts())
      .map((c) => Number(c.split('/')[1]))
      .reduce((a, b) => a + b, 0)
  expect(await denominators()).toBe(total)

  await page.getByTestId('todo-filter-done').click()

  // ⚠️ NOT "fewer rows" — a count. "Fewer" passes on a filter that drops everything.
  const done = page.locator('[data-testid="todo-item"][data-status="done"]')
  const doneCount = await done.count()
  expect(doneCount).toBeGreaterThan(0)
  expect(doneCount).toBeLessThan(total)
  await expect(rows).toHaveCount(doneCount)
  await expect(page.getByTestId('todo-shown-count')).toHaveText(`${doneCount} of ${total}`)

  // The meters still describe the whole list, with the filter on.
  expect(await denominators()).toBe(total)

  // ⚠️ REORDERING IS WITHDRAWN, NOT LEFT LOOKING USABLE. "Up" swaps with the row above in the FULL
  // order — under a filter that is a row nobody can see, so the button could not mean what it
  // looks like. Both must be true: the arrows are gone AND the page says why.
  await expect(page.getByTestId('todo-up')).toHaveCount(0)
  await expect(page.getByTestId('todo-reorder-off')).toBeVisible()

  await page.getByTestId('todo-filter-all').click()
  await expect(rows).toHaveCount(total)
  await expect(page.getByTestId('todo-up').first()).toBeVisible()
  await expect(page.getByTestId('todo-reorder-off')).toHaveCount(0)
})
