import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/**
 * CHANGING WHAT SOMEBODY IS, AND REMOVING THEM ALTOGETHER.
 *
 * Rafi, 2026-09-10: only he should be able to remove a person, and there should be a way to change
 * somebody's role.
 *
 * ⚠️ NOT ONE OF THESE TESTS TOUCHES A SEEDED PERSON. Dana, Flood, the harness admin and the harness
 * tester are read by a dozen other specs; demoting or deleting one would make those pass or fail on
 * which file ran first, which is the failure this repo has already paid for twice. Every test below
 * creates the person it is about, through the paste box that is the real way people arrive.
 *
 * ⚠️ AND THE FIXTURE FOR "REMOVING SOMEBODY DESTROYS THEIR WORK" IS BUILT, NOT BORROWED. A note is
 * written for the throwaway person directly through PostgREST — the same door `test/seed.sql` uses
 * — because the assertion is about a database cascade, and a person with no notes proves nothing
 * about it. `quiet-draft` carries it: a draft nobody reviews, whose note count nothing asserts.
 */

const QUIET_DRAFT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function db(request: import('@playwright/test').APIRequestContext, path: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { 'Accept-Profile': 'review' } })
  return (await res.json()) as Record<string, string>[]
}

/** Adds one person through the People tab and hands back their user_id. */
async function addPerson(page: import('@playwright/test').Page, email: string, role: string): Promise<string> {
  await page.goto('/admin?tab=people')
  const before = await page.getByTestId('person').count()
  await page.getByTestId('bulk-emails').fill(email)
  await page.getByTestId('bulk-role').selectOption(role)
  await page.getByTestId('bulk-make').click()
  await expect(page.getByTestId('person')).not.toHaveCount(before)
  const name = email.split('@')[0]
  await expect(page.getByTestId('person').filter({ hasText: name })).toHaveCount(1)
  const [row] = await db(page.request, `profiles?select=user_id&name=eq.${name}`)
  return row.user_id
}

test('a role can be changed from the list, and the change is in the row not just on screen', async ({ page }) => {
  await signIn(page, 'admin')
  const id = await addPerson(page, 'roleswap@example.com', 'tester')
  const row = page.getByTestId('person').filter({ hasText: 'roleswap' })

  await expect(row).toHaveAttribute('data-role', 'tester')
  await row.getByTestId('person-role').selectOption('reviewer')
  await expect(row).toHaveAttribute('data-role', 'reviewer')

  // ⚠️ READ BACK OUT OF THE DATABASE. A select that updates its own displayed value while the row
  // stays put is the exact failure this whole spec exists for.
  const [after] = await db(page.request, `profiles?select=role&user_id=eq.${id}`)
  expect(after.role).toBe('reviewer')
})

test('demoting an approver to tester takes the approval away with it', async ({ page }) => {
  await signIn(page, 'admin')
  const id = await addPerson(page, 'wasapprover@example.com', 'reviewer')
  const row = page.getByTestId('person').filter({ hasText: 'wasapprover' })

  await row.getByTestId('person-approve').click()
  await expect(row).toHaveAttribute('data-approver', 'yes')

  /**
   * ⚠️ A TESTER WHO IS STILL FLAGGED AS AN APPROVER IS ASKED FOR VERDICTS THEY CANNOT GIVE — their
   * surface 404s, so every cut uploaded afterwards waits on somebody who cannot answer and nothing
   * ever clears. The flag has to come off in the same act as the demotion.
   */
  await row.getByTestId('person-role').selectOption('tester')
  await expect(row).toHaveAttribute('data-role', 'tester')
  await expect(row).toHaveAttribute('data-approver', 'no')

  const [after] = await db(page.request, `profiles?select=role,can_approve&user_id=eq.${id}`)
  expect(after.role).toBe('tester')
  expect(after.can_approve).toBe(false)
})

/**
 * ⚠️ THE TWO REFUSALS ARE ASSERTED APART, AND THE FIRST VERSION OF THIS TEST COULD NOT TELL THEM
 * APART. It aimed both at the harness admin — who is BOTH the caller and the owner — so a build
 * with the not-yourself rule deleted still answered 400, from the owner rule, and the check passed
 * on it. break-check said so in as many words: "PASSED on the broken state". Deputy Admin is an
 * admin and is not the owner, which is the only fixture on which the two rules give different
 * answers, and the error code is asserted rather than just the status.
 */
test('your own row cannot be re-roled, and neither can the owner’s — for different reasons', async ({ page, browser }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')

  // Disabled, not hidden: the rule should be visible rather than mysterious.
  const mine = page.getByTestId('person').filter({ hasText: 'Harness Admin' })
  await expect(mine.getByTestId('person-owner')).toBeVisible()
  await expect(mine.getByTestId('person-role')).toBeDisabled()

  /**
   * ⚠️ THROUGH THE ROUTE, BECAUSE A DISABLED CONTROL IS A RENDERING DECISION. A build that only
   * greyed the select out would pass every assertion above and still accept the request.
   */
  const other = await browser.newContext()
  try {
    const theirs = await other.newPage()
    await signIn(theirs, 'admin2')   // 'Deputy Admin' — an admin, and not the owner

    const own = await theirs.request.patch('/api/admin/people', { data: { user_id: USERS.deputy, role: 'tester' } })
    expect(own.status()).toBe(400)
    expect(((await own.json()) as { error: string }).error).toBe('not_yourself')

    const owner = await theirs.request.patch('/api/admin/people', { data: { user_id: USERS.harnessAdmin, role: 'tester' } })
    expect(owner.status()).toBe(400)
    expect(((await owner.json()) as { error: string }).error).toBe('owner')
  } finally {
    await other.close()
  }

  // Neither attempt moved anything.
  expect((await db(page.request, `profiles?select=role&user_id=eq.${USERS.harnessAdmin}`))[0].role).toBe('admin')
  expect((await db(page.request, `profiles?select=role&user_id=eq.${USERS.deputy}`))[0].role).toBe('admin')

  // And the positive control: the same request shape, aimed at somebody it is allowed to move.
  const id = await addPerson(page, 'movable@example.com', 'tester')
  const ok = await page.request.patch('/api/admin/people', { data: { user_id: id, role: 'reviewer' } })
  expect(ok.status()).toBe(200)
})

test('only the owner can remove somebody — the other admin sees no button and is refused', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const id = await addPerson(page, 'staying@example.com', 'reviewer')

  /**
   * ⚠️ THE WHOLE POINT OF THE `Deputy Admin` FIXTURE. This is an admin — /admin opens, every other
   * control on this tab works for them — and they are not the owner. A build where any admin can
   * remove people passes every other assertion in this file and fails only here.
   */
  const other = await browser.newContext()
  try {
    const theirs = await other.newPage()
    await signIn(theirs, 'admin2')   // 'Deputy Admin' — an admin, and not the owner
    await theirs.goto('/admin?tab=people')
    // They can see the list and change roles, so this is not "the page did not load".
    await expect(theirs.getByTestId('person').first()).toBeVisible()
    await expect(theirs.getByTestId('person-remove')).toHaveCount(0)

    // 404, not 403: nothing confirms to them that a control they cannot use exists.
    const refused = await theirs.request.delete('/api/admin/people', { data: { user_id: id } })
    expect(refused.status()).toBe(404)
  } finally {
    await other.close()
  }

  // Still there, and the owner's own view does offer the button — the control that makes the
  // refusal above mean "not you" rather than "not anybody".
  expect((await db(page.request, `profiles?select=user_id&user_id=eq.${id}`)).length).toBe(1)
  await page.goto('/admin?tab=people')
  await expect(page.getByTestId('person').filter({ hasText: 'staying' }).getByTestId('person-remove')).toBeVisible()
})

test('the owner removes somebody: two presses, the inventory is true, and their notes go too', async ({ page }) => {
  await signIn(page, 'admin')
  const id = await addPerson(page, 'leaving@example.com', 'reviewer')

  // Fixture: one note of theirs, written the way the seed writes one. Without it the cascade is
  // unprovable — "no notes remain" is already true of somebody who never wrote any.
  const wrote = await page.request.post(`${SUPABASE_URL}/rest/v1/notes`, {
    headers: { 'Content-Profile': 'review', Prefer: 'return=representation' },
    data: { video_id: QUIET_DRAFT, reviewer_id: id, t_seconds: 5, body: 'a note by somebody about to be removed', video_version: 1 },
  })
  expect(wrote.status()).toBe(201)
  expect((await db(page.request, `notes?select=id&reviewer_id=eq.${id}`)).length).toBe(1)

  await page.goto('/admin?tab=people')
  const row = page.getByTestId('person').filter({ hasText: 'leaving' })
  await row.getByTestId('person-remove').click()

  // ⚠️ THE CONFIRM HAS TO NAME WHAT IT DESTROYS, WITH THE REAL NUMBER. "Are you sure?" is the
  // version people click through, and the notes are the unrecoverable half.
  const confirm = row.getByTestId('person-remove-confirm')
  await expect(confirm).toContainText('1 note')
  await expect(confirm).toContainText('cannot be undone')
  // And it must say what SURVIVES, or it reads as "everything they ever did" — issues are kept
  // (`issues.reporter` is `on delete set null`).
  await expect(confirm).toContainText('problems they filed stay')

  // The first press must not delete. A one-press and a two-press control look identical afterwards.
  expect((await db(page.request, `profiles?select=user_id&user_id=eq.${id}`)).length).toBe(1)

  await row.getByTestId('person-remove-really').click()
  await expect(page.getByTestId('person').filter({ hasText: 'leaving' })).toHaveCount(0)

  // The account, not just the profile row: deleting only the profile leaves something that can
  // still sign in and has no role, which lands on /login for ever with nothing to explain why.
  expect((await db(page.request, `profiles?select=user_id&user_id=eq.${id}`)).length).toBe(0)
  // Their note went with them, by cascade.
  expect((await db(page.request, `notes?select=id&reviewer_id=eq.${id}`)).length).toBe(0)
})
