import { expect, test } from '@playwright/test'
import { TOKENS } from './tokens'

/** The three spec items a status code cannot prove: the watermark, `controlsList="nodownload"`,
 *  and the seven-question panel. */

const PAGE = `/r/${TOKENS.valid}/equals-reel-final`

test('the player carries the download and PiP deterrents', async ({ page }) => {
  await page.goto(PAGE)
  const player = page.getByTestId('player')
  await expect(player).toHaveAttribute('controlsList', 'nodownload')
  await expect(player).toHaveAttribute('disablepictureinpicture', '')
})

test('the watermark shows who is watching, and does not eat clicks', async ({ page }) => {
  await page.goto(PAGE)
  const mark = page.getByTestId('watermark')
  await expect(mark).toContainText('Dana Reviewer')
  await expect(mark).toContainText('dana@example.com')
  // Low opacity, and transparent to the mouse — it sits over the video controls.
  const style = await mark.evaluate((el) => {
    const s = getComputedStyle(el)
    return { opacity: Number(s.opacity), pointer: s.pointerEvents }
  })
  expect(style.opacity).toBeGreaterThan(0)
  expect(style.opacity).toBeLessThan(0.4)
  expect(style.pointer).toBe('none')
})

test('the watermark moves, so a crop cannot lose it', async ({ page }) => {
  await page.goto(PAGE)
  const mark = page.getByTestId('watermark')
  const before = await mark.boundingBox()
  // It shifts every 20 seconds. Waiting it out is the only honest way to see it happen.
  await page.waitForTimeout(22_000)
  const after = await mark.boundingBox()
  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(`${after!.x},${after!.y}`).not.toBe(`${before!.x},${before!.y}`)
})

/**
 * ⚠️ THESE ARE WRITTEN OUT HERE ON PURPOSE, not imported from `src/lib/review.ts`.
 * The first version of this test imported the constant and asserted the page contained each
 * entry — which passes no matter what the constant says. Reworded question 7 to
 * 'One thing to cut.' and it stayed green. A check that survives the bug it exists for has the
 * mechanism wrong, so the source of truth for "verbatim" now lives in the test, where an edit to
 * the app cannot move it.
 */
const SEVEN = [
  'First two seconds — you\u2019re scrolling. Does this stop you? If not, what would?',
  'The claim — say back what this video is claiming, in one sentence, without rewatching.',
  'Where you\u2019d drop off — name the timestamp your attention went. There\u2019s always one.',
  'The CTA — is it clear what you\u2019re being asked to do, and does it come at the right moment?',
  'Platform fit — Reels, TikTok, Shorts: all, or only some? What changes per platform?',
  'The caption and hashtags, separately from the video.',
  'One thing to cut. Every draft has one.',
]

test('the seven questions are on the page, verbatim, collapsed', async ({ page }) => {
  await page.goto(PAGE)
  const panel = page.locator('details.questions')
  // Collapsed by default — it is a reference, not the main event.
  expect(await panel.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false)

  await panel.locator('summary').click()
  // Deep equality on the rendered list: catches a reworded question, a dropped one, a re-ordered
  // one and an eighth one, none of which `toContainText` in a loop would notice.
  const rendered = await panel.locator('ol li').allInnerTexts()
  expect(rendered).toEqual(SEVEN)
})
