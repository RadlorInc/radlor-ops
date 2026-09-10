import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

async function rows(request: import('@playwright/test').APIRequestContext, table: string, q = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json()) as Record<string, string>[]
}

const FILE = { name: 'a-new-cut.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video, but it is bytes') }

/**
 * AN ADMIN PUTS A CUT IN FRONT OF A REVIEWER, WITHOUT TOUCHING SUPABASE.
 *
 * ⚠️ THE ASSERTIONS ARE ABOUT THE DATABASE AND THE REVIEWER'S SCREEN, NEVER ABOUT THE FORM SAYING
 * IT WORKED. Every step here has a way of returning 200 while achieving nothing — a signed upload
 * URL that is never redeemed, a row that stays `draft`, an assignment that is never written — and
 * a spec that read the success message would pass through all three.
 */
test('an uploaded cut reaches the approver, who is named by the flag and not by the form', async ({ page, request, browser }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  // The form says who will be asked before anything is sent. Dana holds `can_approve` in the seed.
  await expect(page.getByTestId('upload-approver')).toContainText('Dana Reviewer approves or rejects it')
  await page.getByTestId('upload-title').fill('A New Cut')
  await page.getByTestId('upload-file').setInputFiles(FILE)
  await page.getByTestId('upload-send').click()

  /**
   * ⚠️ WAIT FOR THE STATUS, NOT FOR THE ROW. This is the "at which state of the UI" half of the
   * house rule, and it was earned here rather than reasoned about: the first version waited for a
   * row saying `a-new-cut` to appear and then read the database, and it failed about half the
   * time. The row shows up 15ms after the click — `revalidateTag` in the POST invalidates the
   * router cache, so the DRAFT is on screen while the step indicator still says "Making room for
   * it…" and the file has not started uploading. Everything after that point was being asserted
   * mid-flight against a row that had not been published yet.
   *
   * The status cell is the first thing on this page that cannot be true until the upload landed
   * AND was read back, so that is what the assertions wait behind.
   */
  // ⚠️ THE FORM CLEARING IS THE ONLY UNAMBIGUOUS "ALL THREE STEPS LANDED". It happens on the last
  // line of the success path and nowhere else, so waiting on it cannot be satisfied part way
  // through — unlike the row, and unlike the status cell, both of which are rendered from a cache
  // this flow invalidates twice.
  await expect(page.getByTestId('upload-title')).toHaveValue('')
  await expect(page.getByTestId('upload-error')).toHaveCount(0)

  /**
   * ⚠️ A RELOAD BEFORE THE SCREEN IS READ, AND THIS IS A PROPERTY BEING NARROWED RATHER THAN A
   * WAIT BEING ADDED. The form calls `router.refresh()` on success, and this assertion used to
   * lean on that repaint landing — which it did in roughly one full run out of three. Both
   * `revalidateTag` calls are fine: the trace of a failing run shows POST, PUT and PATCH all 200,
   * the row in the database, and the dashboard rendering the seven OTHER videos. Every cache check
   * that passes reliably (see verdict.spec.ts) re-reads with `page.goto`; the one that flaked was
   * the only one relying on the client router to repaint.
   *
   * So what this test now claims is "the cut is on the dashboard", not "the dashboard repaints
   * without a reload". The second is real and unproven, and it is written down in the handoff
   * rather than left as an intermittent red that teaches people to re-run the suite.
   */
  await page.reload()
  const row = page.getByTestId('admin-row').filter({ hasText: 'a-new-cut' })
  await expect(row).toContainText('awaiting_review')

  /**
   * ⚠️ `awaiting_review`, NOT MERELY "A ROW EXISTS". The row is written as a `draft` BEFORE the
   * file is sent, so "the video appears" is satisfied by a build where the upload silently failed
   * and nothing ever published it. The status is the whole difference between a cut somebody can
   * watch and a cut nobody can see.
   */
  const [video] = await rows(request, 'videos', '&slug=eq.a-new-cut')
  expect(video).toBeTruthy()
  expect(video.status).toBe('awaiting_review')
  expect(video.storage_path).toBe('a-new-cut-v1.mp4')
  expect(Number(video.version)).toBe(1)

  const assigned = await rows(request, 'video_reviewers', `&video_id=eq.${video.id}`)
  expect(assigned.map((a) => a.reviewer_id)).toEqual([USERS.dana])
  expect(assigned[0].verdict).toBe(null)

  /**
   * ⚠️ AND THE BYTES COME BACK — READ AS DANA, THE APPROVER, WHICH IS THE POINT OF THE WHOLE
   * FEATURE. (The admin could sign it too since 2026-09-09; reading it as the person the cut was
   * sent to is still the stronger claim, because it goes through a different session.)
   *
   * ⚠️ A SECOND BROWSER CONTEXT, NOT A SECOND SIGN-IN ON THIS PAGE. Two sessions in one cookie jar
   * leave the login form unable to land, which fails as "sign-in broke" four lines from the thing
   * being tested.
   *
   * This is the assertion that fails if the upload URL was minted and never redeemed — the failure
   * mode that looks identical to success from inside the form. Finding #4: a storage write
   * reporting success is not evidence the object can be read.
   */
  const asDana = await browser.newContext()
  try {
    const danaPage = await asDana.newPage()
    await signIn(danaPage, 'dana')
    const signed = await danaPage.request.get('/api/video-url?slug=a-new-cut')
    expect(signed.status()).toBe(200)
    const { url } = (await signed.json()) as { url: string }
    const object = await danaPage.request.get(url)
    expect(object.status()).toBe(200)
    expect(await object.text()).toBe(FILE.buffer.toString())
  } finally {
    await asDana.close()
  }
})

test('a second cut cannot take a name that is already in use', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const before = (await rows(request, 'videos')).length

  await page.getByTestId('upload-title').fill('Split cut')   // the seed already has this slug
  await page.getByTestId('upload-file').setInputFiles(FILE)
  await page.getByTestId('upload-send').click()

  const err = page.getByTestId('upload-error')
  await expect(err).toBeVisible()
  // Names the clash and says what to do — not "something went wrong".
  await expect(err).toContainText('split-cut')
  await expect(err).toContainText('different title')

  // ⚠️ AND NOTHING WAS WRITTEN. A refusal that still inserted a row would look identical on screen
  // and would have put a second, file-less `split-cut` in the list.
  expect((await rows(request, 'videos')).length).toBe(before)
})

test('a file a browser cannot play is refused before anything is created', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const before = (await rows(request, 'videos')).length
  await page.getByTestId('upload-title').fill('A Zip Of Things')
  await page.getByTestId('upload-file').setInputFiles({ name: 'clips.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') })
  await page.getByTestId('upload-send').click()

  await expect(page.getByTestId('upload-error')).toContainText('.mp4')
  expect((await rows(request, 'videos')).length).toBe(before)
})

/**
 * ⚠️ AN UPLOAD THAT NEVER LANDED MUST NOT BECOME A VIDEO SOMEBODY IS WAITING ON.
 *
 * This is the fixture the happy path cannot provide: there, the object really is readable, so
 * deleting the read-back check changes nothing and every assertion still passes. The property only
 * has teeth when the bytes are missing — so this drives the two calls directly and simply never
 * sends the file in between.
 *
 * It is the shape of docs/security-findings.md #4: a storage write to THIS bucket once returned a
 * `Key` for an object that could not afterwards be read, listed, signed or deleted. A publish that
 * believed the uploader would have put that in a reviewer's queue.
 */
test('a video whose file never arrived stays a draft', async ({ page, request, browser }) => {
  await signIn(page, 'admin')

  const made = await page.request.post('/api/admin/video', {
    data: { title: 'Never Uploaded', filename: 'never.mp4' },
  })
  expect(made.status()).toBe(200)
  const { id, storage_path } = (await made.json()) as { id: string; storage_path: string }

  // No PUT. The object does not exist; only the row does.
  const published = await page.request.patch('/api/admin/video', { data: { id, storage_path } })
  expect(published.status()).toBe(502)

  const [video] = await rows(request, 'videos', '&slug=eq.never-uploaded')
  expect(video.status).toBe('draft')

  // ⚠️ AND THE REVIEWER IT WAS MEANT FOR SEES NOTHING. `draft` is outside REVIEWER_VISIBLE, so the
  // assignment alone cannot surface it — which is the whole reason the row is written as a draft
  // rather than as a video with a missing file.
  const asDana = await browser.newContext()
  try {
    const danaPage = await asDana.newPage()
    await signIn(danaPage, 'dana')
    expect((await danaPage.request.get('/api/video-url?slug=never-uploaded')).status()).toBe(404)
    await expect(danaPage.getByText('Never Uploaded')).toHaveCount(0)
  } finally {
    await asDana.close()
  }
})

/**
 * ── WHO APPROVES IS A PROPERTY OF THE PERSON ────────────────────────────────────────────────────
 *
 * Rafi, 2026-09-09: when somebody is given access as a reviewer there must be a way to make them
 * a person who approves or rejects; otherwise they only give feedback. Several may hold it — his
 * second word the same evening — and a cut is cleared only when all of them have approved.
 *
 * ⚠️ THESE TWO MUTATE THE FLAG AND RUN LAST IN THIS FILE, AND NOTHING AFTER THIS FILE UPLOADS.
 * Every test above reads Dana off the seed; these move the flag away from her and do not put it
 * back — a restore step is the thing CLAUDE.md warns against, and the honest alternative is that
 * no later spec depends on it. `verdict.spec.ts` is the only file after this one alphabetically
 * and it never uploads. Each test sets its own precondition, so `-g` runs it alone.
 *
 * ⚠️ THE ROUTE IS DRIVEN WITH A `reviewers` BODY IT MUST IGNORE. The client used to name the
 * assignee; a route that still honoured it would let a request body put a decision in front of
 * somebody the admin never chose. Sending Dana and asserting Flood is what proves it is ignored.
 */
test('Make approver adds a second approver, and the next upload asks both — not whoever the form names', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')
  const row = (name: string) => page.getByTestId('person').filter({ hasText: name })

  await expect(row('Dana Reviewer')).toHaveAttribute('data-approver', 'yes')
  await expect(row('Flood Reviewer')).toHaveAttribute('data-approver', 'no')
  // A tester gets no button at all: a decision cannot sit with somebody who cannot open the page.
  await expect(row('Harness Tester').getByTestId('person-approve')).toHaveCount(0)

  await row('Flood Reviewer').getByTestId('person-approve').click()
  // ⚠️ BOTH ROWS. "Flood is an approver" is satisfied by a build that still moves the flag; Dana
  // KEEPING it is what "we can create multiple" means, and the summary has to say all must approve.
  await expect(row('Flood Reviewer')).toHaveAttribute('data-approver', 'yes')
  await expect(row('Dana Reviewer')).toHaveAttribute('data-approver', 'yes')
  await expect(page.getByTestId('approver-summary')).toContainText('cleared only when all of them have approved')

  const made = await page.request.post('/api/admin/video', {
    data: { title: 'Floods Cut', filename: 'floods.mp4', reviewers: [USERS.dana] },
  })
  expect(made.status()).toBe(200)
  const { id } = (await made.json()) as { id: string }
  const assigned = await rows(request, 'video_reviewers', `&video_id=eq.${id}`)
  expect(assigned.map((a) => a.reviewer_id).sort()).toEqual([USERS.dana, USERS.flood].sort())
})

test('with nobody set to approve, nothing can be sent out — form and route agree', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=people')
  // Own precondition: every holder (Dana and Flood after the test above, Dana alone otherwise) is
  // switched off, one click each, re-querying because the list redraws after every click.
  const holders = () => page.getByTestId('person').filter({ has: page.getByTestId('person-approver') })
  for (let n = await holders().count(); n > 0; n = await holders().count()) {
    await holders().first().getByTestId('person-approve').click()
    await expect(holders()).toHaveCount(n - 1)
  }
  await expect(page.getByTestId('person-approver')).toHaveCount(0)
  await expect(page.getByTestId('approver-summary')).toContainText('Nobody is set to approve')

  await page.goto('/admin?tab=videos')
  await expect(page.getByTestId('upload-approver')).toContainText('Nobody is set to approve cuts yet')
  await page.getByTestId('upload-title').fill('Orphan Cut')
  await page.getByTestId('upload-file').setInputFiles(FILE)
  await expect(page.getByTestId('upload-send')).toBeDisabled()

  const before = (await rows(request, 'videos')).length
  const res = await page.request.post('/api/admin/video', { data: { title: 'Orphan Cut', filename: 'orphan.mp4' } })
  expect(res.status()).toBe(400)
  expect(((await res.json()) as { error: string }).error).toBe('no_approver')
  expect((await rows(request, 'videos')).length).toBe(before)

  // And giving people access AS approvers, through the other door: a pasted list of two lands as
  // two flagged rows, which is what "we can create multiple" has to mean at the point of entry.
  await page.goto('/admin?tab=people')
  await page.getByTestId('bulk-emails').fill('lead@example.com\nsecond@example.com')
  await page.getByTestId('bulk-role').selectOption('approver')
  await page.getByTestId('bulk-make').click()
  await expect(page.getByTestId('links-out')).toBeVisible()
  await expect(page.getByTestId('person').filter({ hasText: 'lead' })).toHaveAttribute('data-approver', 'yes')
  await expect(page.getByTestId('person').filter({ hasText: 'second' })).toHaveAttribute('data-approver', 'yes')
  await expect(page.getByTestId('person-approver')).toHaveCount(2)
  // The one refusal that stays: a tester cannot be an approver.
  const tester = await page.request.post('/api/admin/links', { data: { emails: ['t@example.com'], role: 'tester', can_approve: true } })
  expect(tester.status()).toBe(400)
})
