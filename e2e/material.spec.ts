import { expect, test } from '@playwright/test'
import { SUPABASE_URL } from './tokens'
import { signIn } from './signIn'

/**
 * SOURCE MATERIAL — what a cut gets made FROM, as opposed to the cuts themselves.
 *
 * Rafi, 2026-09-10: a tab where the admin uploads the material related to making content —
 * "kuch bhi ho sakhta hai video, link, pdf kuch bhi".
 *
 * ⚠️ THE FILE UPLOADED HERE IS A PDF, AND THAT IS THE POINT RATHER THAN A DETAIL. `/api/admin/video`
 * refuses everything but four playable video extensions, so a spec that uploaded an .mp4 would pass
 * against a build that copied that whitelist across — the one mistake this feature can plausibly
 * make. A format the OTHER route rejects is the fixture that tells the two apart.
 */

const PDF = { name: 'brand rules.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really a pdf, but it is bytes') }

/** ⚠️ AN ATTRIBUTE SELECTOR ON THE SECTION ITSELF, NOT `filter({ has: … })`. `has` looks for a
 *  DESCENDANT carrying the attribute, and `data-subject` sits on the section — so the first version
 *  matched nothing and two tests failed as "element not found", which reads like the feature is
 *  missing rather than like the locator is wrong. */
const group = (page: import('@playwright/test').Page, subject: 'science' | 'maths') =>
  page.locator(`[data-testid="subject-group"][data-subject="${subject}"]`)

/**
 * ⚠️ THE FILE INPUT EMPTYING IS THE ONLY UNAMBIGUOUS "EVERY STEP LANDED", and this helper exists
 * because the obvious alternative is a trap. `expect(material-error).toHaveCount(0)` right after
 * the click passes INSTANTLY — before the upload has even started — so the assertions after it read
 * a database that has not been written yet. That is how `ready: false` came back for a file that
 * uploads perfectly well: the test was simply early. The form is cleared on the success path and
 * nowhere else, so this waits for the thing that cannot be true until all three calls returned.
 */
async function uploadFinished(page: import('@playwright/test').Page) {
  await expect
    .poll(() => page.getByTestId('material-file').evaluate((el: HTMLInputElement) => el.files?.length ?? 0), {
      timeout: 30_000,
    })
    .toBe(0)
}

async function rows(request: import('@playwright/test').APIRequestContext, q = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/material?select=*${q}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json()) as Record<string, string>[]
}

test('a PDF goes up, comes back down, and the video tab refuses the same file', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  await page.getByTestId('material-title').fill('Brand rules')
  await page.getByTestId('material-subject').selectOption('maths')
  await page.getByTestId('material-kind').selectOption('file')
  await page.getByTestId('material-file').setInputFiles(PDF)
  await page.getByTestId('material-add').click()

  // ⚠️ THE FORM CLEARING IS THE ONLY UNAMBIGUOUS "ALL THREE STEPS LANDED" — the row is written
  // before the bytes are sent, so a row appearing proves only that the first of three calls worked.
  await expect(page.getByTestId('material-title')).toHaveValue('')
  await expect(page.getByTestId('material-error')).toHaveCount(0)

  const [row] = await rows(request, '&title=eq.Brand%20rules')
  expect(row).toBeTruthy()
  expect(row.subject).toBe('maths')
  // ⚠️ `ready`, NOT MERELY "A ROW EXISTS". False is the state a died-half-way upload leaves, so
  // asserting the row alone would pass on a build where the bytes never arrived.
  expect(row.ready).toBe(true)
  expect(row.filename).toBe('brand rules.pdf')
  // The object name is the server's, derived from the title, and inside the set finding #4 was about.
  expect(row.storage_path).toMatch(/^brand-rules-[0-9a-f]{8}\.pdf$/)

  // ⚠️ AND THE BYTES COME BACK THROUGH THE DOOR A PERSON USES. The Open link is a plain anchor at a
  // route that signs at click time; following it must reach the file that was sent, not a 404 from
  // an object that was written and is unreachable (finding #4).
  // ⚠️ FOUND THROUGH THE MATHS SECTION, NOT THE WHOLE PAGE. Scoping the lookup to the heading it
  // was filed under is what makes this assert the split as well as the upload.
  const item = group(page, 'maths').getByTestId('material-item').filter({ hasText: 'Brand rules' })
  const href = await item.getByTestId('material-open').getAttribute('href')
  const opened = await page.request.get(href!)
  expect(opened.status()).toBe(200)
  expect(await opened.text()).toBe(PDF.buffer.toString())

  // The positive control for "any format at all": the cuts route, given the same file, says no.
  const asCut = await page.request.post('/api/admin/video', { data: { title: 'Brand Rules Cut', filename: PDF.name } })
  expect(asCut.status()).toBe(400)
  expect(((await asCut.json()) as { error: string }).error).toBe('bad_format')
})

test('a link is saved as a link, and a junk address is refused before anything is written', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  const before = (await rows(request)).length

  // ⚠️ `javascript:` RATHER THAN "banana". A malformed string is refused by any parse at all; a
  // well-formed URL with a scheme that executes is what the protocol check exists for, and it is
  // rendered as an anchor on the admin's own page.
  await page.getByTestId('material-title').fill('Something Nasty')
  await page.getByTestId('material-subject').selectOption('science')
  await page.getByTestId('material-url').fill('javascript:alert(1)')
  await page.getByTestId('material-add').click()
  await expect(page.getByTestId('material-error')).toContainText('http://')
  expect((await rows(request)).length).toBe(before)

  /**
   * ⚠️ A LINK STILL HAS TO BE NAMED, and this is asserted through the route because the form's own
   * button is disabled without a title — a UI-only check cannot tell "refused" from "never sent".
   * A file may arrive unnamed and take its filename; a URL is not a name, and without this the
   * guard could be deleted with every other test still green. break-check said exactly that.
   */
  const unnamed = await page.request.post('/api/material', {
    data: { kind: 'link', subject: 'science', url: 'https://example.com/unnamed' },
  })
  expect(unnamed.status()).toBe(400)
  expect(((await unnamed.json()) as { error: string }).error).toBe('no_title')
  expect((await rows(request, '&url=eq.https://example.com/unnamed')).length).toBe(0)

  await page.getByTestId('material-url').fill('https://example.com/hook-teardown')
  await page.getByTestId('material-add').click()
  await expect(page.getByTestId('material-title')).toHaveValue('')

  const [row] = await rows(request, '&title=eq.Something%20Nasty')
  expect(row.kind).toBe('link')
  expect(row.subject).toBe('science')
  expect(row.url).toBe('https://example.com/hook-teardown')
  // A link has no object, and is ready the moment it is saved — there is nothing to read back.
  expect(row.storage_path).toBe(null)
  expect(row.ready).toBe(true)
})

test('an upload that never finished says so instead of offering itself', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  // Seeded in that state on purpose: a working upload cannot produce it, and it is the state the
  // interface has to be honest about rather than render a link that 404s on the first click.
  const stuck = page.getByTestId('material-item').filter({ hasText: 'Brand deck' })
  await expect(stuck).toHaveAttribute('data-ready', 'no')
  await expect(stuck.getByTestId('material-unfinished')).toBeVisible()
  await expect(stuck.getByTestId('material-open')).toHaveCount(0)
})

test('removing an item takes the row and reports on the file', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  await page.getByTestId('material-title').fill('Delete Me')
  await page.getByTestId('material-subject').selectOption('science')
  await page.getByTestId('material-url').fill('https://example.com/delete-me')
  await page.getByTestId('material-add').click()
  await expect(page.getByTestId('material-title')).toHaveValue('')

  const item = page.getByTestId('material-item').filter({ hasText: 'Delete Me' })
  await item.getByTestId('material-remove').click()
  // ⚠️ THE FIRST PRESS MUST NOT DELETE. A one-press Remove and a two-press one look identical from
  // the far side; this is the assertion that tells them apart.
  expect((await rows(request, '&title=eq.Delete%20Me')).length).toBe(1)

  await item.getByTestId('material-remove-really').click()
  await expect(page.getByTestId('material-item').filter({ hasText: 'Delete Me' })).toHaveCount(0)
  expect((await rows(request, '&title=eq.Delete%20Me')).length).toBe(0)
})

/** Nobody but an admin reaches any of it — through the route, because a reviewer never sees the
 *  tab and a UI-only check cannot tell "refused" from "never rendered". */
test('a reviewer can neither open the tab nor reach the route behind it', async ({ page }) => {
  await signIn(page, 'dana')
  expect((await page.goto('/source'))?.status()).toBe(404)
  expect((await page.request.get('/api/material?id=22222222-2222-4222-8222-222222222222')).status()).toBe(404)
  expect((await page.request.post('/api/material', { data: { title: 'x', kind: 'link', url: 'https://example.com' } })).status()).toBe(404)
})

/**
 * ⚠️ THE SEEDED FIXTURES ARE ONE IN EACH SUBJECT, WHICH IS THE ONLY WAY THIS BINDS. Two items under
 * one heading would be satisfied by a build that ignores `subject` and renders the same list under
 * both — so each assertion below has a matching NEGATIVE one, and it is the negative that carries
 * the property. `Competitor hook teardown` is maths; `Brand deck` is science.
 */
test('the library is divided in two, and an item appears under one heading only', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  // Both headings are on screen at once — this is a division, not a filter.
  await expect(group(page, 'science')).toBeVisible()
  await expect(group(page, 'maths')).toBeVisible()

  await expect(group(page, 'maths')).toContainText('Competitor hook teardown')
  await expect(group(page, 'science')).not.toContainText('Competitor hook teardown')
  await expect(group(page, 'science')).toContainText('Brand deck')
  await expect(group(page, 'maths')).not.toContainText('Brand deck')
})

test('the route refuses an item with no subject, or one it does not recognise', async ({ page, request }) => {
  await signIn(page, 'admin')
  const before = (await rows(request)).length

  for (const subject of [undefined, '', 'history', 'SCIENCE']) {
    const res = await page.request.post('/api/material', {
      data: { title: 'No Subject', kind: 'link', url: 'https://example.com/x', ...(subject === undefined ? {} : { subject }) },
    })
    expect(res.status()).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('no_subject')
  }
  // ⚠️ AND NOTHING WAS WRITTEN. A refusal that still inserted would look identical from here, and
  // the column is `not null` with no default precisely so a route that forgot it fails loudly.
  expect((await rows(request)).length).toBe(before)

  // The positive control: the same request, with a subject it does accept.
  const ok = await page.request.post('/api/material', {
    data: { title: 'Has Subject', kind: 'link', url: 'https://example.com/x', subject: 'maths' },
  })
  expect(ok.status()).toBe(200)
})

/** ⚠️ THE BUTTON STAYS DISABLED UNTIL A SUBJECT IS PICKED — asserted after the title and the link
 *  are filled, because that is the state where the ONLY thing missing is the subject. Asserting it
 *  on an empty form would pass on a build that never checks the subject at all. */
test('nothing can be added until a subject is chosen', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  await page.getByTestId('material-title').fill('Needs A Subject')
  await page.getByTestId('material-url').fill('https://example.com/needs-a-subject')
  await expect(page.getByTestId('material-add')).toBeDisabled()

  await page.getByTestId('material-subject').selectOption('science')
  await expect(page.getByTestId('material-add')).toBeEnabled()
})

/**
 * ⚠️ THREE FILES, THREE FORMATS, ONE PRESS. Rafi, 2026-09-11: each subject should take multiple
 * files in one go. Three rather than two, because two is the smallest number that can pass while a
 * loop still only handles a pair; and three DIFFERENT extensions, because the point of this tab is
 * that it refuses to care what a file is.
 *
 * ⚠️ AND NO TITLE IS TYPED, WHICH IS THE HALF THAT ONLY MATTERS FOR A SELECTION. One box cannot
 * name three files, so each has to arrive under its own — a build that applied the typed title to
 * all of them, or called them "(1)" and "(2)", fails here and nowhere else.
 */
const BATCH = [
  { name: 'hook one.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') },
  { name: 'hook_two.png', mimeType: 'image/png', buffer: Buffer.from('two') },
  { name: 'hook-three.txt', mimeType: 'text/plain', buffer: Buffer.from('three') },
]

test('a whole selection goes up in one press, each under its own name and subject', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  /**
   * ⚠️ A TITLE IS TYPED FIRST, AND THEN THE FILES ARE CHOSEN. Without it, "the typed title is not
   * applied to all three" is not observable: with the box empty, applying it changes nothing, and
   * break-check said so — the check passed on a build that titled every file `Not this name`.
   * Typing before selecting is also the order a person would stumble into it.
   */
  await page.getByTestId('material-title').fill('Not this name')
  await page.getByTestId('material-subject').selectOption('science')
  await page.getByTestId('material-kind').selectOption('file')
  await page.getByTestId('material-file').setInputFiles(BATCH)

  // The form says how many, and refuses to pretend one title could cover them.
  await expect(page.getByTestId('material-file-count')).toContainText('3 files')
  await expect(page.getByTestId('material-title')).toBeDisabled()

  await page.getByTestId('material-add').click()
  await uploadFinished(page)
  await expect(page.getByTestId('material-error')).toHaveCount(0)
  await expect(page.getByTestId('material-file-count')).toHaveCount(0)

  /**
   * ⚠️ EVERY ONE OF THEM `ready`, READ OUT OF THE DATABASE. Each file is three calls — row, bytes,
   * read-back — so a loop that made three rows and uploaded only the first would leave two of them
   * unfinished, which `ready` is the only thing that distinguishes.
   */
  for (const [filename, title] of [
    ['hook one.pdf', 'hook one'],
    ['hook_two.png', 'hook two'],
    ['hook-three.txt', 'hook three'],
  ]) {
    const [row] = await rows(request, `&filename=eq.${encodeURIComponent(filename)}`)
    /* ⚠️ NO CUSTOM MESSAGE HERE. `expect(row, 'no row for x').toBeTruthy()` reads better and cost
       this check its standing: the message REPLACES Playwright's, so break-verdict.mjs — which
       recognises a failure by that format — classified a perfectly good red as "not an assertion"
       and refused to certify it. Asserting the filename back gives the standard shape AND names the
       file in the diff. */
    expect(row?.filename).toBe(filename)
    // The separators people actually type, turned back into spaces — and the extension dropped.
    expect(row.title).toBe(title)
    expect(row.subject).toBe('science')
    expect(row.ready).toBe(true)
  }

  // ⚠️ AND THE TYPED TITLE WENT NOWHERE. This is the assertion the break above is caught by.
  expect((await rows(request, '&title=eq.Not%20this%20name')).length).toBe(0)

  // ⚠️ AND ALL THREE UNDER THE SCIENCE HEADING, none under maths. The subject is chosen once for
  // the whole selection, which is the thing "multiple files per subject" actually means.
  await page.reload()
  for (const title of ['hook one', 'hook two', 'hook three']) {
    await expect(group(page, 'science')).toContainText(title)
    await expect(group(page, 'maths')).not.toContainText(title)
  }
})

/** One file still takes the name the admin typed — the selection case must not have cost the
 *  single case its title. Covered above by 'Brand rules'; this is the other half: one file, no
 *  title, so the filename is used. */
test('one file with no title typed keeps its own name', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/source')

  await page.getByTestId('material-subject').selectOption('maths')
  await page.getByTestId('material-kind').selectOption('file')
  await page.getByTestId('material-file').setInputFiles({
    name: 'ratio_worksheet_v2.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('worksheet'),
  })
  // The box is usable for one file — it is only a selection that disables it.
  await expect(page.getByTestId('material-title')).toBeEnabled()
  await page.getByTestId('material-add').click()
  await uploadFinished(page)
  await expect(page.getByTestId('material-error')).toHaveCount(0)

  const [row] = await rows(request, '&filename=eq.ratio_worksheet_v2.pdf')
  expect(row.title).toBe('ratio worksheet v2')
  expect(row.ready).toBe(true)
})
