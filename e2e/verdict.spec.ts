import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/** `hook-test-b`, so this cannot collide with the note round-trip spec on `equals-reel-final`. */
const PAGE = '/review/hook-test-b'

/** Reads out of the DATABASE, not off the page that just wrote it. A verdict button that updates
 *  the UI while the row stays null is the failure this whole spec exists for.
 *
 *  ⚠️ THE VERDICT NOW COMES FROM THE ASSIGNMENT, NAMED BY REVIEWER. Reading it off `videos` again
 *  would be reading the stale column the change moved away from — it still exists until its own
 *  migration drops it, and it would answer with whatever it held in the seed no matter what any
 *  reviewer did. Status stays on the video, because that is what it is. */
const { dana: DANA, flood: FLOOD } = USERS

async function statusOf(request: import('@playwright/test').APIRequestContext, slug: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/videos?select=id,status&slug=eq.${slug}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json())[0] as { id: string; status: string }
}

async function rowOf(
  request: import('@playwright/test').APIRequestContext,
  slug: string,
  reviewerId = DANA,
) {
  const video = await statusOf(request, slug)
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/video_reviewers?select=verdict&video_id=eq.${video.id}&reviewer_id=eq.${reviewerId}`,
    { headers: { 'Accept-Profile': 'review' } },
  )
  const assignment = (await res.json())[0] as { verdict: string | null } | undefined
  return { status: video.status, verdict: assignment ? assignment.verdict : 'UNASSIGNED' }
}

test('choosing "Needs changes" records status AND verdict in the row', async ({ page, request }) => {
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'awaiting_review', verdict: null })

  await signIn(page, 'dana')
  await page.goto(PAGE)
  await expect(page.getByTestId('verdict-approved')).toBeVisible()
  await page.getByTestId('verdict-changes').click()

  await expect(page.getByTestId('verdict-label')).toHaveText('Changes needed.')
  await expect(page.getByTestId('verdict-approved')).toHaveCount(0)
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'changes_needed' })
})

test('a note afterwards CLEARS the verdict, not just the status', async ({ page, request }) => {
  await signIn(page, 'dana')
  await page.goto(PAGE)
  await page.getByTestId('add-note').click()
  await page.getByTestId('note-body').fill('one more — the end card sits too long')
  await page.getByTestId('save-note').click()

  await expect(page.getByTestId('reopened-notice')).toBeVisible()
  await expect(page.getByTestId('verdict-approved')).toBeVisible()
  // Both halves. A cleared status with a surviving verdict would still tell Rafi "approved".
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'awaiting_review', verdict: null })
})

test('approving records the other verdict, and the reviewer is not locked out', async ({ page, request }) => {
  await signIn(page, 'dana')
  await page.goto(PAGE)
  await page.getByTestId('verdict-approved').click()
  await expect(page.getByTestId('verdict-label')).toHaveText('Approved — good to post.')
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'approved' })

  await page.reload()
  await expect(page.getByTestId('verdict-label')).toHaveText('Approved — good to post.')
  await expect(page.getByTestId('add-note')).toBeVisible()
  await expect(page.getByTestId('note-list')).toContainText('the end card sits too long')
})

test('the route refuses a signed-out caller, a bad verdict, and a video the reviewer cannot see', async ({ page, request }) => {
  /**
   * ⚠️ THE SIGNED-OUT CASE IS A 404, NOT A REDIRECT. A POST from a signed-out client that followed
   * a redirect would come back 200 with a login page in the body, which reads as success to
   * anything checking a status code. `request` carries no cookies, so this is that caller.
   */
  const out = await request.post('/api/review-done', { data: { slug: 'hook-test-b', verdict: 'approved' } })
  expect(out.status()).toBe(404)

  await signIn(page, 'dana')
  const bad = await page.request.post('/api/review-done', { data: { slug: 'hook-test-b', verdict: 'shipped' } })
  expect(bad.status()).toBe(400)
  const draft = await page.request.post('/api/review-done', { data: { slug: 'quiet-draft', verdict: 'approved' } })
  expect(draft.status()).toBe(404)

  // ⚠️ AND A VIDEO THAT IS PERFECTLY REVIEWABLE, JUST NOT HERS. `quiet-draft` above is refused by
  // `status`, which is a filter that has always been there — on its own it proves nothing about
  // the assignment. `flood-only` is `awaiting_review` and assigned to somebody else, so the
  // assignment is the only thing that can refuse it.
  const notMine = await page.request.post('/api/review-done', { data: { slug: 'flood-only', verdict: 'approved' } })
  expect(notMine.status()).toBe(404)

  // No attempt moved anything.
  expect(await rowOf(request, 'hook-test-b')).toEqual({ status: 'reviewed', verdict: 'approved' })
  expect(await rowOf(request, 'quiet-draft')).toEqual({ status: 'draft', verdict: 'UNASSIGNED' })
  expect(await rowOf(request, 'flood-only', FLOOD)).toEqual({ status: 'awaiting_review', verdict: null })
})

test('a reviewer sees only the videos they were assigned — page AND list', async ({ page, browser }) => {
  await signIn(page, 'dana')
  await page.goto('/review')
  // The list: `flood-only` is awaiting review, so status alone would have shown it.
  await expect(page.getByText('Hook test B')).toBeVisible()
  await expect(page.getByText('Flood only')).toHaveCount(0)

  // The page, and the route that hands out a signed URL for the object itself.
  expect((await page.goto('/review/flood-only'))?.status()).toBe(404)
  const url = await page.request.get('/api/video-url?slug=flood-only')
  expect(url.status()).toBe(404)

  // ⚠️ THE POSITIVE CONTROL. Every assertion above is satisfied by a build where nothing resolves
  // at all — the other reviewer getting 200 on the same slug is what makes them mean "not yours".
  const other = await browser.newPage()
  await signIn(other, 'flood')
  expect((await other.goto('/review/flood-only'))?.status()).toBe(200)
  await other.close()
})

/** ⚠️ `overwrite-cut`, NOT `split-cut`. This spec writes verdicts, and the /admin spec below reads
 *  a seeded disagreement; pointing both at one row made that one pass or fail on test order. */
test('one reviewer cannot overwrite another reviewer, in either direction', async ({ page, request }) => {
  const before = await rowOf(request, 'overwrite-cut', FLOOD)
  expect(before.verdict).toBe('changes_needed')

  await signIn(page, 'dana')
  // Dana approves the same video. Her answer must land on HER row and leave the objection standing.
  const res = await page.request.post('/api/review-done', {
    data: { slug: 'overwrite-cut', verdict: 'approved' },
  })
  expect(res.status()).toBe(200)
  expect((await rowOf(request, 'overwrite-cut', DANA)).verdict).toBe('approved')
  expect((await rowOf(request, 'overwrite-cut', FLOOD)).verdict).toBe('changes_needed')

  // And a note from Dana clears HER verdict only — not the other reviewer's.
  const note = await page.request.post('/api/notes', {
    data: { slug: 'overwrite-cut', t_seconds: 3, body: 'actually, one more thing' },
  })
  expect(note.status()).toBe(201)
  expect((await rowOf(request, 'overwrite-cut', DANA)).verdict).toBe(null)
  expect((await rowOf(request, 'overwrite-cut', FLOOD)).verdict).toBe('changes_needed')
})

test('/admin shows each reviewer by name, the progress, and the disagreement as a disagreement', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')
  const row = page.getByTestId('admin-row').filter({ hasText: 'split-cut' })

  // Each answer separately, by name — not folded into one cell.
  await expect(row.getByTestId('reviewer-verdict')).toHaveCount(2)
  await expect(row.getByTestId('reviewer-verdicts')).toContainText('Dana Reviewer — approved')
  await expect(row.getByTestId('reviewer-verdicts')).toContainText('Flood Reviewer — changes needed')

  // ⚠️ ONE APPROVAL DOES NOT CLEAR IT. This is the rule the whole change exists for.
  await expect(row.getByTestId('cleared-cell')).toHaveAttribute('data-cleared', 'no')
  await expect(page.getByTestId('reviewers-disagree')).toContainText('split-cut')

  // Part-done reads as part-done rather than as nothing.
  const halfDone = page.getByTestId('admin-row').filter({ hasText: 'equals-reel-final' })
  await expect(halfDone.getByTestId('progress-label')).toHaveText('0 of 2 reviewers finished')

  // ⚠️ AND ZERO ASSIGNMENTS IS NOT EVERYBODY APPROVED. `[].every()` is true; this is the row that
  // would go green on that.
  const unassigned = page.getByTestId('admin-row').filter({ hasText: 'quiet-draft' })
  await expect(unassigned.getByTestId('cleared-cell')).toHaveAttribute('data-cleared', 'no')
  await expect(unassigned.getByTestId('reviewer-verdicts')).toContainText('nobody assigned')
})

test('/admin surfaces approved-with-open-notes instead of letting it pass silently', async ({ page }) => {
  await signIn(page, 'admin')
  const banner = page.getByTestId('approved-with-notes')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('cta-cut')
  await expect(banner).toContainText('1 open note')
})

test('the export names every reviewer and never says CLEARED over an objection', async ({ page }) => {
  await signIn(page, 'admin')
  const md = await (await page.goto('/admin/export?all=1'))!.text()
  expect(md).toContain('## cta-cut — v1 — CLEARED TO POST (Dana Reviewer: approved)')
  expect(md).toContain('## hook-test-b — v2 — CLEARED TO POST (Dana Reviewer: approved)')
  // ⚠️ The split video appears with both answers and WITHOUT the clearance line. An export that
  // says CLEARED over a `changes_needed` is the paste that gets the objection posted past.
  expect(md).toContain('## split-cut — v1 — NOT CLEARED')
  expect(md).toContain('Flood Reviewer: changes needed')
  expect(md).not.toContain('## split-cut — v1 — CLEARED TO POST')
})

/**
 * ⚠️ ASSERTED AGAINST `?all=1`, AND THAT IS THE WHOLE POINT OF THIS TEST.
 * The first version checked the DEFAULT export — where hook-test-b's v1 note is resolved and
 * therefore hidden, so no v1 heading is emitted at all and there is nothing for the assertion to
 * bind to. It passed with the version guard deleted. `?all=1` is the only state in which the older
 * heading exists, so it is the only state in which "did it borrow the current verdict?" is a
 * question that can be answered.
 */
test('an older version does not borrow the current verdict', async ({ page }) => {
  await signIn(page, 'admin')
  const md = await (await page.goto('/admin/export?all=1'))!.text()
  // The v1 heading must exist, or the next assertion proves nothing.
  expect(md).toContain('## hook-test-b — v1')
  expect(md).not.toContain('## hook-test-b — v1 — CLEARED')
  expect(md).toContain('## hook-test-b — v2 — CLEARED TO POST')
})

/**
 * ── The cache checks ────────────────────────────────────────────────────────────────────────
 *
 * `/admin` reads videos, notes, assignments and reviewers through a cache; the write routes
 * invalidate it by tag. These four prove that each tag is actually invalidated by each write that
 * changes it.
 *
 * ⚠️ EVERY ONE OF THEM DRIVES ITS OWN PRECONDITION, AND THAT IS NOT TIDINESS. The first version
 * inherited state from the test above it, and break-check CERTIFIED TWO OF THEM ANYWAY: it
 * verifies that the named spec went red on an `expect`, which cannot tell "red because of the
 * break" from "red standalone for an unrelated reason". Run alone, two of the four were failing
 * whatever the code did, and a third passed against the seed's own `not finished` without the
 * reopen ever happening. A test that needs its neighbours cannot be break-checked, because
 * break-check runs it with `-g`.
 *
 * ⚠️ AND EACH ONE WRITES THE VALUE THE DASHBOARD IS NOT ALREADY SHOWING. Asserting a value that
 * happens to equal what was there proves nothing about a cache — a stale read would satisfy it.
 */
const api = async (page: import('@playwright/test').Page, who: 'dana' | 'flood') => {
  const ctx = await page.context().browser()!.newContext()
  const p = await ctx.newPage()
  await signIn(p, who)
  return { request: p.request, close: () => ctx.close() }
}

async function verdictAs(page: import('@playwright/test').Page, who: 'dana' | 'flood', slug: string, verdict: string) {
  const a = await api(page, who)
  expect((await a.request.post('/api/review-done', { data: { slug, verdict } })).status()).toBe(200)
  await a.close()
}

async function noteAs(page: import('@playwright/test').Page, who: 'dana' | 'flood', slug: string, body: string) {
  const a = await api(page, who)
  expect((await a.request.post('/api/notes', { data: { slug, t_seconds: 1, body } })).status()).toBe(201)
  await a.close()
}

const VID = 'equals-reel-final'
const adminRow = (page: import('@playwright/test').Page) =>
  page.getByTestId('admin-row').filter({ hasText: VID })

test('a verdict written now is on the dashboard now — the `assignments` tag', async ({ page }) => {
  await signIn(page, 'admin')
  await verdictAs(page, 'dana', VID, 'approved')
  await page.goto('/admin?tab=videos')   // warms the cache with "approved"
  await expect(adminRow(page).getByTestId('reviewer-verdicts')).toContainText('Dana Reviewer — approved')

  // The OTHER value, so a stale read cannot satisfy the assertion by accident.
  await verdictAs(page, 'dana', VID, 'changes_needed')
  await page.goto('/admin?tab=videos')
  await expect(adminRow(page).getByTestId('reviewer-verdicts')).toContainText('Dana Reviewer — changes needed')
})

test('the video status a verdict derives is on the dashboard now — the `videos` tag', async ({ page }) => {
  await signIn(page, 'admin')
  /**
   * ⚠️ THE CLEARING NOTE IS DANA'S, NEVER FLOOD'S. `rate-limit.spec.ts` deliberately posts twelve
   * notes as the flood reviewer to trip the ten-a-minute per-reviewer limit, and this file runs
   * seconds later — a note as Flood here comes back 429 and the failure lands in a test about
   * caching. The seed says as much: that reviewer exists so tripping the limit cannot lock other
   * specs out, and it only works if nothing else posts as them.
   */
  await noteAs(page, 'dana', VID, 'clearing my verdict so this test owns the state')
  await verdictAs(page, 'flood', VID, 'approved')
  await page.goto('/admin?tab=videos')
  // Flood has decided, Dana has not, so the video is not finished: status is awaiting_review.
  await expect(adminRow(page)).toContainText('awaiting_review')

  // Dana answering makes every assignee decided, the only thing that moves videos.status.
  await verdictAs(page, 'dana', VID, 'approved')
  await page.goto('/admin?tab=videos')
  await expect(adminRow(page)).toContainText('reviewed')
})

test('a note that reopens clears the verdict AND the status on the dashboard now — via /api/notes', async ({ page }) => {
  await signIn(page, 'admin')
  await verdictAs(page, 'dana', VID, 'approved')
  await verdictAs(page, 'flood', VID, 'approved')
  await page.goto('/admin?tab=videos')
  await expect(adminRow(page).getByTestId('reviewer-verdicts')).toContainText('Dana Reviewer — approved')
  await expect(adminRow(page)).toContainText('reviewed')

  // Dana holds a verdict, so THIS note reopens her review: /api/notes writes through setOutcome,
  // touching the assignment and the derived status — a different route from the two tests above.
  await noteAs(page, 'dana', VID, 'one more thing after finishing')
  await page.goto('/admin?tab=videos')
  await expect(adminRow(page).getByTestId('reviewer-verdicts')).toContainText('Dana Reviewer — not finished')
  await expect(adminRow(page)).toContainText('awaiting_review')
})

test('a note that changes no verdict is still counted on the dashboard now — the `notes` tag', async ({ page }) => {
  await signIn(page, 'admin')
  const unread = async () => {
    await page.goto('/admin?tab=videos')
    const cells = await adminRow(page).locator('td').allInnerTexts()
    return Number(cells[cells.length - 1].trim())
  }

  // Make sure Dana holds NO verdict, so the note below reopens nothing and `notes` is the only tag
  // that can carry it. Two writes, because clearing a verdict is itself a note.
  await verdictAs(page, 'dana', VID, 'approved')
  await noteAs(page, 'dana', VID, 'clearing my own verdict first')
  const before = await unread()

  await noteAs(page, 'dana', VID, 'and another, with no verdict standing')
  expect(await unread()).toBe(before + 1)
})
