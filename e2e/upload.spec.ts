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
test('an uploaded cut reaches the reviewer it was assigned to', async ({ page, request, browser }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  await page.getByTestId('upload-title').fill('A New Cut')
  await page.getByTestId('upload-file').setInputFiles(FILE)
  // Dana, the reviewer every other spec uses.
  await page.getByTestId(`upload-reviewer-${USERS.dana}`).click()
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
   * ⚠️ AND THE BYTES COME BACK — READ AS DANA, WHICH IS THE POINT OF THE WHOLE FEATURE. The admin
   * cannot sign this one and should not be able to: `/api/video-url`'s admin door only opens for a
   * CLEARED cut, and this one has not been reviewed yet. Asserting it as the admin was the first
   * version of this and it 404s correctly — the assertion was wrong, not the route.
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
    data: { title: 'Never Uploaded', filename: 'never.mp4', reviewers: [USERS.dana] },
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
