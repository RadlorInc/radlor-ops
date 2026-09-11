import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/**
 * THE TEACHER ROLE: SOURCE MATERIAL, AND NOTHING ELSE.
 *
 * Rafi, 2026-09-11: whoever has the teacher role has access to source material.
 *
 * ⚠️ HALF OF THESE TESTS ARE REFUSALS, AND EVERY REFUSAL HAS A POSITIVE CONTROL. "A teacher gets 404
 * on /admin" is satisfied by a build where /admin 404s for everybody; it only means "roles gate the
 * surface" while an admin, in another session, still gets 200 from the same URL.
 *
 * ⚠️ WHAT THIS FILE CANNOT SEE, SAID BEFORE ANYTHING ELSE. The one production-only hazard in this
 * change is that a teacher can read only their OWN profile row, so an as-the-user lookup of "who
 * added this" would label every admin upload "somebody since removed". PGlite is a single superuser
 * with no policies, so here that lookup returns every row regardless and a name assertion passes on
 * the broken build. It is handled by construction — `namesById()` reads with the service key — and
 * NOT by a test in this file. Do not read a green name assertion below as coverage of it.
 */

async function db(request: import('@playwright/test').APIRequestContext, path: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { 'Accept-Profile': 'review' } })
  return (await res.json()) as Record<string, string | boolean>[]
}

test('a teacher signs in through the form and lands on Source material', async ({ page }) => {
  // ⚠️ `fresh`: through the real login form, because where the ROUTE sends you is the property.
  // The cached path navigates to /source itself and would pass on a build that sent teachers anywhere.
  await signIn(page, 'teacher', { fresh: true })
  await expect(page).toHaveURL(/\/source$/)
  await expect(page.locator('[data-testid="subject-group"][data-subject="science"]')).toBeVisible()
  await expect(page.locator('[data-testid="subject-group"][data-subject="maths"]')).toBeVisible()
})

/**
 * ⚠️ THE LOGIN PAGE HAD ITS OWN COPY OF THE ROUTING, AND IT SENT UNKNOWN ROLES TO /tester. A
 * signed-in person who opens /login is redirected to their home — and before this change that
 * redirect was a ternary ending `: '/tester'`, so a teacher would have been bounced to a page that
 * 404s them. This is the one place that path is exercised.
 */
test('a signed-in teacher who opens /login is sent to Source material, not to a page that refuses them', async ({ page }) => {
  await signIn(page, 'teacher')
  await page.goto('/login')
  await expect(page).toHaveURL(/\/source$/)
})

test('a teacher uses the library the way an admin does — sees it, and adds to it', async ({ page, request }) => {
  await signIn(page, 'teacher')
  await page.goto('/source')

  // The seeded admin upload is visible to them.
  await expect(page.locator('[data-testid="subject-group"][data-subject="maths"]')).toContainText('Competitor hook teardown')

  await page.getByTestId('material-title').fill('Photosynthesis explainer')
  await page.getByTestId('material-subject').selectOption('science')
  await page.getByTestId('material-url').fill('https://example.com/photosynthesis')
  await page.getByTestId('material-add').click()
  await expect(page.getByTestId('material-title')).toHaveValue('')

  // ⚠️ AND THE ROW IS ATTRIBUTED TO THE TEACHER. `added_by` comes from the session on the server; a
  // route that took it from the body, or defaulted it to an admin, fails here.
  const [row] = await db(request, `material?select=added_by,subject,ready&title=eq.Photosynthesis%20explainer`)
  expect(row.added_by).toBe(USERS.teacher)
  expect(row.subject).toBe('science')
  expect(row.ready).toBe(true)
})

test('everything else is a 404 to a teacher — and a 200 to an admin at the same addresses', async ({ page, browser }) => {
  await signIn(page, 'teacher')
  for (const path of ['/admin', '/admin?tab=people', '/admin/export', '/review', '/tester']) {
    expect((await page.goto(path))?.status(), path).toBe(404)
  }
  // The admin API, through the route rather than a missing button.
  expect((await page.request.post('/api/admin/todo', { data: { task: 'x' } })).status()).toBe(404)
  expect((await page.request.patch('/api/admin/people', { data: { user_id: USERS.teacher, role: 'admin' } })).status()).toBe(404)

  // ⚠️ THE POSITIVE CONTROL, IN THE SAME TEST. Every line above is satisfied by a build where those
  // pages 404 for everybody.
  const other = await browser.newContext()
  try {
    const admin = await other.newPage()
    await signIn(admin, 'admin')
    for (const path of ['/admin', '/review', '/tester', '/source']) {
      expect((await admin.goto(path))?.status(), path).toBe(200)
    }
  } finally {
    await other.close()
  }
})

test('the material route admits a teacher and still refuses a reviewer and a tester', async ({ page, browser }) => {
  await signIn(page, 'teacher')
  const ok = await page.request.post('/api/material', {
    data: { title: 'Teacher can post', subject: 'maths', kind: 'link', url: 'https://example.com/teacher' },
  })
  expect(ok.status()).toBe(200)

  for (const who of ['dana', 'tester'] as const) {
    const ctx = await browser.newContext()
    try {
      const p = await ctx.newPage()
      await signIn(p, who)
      expect((await p.goto('/source'))?.status(), who).toBe(404)
      const refused = await p.request.post('/api/material', {
        data: { title: 'Should not land', subject: 'maths', kind: 'link', url: 'https://example.com/no' },
      })
      expect(refused.status(), who).toBe(404)
    } finally {
      await ctx.close()
    }
  }
})

/**
 * ⚠️ A TEACHER CANNOT BE AN APPROVER, AND THIS IS THE CHECK THAT WAS WRONG BEFORE IT WAS WRITTEN.
 * The approver rules said "not a tester", which a teacher passes. A teacher flagged as an approver
 * would be named on every new cut and could never answer — /review 404s them — so nothing would
 * ever clear. Asserted through the route, because the hidden button is a rendering decision.
 */
test('a teacher is never offered, or given, the approver flag', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')

  const row = page.getByTestId('person').filter({ hasText: 'Harness Teacher' })
  await expect(row).toHaveAttribute('data-role', 'teacher')
  await expect(row.getByTestId('person-approve')).toHaveCount(0)

  const refused = await page.request.patch('/api/admin/people', { data: { user_id: USERS.teacher, can_approve: true } })
  expect(refused.status()).toBe(400)
  expect(((await refused.json()) as { error: string }).error).toBe('not_a_reviewer')
  expect((await db(page.request, `profiles?select=can_approve&user_id=eq.${USERS.teacher}`))[0].can_approve).toBe(false)

  // ⚠️ AND THE OTHER DOOR. Giving somebody access AS an approver goes through the links route, which
  // had the same "not a tester" check. (The positive control — a reviewer CAN be flagged — is
  // `upload.spec.ts`'s approver tests; it is not re-proved here.)
  const bulk = await page.request.post('/api/admin/links', {
    data: { emails: ['teachapprover@example.com'], role: 'teacher', can_approve: true },
  })
  expect(bulk.status()).toBe(400)
})

test('an approver made into a teacher loses the approval in the same act', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')
  const before = await page.getByTestId('person').count()
  await page.getByTestId('bulk-emails').fill('becometeacher@example.com')
  await page.getByTestId('bulk-role').selectOption('approver')
  await page.getByTestId('bulk-make').click()
  await expect(page.getByTestId('person')).not.toHaveCount(before)

  const row = page.getByTestId('person').filter({ hasText: 'becometeacher' })
  await expect(row).toHaveAttribute('data-approver', 'yes')

  await row.getByTestId('person-role').selectOption('teacher')
  await expect(row).toHaveAttribute('data-role', 'teacher')
  // ⚠️ AFTER THE CHANGE, NOT BEFORE. The flag was on a moment ago; the property is that the
  // demotion took it off, which only exists as a state once the dropdown has moved.
  await expect(row).toHaveAttribute('data-approver', 'no')
  const [p] = await db(page.request, `profiles?select=role,can_approve&name=eq.becometeacher`)
  expect(p.role).toBe('teacher')
  expect(p.can_approve).toBe(false)
})
