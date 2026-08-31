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

  // The point of the phone rule: the video and the "Add note" button share the first screen, so
  // the reviewer is not scrolling away from the frame to write about it.
  const video = (await page.getByTestId('player').boundingBox())!
  const add = (await page.getByTestId('add-note').boundingBox())!
  expect(video.y).toBeGreaterThanOrEqual(0)
  expect(add.y + add.height).toBeLessThanOrEqual(844)
  expect(video.width).toBeLessThanOrEqual(390)

  // And a note can still be written and read back at this width.
  await page.getByTestId('add-note').click()
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
