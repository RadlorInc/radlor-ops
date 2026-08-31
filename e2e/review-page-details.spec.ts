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
 * ⚠️⚠️ THE SEVEN STRINGS BELOW ARE DUPLICATED FROM `src/lib/review.ts` ON PURPOSE.
 * DO NOT "DRY" THIS BY IMPORTING `QUESTIONS`. Doing so silently deletes the check.
 *
 * The first version of this test did exactly that — imported the constant and looped
 * `toContainText` over it — which asserts that the code equals itself and passes through any
 * change you make. Reworded question 7 to 'One thing to cut.' (the founder's line is 'One thing to
 * cut. Every draft has one.') and it STAYED GREEN.
 *
 * The house rule it broke: a check must state the intent independently of the code. If it imports
 * the value it asserts, greps the file that value lives in, or otherwise derives its expectation
 * from the thing under test, it is tautological.
 *
 * So the duplication IS the mechanism, not an oversight to tidy up: changing a question takes two
 * edits, and the failing test in between is the reminder that the wording is a DECISION — the
 * founder wrote these seven and asked for them verbatim — and not a detail. The deep-equal below
 * also catches a dropped question, a re-ordered one and an eighth, none of which a loop of
 * `toContainText` would notice.
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
