import { expect, test } from '@playwright/test'
import { SUPABASE_URL, USERS } from './tokens'
import { signIn } from './signIn'

/**
 * THE ADMIN CAN READ THE FEEDBACK, NOT ONLY COUNT IT.
 *
 * Rafi, 2026-09-10: *"as an admin the notes the reviewer left for changes, I can't see them at
 * all."* He was right — the table had an *Unread notes* column and the words themselves existed
 * only in `/admin/export`, a plain-text page behind a small link. Three real notes were in the
 * production database while the dashboard showed nothing but a number.
 *
 * ⚠️ THE NOTE BODIES ARE WRITTEN OUT HERE RATHER THAN IMPORTED FROM `test/seed.sql`. Reading them
 * out of the seed would assert that the fixture equals itself and would pass through any change to
 * what the page renders. The duplication is the mechanism: changing a seeded note takes two edits.
 *
 * ⚠️ AND NOTHING IS CLICKED BEFORE THE FIRST ASSERTION. The complaint was about what the tab shows
 * when it loads, so a test that expanded a disclosure first would pass on the build being
 * complained about. `cta-cut` carries an unread note, which is what makes it open on arrival.
 */

test('the note a reviewer left is on the dashboard, in words, attributed, without a click', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const cta = page.getByTestId('video-notes').filter({ has: page.locator('code', { hasText: 'cta-cut' }) })
  await expect(cta).toContainText('good to go, but the caption needs the hashtag trimmed')
  // The moment it was left, and who left it. A wall of anonymous text is not readable feedback.
  await expect(cta).toContainText('0:07')
  await expect(cta).toContainText('Dana Reviewer')
})

/**
 * ⚠️ `hook-test-b` IS THE ONLY FIXTURE THAT CAN CARRY THIS. It is at v2 with a RESOLVED v1 note and
 * an open v2 one, so it is the one row where "did the page put an old round's note under the
 * current one" is a question with a wrong answer available. Every other video has a single round,
 * where a broken version split and a correct one look identical.
 *
 * ⚠️ IT ASSERTS COUNTS OF NOTHING. `e2e/verdict.spec.ts` adds another v2 note to this video, so any
 * assertion about how many notes are on screen would report which spec ran first.
 */
test('an earlier cut’s notes stay under the earlier cut, and an acted-on note reads as done', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const hook = page.getByTestId('video-notes').filter({ has: page.locator('code', { hasText: 'hook-test-b' }) })
  const v1 = hook.locator('[data-version="1"]')
  const v2 = hook.locator('[data-version="2"]')

  await expect(v1).toContainText('the logo lands too late')
  await expect(v2).toContainText('the text is still small on a phone')
  // The half that matters: the old note must NOT be sitting under the current version.
  await expect(v2).not.toContainText('the logo lands too late')
  await expect(v1).toContainText('an earlier cut')

  /**
   * ⚠️ THE COMPUTED STYLE, NOT THE CLASS NAME. Asserting `class="strike"` would assert that the
   * component still spells it the way the component spells it. `line-through` is what a person
   * looking at the screen can tell apart, and it survives the styling being renamed.
   */
  const resolved = hook.getByTestId('admin-note').filter({ hasText: 'the logo lands too late' }).getByTestId('note-body')
  const open = hook.getByTestId('admin-note').filter({ hasText: 'still small on a phone' }).getByTestId('note-body')
  await expect(resolved).toHaveCSS('text-decoration-line', 'line-through')
  await expect(open).not.toHaveCSS('text-decoration-line', 'line-through')
})

/** A reviewer must not reach this page at all — the notes here are everybody's, and one reviewer
 *  seeing another's is the thing `notes` has been keyed to prevent since the first migration. */
test('a reviewer cannot open the page these notes are on', async ({ page }) => {
  await signIn(page, 'dana')
  expect((await page.goto('/admin?tab=videos'))?.status()).toBe(404)
})

/**
 * ── THE ADMIN SENDS FEEDBACK TOO ────────────────────────────────────────────────────────────────
 *
 * Rafi, 2026-09-10. The capability was always there — `/review` accepts an admin and `/api/notes`
 * stopped asking about assignments on 2026-09-09 — but the only door was the *My reviews* tab, and
 * **no test proved an admin could write a note at all**: every spec that saves one signs in as a
 * reviewer. So this covers two things that were separately unproven, the identity and the door.
 *
 * ⚠️ IT USES `flood-only`. The admin is that cut's approver, so it is the one the dashboard's
 * player is most likely to be opened on — and its note count is asserted by nothing, unlike
 * `cta-cut`, whose single open note is named in two other specs' banners.
 */
test('the admin leaves a timestamped note from the player, and it lands under their own name', async ({ page, request }) => {
  await signIn(page, 'admin')
  await page.goto('/admin?tab=videos')

  const row = page.getByTestId('admin-row').filter({ has: page.locator('code', { hasText: 'flood-only' }) })
  await row.getByTestId('admin-watch').click()
  await expect(row.getByTestId('admin-player')).toBeVisible()

  // ⚠️ PLAY FIRST, SO A CAPTURED 0:00 CANNOT BE A FALSE PASS. A composer that ignored the video
  // and stamped every note at zero would pass a test that never moved the playhead.
  const player = row.getByTestId('admin-player')
  await player.evaluate((v: HTMLVideoElement) => v.play())
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(1)

  await row.getByTestId('admin-add-note').click()
  // Opening the composer pauses playback, or the timestamp stops describing what is on screen.
  expect(await player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  const at = (await row.getByTestId('admin-draft-time').textContent())!
  expect(at).not.toBe('0:00')

  await row.getByTestId('admin-note-body').fill('the hook needs a beat less air before the first cut')
  await row.getByTestId('admin-save-note').click()
  await expect(row.getByTestId('admin-note-saved')).toContainText('Saved at')
  await expect(row.getByTestId('admin-note-error')).toHaveCount(0)

  /**
   * ⚠️ READ OUT OF THE DATABASE, NOT OFF THE PANEL THAT JUST WROTE IT. A composer that showed
   * "Saved" while the row never landed is the failure this assertion exists for — and the note has
   * to be attributed to the ADMIN, which is the half that proves an admin identity can write at
   * all rather than merely that some row appeared.
   */
  const notes = await request
    .get(`${SUPABASE_URL}/rest/v1/notes?select=body,t_seconds,reviewer_id&reviewer_id=eq.${USERS.harnessAdmin}`, {
      headers: { 'Accept-Profile': 'review' },
    })
    .then((r) => r.json() as Promise<{ body: string; t_seconds: number }[]>)
  const mine = notes.find((n) => n.body.startsWith('the hook needs a beat'))
  expect(mine).toBeTruthy()
  expect(mine!.t_seconds).toBeGreaterThan(0)

  /**
   * ⚠️ AND IT SHOWS UP WHERE EVERYBODY ELSE'S NOTES ARE, AFTER A RELOAD. The dashboard reads notes
   * through a cache that `/api/notes` invalidates, so this crosses from the write to the screen the
   * admin actually looks at. Reloaded rather than trusting the composer's `router.refresh()` to
   * repaint — see the handoff; the note is saved either way and the panel says so.
   */
  await page.reload()
  const block = page.getByTestId('video-notes').filter({ has: page.locator('code', { hasText: 'flood-only' }) })
  await expect(block).toContainText('the hook needs a beat less air')
  await expect(block).toContainText('Harness Admin')
})
