import { expect, test } from '@playwright/test'
import { TOKENS } from './tokens'

/** The reviewer may well watch on a phone. iPhone 14-ish logical viewport. */
test.use({ viewport: { width: 390, height: 844 } })

test('the review page works at a phone width', async ({ page }) => {
  await page.goto(`/r/${TOKENS.valid}/equals-reel-final`)
  await expect(page.getByTestId('player')).toBeVisible()

  // Nothing may push the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  /**
   * The point of the phone rule: the video and the composer share the first screen, so the
   * reviewer is not scrolling away from the frame to write about it.
   *
   * ⚠️ THE FIRST VERSION OF THIS TEST ONLY ASSERTED THAT "Add note" LANDED ABOVE 844px, AND IT
   * PASSED WITH THE PHONE RULE DELETED — an uncapped 9:16 video is ~622px tall, which still leaves
   * the button on screen at this viewport height. It is the COMPOSER, one click later, that falls
   * off the bottom. Both assertions below fail without the rule.
   */
  const video = (await page.getByTestId('player').boundingBox())!
  expect(video.width).toBeLessThanOrEqual(390)
  expect(video.height).toBeLessThanOrEqual(844 * 0.6)

  await page.getByTestId('add-note').click()
  const save = (await page.getByTestId('save-note').boundingBox())!
  expect(save.y + save.height).toBeLessThanOrEqual(844)

  // And a note can still be written and read back at this width.
  await page.getByTestId('note-body').fill('text is too small on a phone')
  await page.getByTestId('save-note').click()
  await expect(page.getByTestId('note-list')).toContainText('text is too small on a phone')
})

test('the reviewer list works at a phone width', async ({ page }) => {
  await page.goto(`/r/${TOKENS.valid}`)
  await expect(page.getByText('Equals sign reel (final cut)')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
