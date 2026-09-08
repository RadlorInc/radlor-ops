import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

async function rows(request: import('@playwright/test').APIRequestContext, table: string, q = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`, {
    headers: { 'Accept-Profile': 'review' },
  })
  return (await res.json()) as Record<string, string>[]
}

/**
 * DELETING A CUT TAKES ITS NOTES AND ITS VERDICTS WITH IT.
 *
 * ⚠️ THE CASCADE IS THE ASSERTION, NOT THE ROW GOING. `delete from videos` is one statement and the
 * children disappear through foreign keys that nothing in this codebase mentions at the call site —
 * so a spec that only checked the video row would pass just as happily against a build that left
 * orphaned notes and assignments pointing at nothing. `split-cut` is the fixture with both: two
 * reviewers who disagree, and a note.
 *
 * ⚠️ AND IT USES `doomed-cut`, NOT `split-cut`. Every other spec in this suite reads `split-cut`
 * — deleting it here would make those pass or fail on which file ran first, which is the exact
 * cross-test dependency this repo has already been bitten by. `doomed-cut` exists as its own
 * fixture with the same shape.
 */
test('deleting a video destroys its notes and its verdicts, not just the row', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const [video] = await rows(request, 'videos', '&slug=eq.doomed-cut')
  expect(video).toBeTruthy()
  /**
   * ⚠️ BOTH CHILDREN MUST BE NON-EMPTY BEFORE THE DELETE, ASSERTED RATHER THAN ASSUMED. The first
   * version of this spec checked that no notes remained afterwards — and `doomed-cut` had none
   * to begin with, so that line was green before the button was pressed and would have stayed
   * green on a build that orphaned every note in the table. The seed now carries a note on this
   * video for exactly this reason, and these two lines are what stop it quietly going away again.
   */
  const assignmentsBefore = await rows(request, 'video_reviewers', `&video_id=eq.${video.id}`)
  const notesBefore = await rows(request, 'notes', `&video_id=eq.${video.id}`)
  expect(assignmentsBefore.length).toBeGreaterThan(1)
  expect(notesBefore.length).toBeGreaterThan(0)

  const row = page.getByTestId('admin-row').filter({ hasText: 'doomed-cut' })
  await row.getByTestId('video-delete').click()

  // ⚠️ THE CONFIRM MUST NAME WHAT IT DESTROYS. An "Are you sure?" that does not mention the two
  // reviewers is the version somebody clicks through, and the notes are the unrecoverable half.
  const confirm = row.getByTestId('video-delete-confirm')
  await expect(confirm).toContainText('doomed-cut')
  await expect(confirm).toContainText('2 reviewers')
  await expect(confirm).toContainText('cannot be undone')

  // ⚠️ AND "KEEP IT" MUST ACTUALLY KEEP IT. A cancel that still deleted would look identical on
  // screen for the moment before the refresh.
  await row.getByTestId('video-delete-cancel').click()
  expect((await rows(request, 'videos', '&slug=eq.doomed-cut')).length).toBe(1)

  await row.getByTestId('video-delete').click()
  await row.getByTestId('video-delete-really').click()

  /**
   * ⚠️ THE DATABASE IS POLLED, THE SCREEN IS ASSERTED AFTER. Waiting for the row to vanish first
   * reads better and fails worse: a delete that is REFUSED — a missing grant, a foreign key that
   * restricts instead of cascading — leaves the row on screen, so the wait runs out and the suite
   * reports a 120-second timeout. A timeout says "something hung"; `expected 0, received 1` says
   * which rule broke. `break-check.sh` agrees: it refuses to certify a red that is not an
   * assertion, and refused this one until the order changed.
   */
  await expect.poll(async () => (await rows(request, 'videos', '&slug=eq.doomed-cut')).length).toBe(0)
  expect(await rows(request, 'video_reviewers', `&video_id=eq.${video.id}`)).toEqual([])
  expect(await rows(request, 'notes', `&video_id=eq.${video.id}`)).toEqual([])
  await expect(page.getByTestId('admin-row').filter({ hasText: 'doomed-cut' })).toHaveCount(0)
})

/**
 * ⚠️ AND NOBODY BUT AN ADMIN CAN DO IT, THROUGH THE ROUTE RATHER THAN THROUGH THE MISSING BUTTON.
 * A reviewer never sees this control, so a UI-only check cannot tell "the route refuses" from "the
 * button was never rendered" — and the route is the thing that deletes.
 */
test('a reviewer cannot delete a video, and the video is still there afterwards', async ({ page, request }) => {
  await signIn(page, 'dana')
  const [video] = await rows(request, 'videos', '&slug=eq.cta-cut')

  const res = await page.request.delete('/api/admin/video', { data: { id: video.id } })
  expect(res.status()).toBe(404)
  expect((await rows(request, 'videos', '&slug=eq.cta-cut')).length).toBe(1)
  expect(USERS.dana).toBeTruthy()
})
