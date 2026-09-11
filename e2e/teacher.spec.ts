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

/**
 * ⚠️ READ-ONLY, AND BOTH HALVES ARE ASSERTED ON THE SAME SCREEN. Rafi, 2026-09-11: the admin manages
 * the library and a teacher can only look at it. "Sees the items" alone passes on a build that also
 * hands them the form; "no form" alone passes on a build that shows them nothing at all. Together
 * they describe the page a teacher is meant to get.
 *
 * ⚠️ AND THE ADMIN IS THE POSITIVE CONTROL FOR EVERY ABSENCE. `material-add` having a count of 0 is
 * also what a broken render looks like; the same selector being present for an admin is what makes
 * it mean "not for you".
 */
test('a teacher sees the library and is given nothing to change it with', async ({ page, browser }) => {
  await signIn(page, 'teacher')
  await page.goto('/source')

  await expect(page.locator('[data-testid="subject-group"][data-subject="maths"]')).toContainText('Competitor hook teardown')
  await expect(page.getByTestId('material-item').first().getByTestId('material-open')).toBeVisible()
  await expect(page.getByTestId('material-add')).toHaveCount(0)
  await expect(page.getByTestId('material-title')).toHaveCount(0)
  await expect(page.getByTestId('material-remove')).toHaveCount(0)

  const other = await browser.newContext()
  try {
    const admin = await other.newPage()
    await signIn(admin, 'admin')
    await admin.goto('/source')
    await expect(admin.getByTestId('material-add')).toBeVisible()
    await expect(admin.getByTestId('material-remove').first()).toBeVisible()
  } finally {
    await other.close()
  }
})

/**
 * ⚠️ AN UNFINISHED UPLOAD IS AN ADMIN'S LOOSE END, NOT A TEACHER'S. It exists so the person who can
 * remove it can see it. A teacher can neither open nor remove it, so for them it would be a title
 * with no controls — a row that looks broken. `Brand deck` is seeded in exactly that state.
 */
test('an upload that never finished is shown to an admin and not to a teacher', async ({ page, browser }) => {
  await signIn(page, 'teacher')
  await page.goto('/source')
  await expect(page.locator('[data-testid="subject-group"][data-subject="maths"]')).toContainText('Competitor hook teardown')
  await expect(page.getByTestId('material-item').filter({ hasText: 'Brand deck' })).toHaveCount(0)

  const other = await browser.newContext()
  try {
    const admin = await other.newPage()
    await signIn(admin, 'admin')
    await admin.goto('/source')
    await expect(admin.getByTestId('material-item').filter({ hasText: 'Brand deck' })).toBeVisible()
  } finally {
    await other.close()
  }
})

/**
 * ⚠️ "CAN LOOK" INCLUDES OPENING THE FILE, AND THAT PATH IS THE ONE THAT HANDS OUT A CREDENTIAL. A
 * teacher who could see a row and not open it would be reading a list of titles. So an admin uploads
 * a real file, and the teacher follows the same Open link a person clicks — through the route that
 * signs, to the bytes that were sent.
 */
test('a teacher can open a file an admin uploaded', async ({ page, browser }) => {
  const other = await browser.newContext()
  let id = ''
  try {
    const admin = await other.newPage()
    await signIn(admin, 'admin')
    const made = await admin.request.post('/api/material', {
      data: { title: 'Cell diagram', subject: 'science', kind: 'file', filename: 'cell diagram.pdf' },
    })
    expect(made.status()).toBe(200)
    const body = (await made.json()) as { id: string; uploadUrl: string }
    id = body.id
    expect((await admin.request.put(body.uploadUrl, { data: Buffer.from('%PDF cell'), headers: { 'Content-Type': 'application/pdf' } })).status()).toBe(200)
    expect((await admin.request.patch('/api/material', { data: { id } })).status()).toBe(200)
  } finally {
    await other.close()
  }

  await signIn(page, 'teacher')
  await page.goto('/source')
  const item = page.getByTestId('material-item').filter({ hasText: 'Cell diagram' })
  const href = await item.getByTestId('material-open').getAttribute('href')
  const opened = await page.request.get(href!)
  expect(opened.status()).toBe(200)
  expect(await opened.text()).toBe('%PDF cell')
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

/**
 * ⚠️ THROUGH THE ROUTE, VERB BY VERB, BECAUSE THE HIDDEN FORM IS A RENDERING DECISION. A teacher's
 * browser can still send a POST by hand; the rule has to hold there, not only on the page. And the
 * item the DELETE is aimed at is read back afterwards — a 404 that still deleted would look the same
 * from here.
 */
test('the route lets a teacher open things and refuses every write', async ({ page, request }) => {
  await signIn(page, 'teacher')

  const posted = await page.request.post('/api/material', {
    data: { title: 'Teacher cannot post', subject: 'maths', kind: 'link', url: 'https://example.com/teacher' },
  })
  expect(posted.status()).toBe(404)
  expect((await db(request, `material?select=id&title=eq.Teacher%20cannot%20post`)).length).toBe(0)

  const seeded = '22222222-2222-4222-8222-222222222222'
  expect((await page.request.delete('/api/material', { data: { id: seeded } })).status()).toBe(404)
  expect((await page.request.patch('/api/material', { data: { id: seeded } })).status()).toBe(404)
  expect((await db(request, `material?select=id&id=eq.${seeded}`)).length).toBe(1)
})

/**
 * ⚠️ THE REFUSAL HAS TO BE ABOUT ROLE, AND THE FIXTURE IS WHAT MAKES IT SO. The route serves only
 * READY FILES, so a GET aimed at the seeded link 404s for everybody — a teacher included — and a
 * reviewer's 404 there would prove nothing. An admin uploads a real file inside this test, and the
 * teacher opening that same id is the positive control that turns the reviewer's 404 into "not you".
 */
test('a reviewer and a tester cannot open or add anything — the same file a teacher can open', async ({ page, browser }) => {
  const adminCtx = await browser.newContext()
  let id = ''
  try {
    const admin = await adminCtx.newPage()
    await signIn(admin, 'admin')
    const made = await admin.request.post('/api/material', {
      data: { title: 'Fractions poster', subject: 'maths', kind: 'file', filename: 'fractions poster.pdf' },
    })
    const body = (await made.json()) as { id: string; uploadUrl: string }
    id = body.id
    await admin.request.put(body.uploadUrl, { data: Buffer.from('%PDF fractions'), headers: { 'Content-Type': 'application/pdf' } })
    expect((await admin.request.patch('/api/material', { data: { id } })).status()).toBe(200)
  } finally {
    await adminCtx.close()
  }

  // The control: a teacher opens it.
  await signIn(page, 'teacher')
  expect((await page.request.get(`/api/material?id=${id}`, { maxRedirects: 0 })).status()).toBe(302)

  for (const who of ['dana', 'tester'] as const) {
    const ctx = await browser.newContext()
    try {
      const p = await ctx.newPage()
      await signIn(p, who)
      expect((await p.goto('/source'))?.status(), who).toBe(404)
      expect((await p.request.get(`/api/material?id=${id}`, { maxRedirects: 0 })).status(), who).toBe(404)
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
