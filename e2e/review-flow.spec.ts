import { expect, test } from '@playwright/test'
import { signIn } from './signIn'

/** Done-means #1: a reviewer with a valid link can watch a video, leave a note at a timestamp,
 *  reload, and see it still there. */
test('a note is attached to the second it was taken at, and survives a reload', async ({ page }) => {
  await signIn(page, 'dana')
  await page.goto('/review')
  await page.getByText('Equals sign reel (final cut)').click()

  const player = page.getByTestId('player')
  await expect(player).toBeVisible()

  // Play far enough in that a captured timestamp of 0:00 could not be a false pass.
  await player.evaluate((v: HTMLVideoElement) => v.play())
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThan(1.5)

  await page.getByTestId('add-note').click()

  // "Add note" pauses playback — otherwise the video runs on while the reviewer types and the
  // timestamp stops describing what they are looking at.
  expect(await player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)

  const at = (await page.getByTestId('draft-time').textContent())!
  expect(at).not.toBe('0:00')

  await page.getByTestId('note-body').fill('hook is still building, I would have scrolled')
  await page.getByTestId('save-note').click()
  await expect(page.getByTestId('note-list')).toContainText('hook is still building')

  await page.reload()
  const list = page.getByTestId('note-list')
  await expect(list).toContainText('hook is still building')
  // The timestamp, not just the text: the note has to come back attached to the same second.
  await expect(list).toContainText(at)
})
