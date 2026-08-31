/** The seven questions, verbatim. They live on the page, collapsed, because the alternative is an
 *  email the reviewer has lost by the second video. */
export const QUESTIONS: readonly string[] = [
  'First two seconds — you’re scrolling. Does this stop you? If not, what would?',
  'The claim — say back what this video is claiming, in one sentence, without rewatching.',
  'Where you’d drop off — name the timestamp your attention went. There’s always one.',
  'The CTA — is it clear what you’re being asked to do, and does it come at the right moment?',
  'Platform fit — Reels, TikTok, Shorts: all, or only some? What changes per platform?',
  'The caption and hashtags, separately from the video.',
  'One thing to cut. Every draft has one.',
]

/** `0:03`, `1:07`, `12:04`. Seconds are already integers by the time they reach here. */
export function formatT(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
