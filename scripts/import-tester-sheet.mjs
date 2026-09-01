/**
 * ONE-TIME import of `Chapter_Testing_tester2` into `review.issues`.
 *
 * ⚠️ ONCE. AFTER THIS THE DASHBOARD IS THE SOURCE OF TRUTH AND THE SHEET IS ARCHIVE. No sync back,
 * for the same reason as the to-do list: two places to edit one list ends with neither being right
 * and nobody noticing until a decision is made off the stale one.
 *
 * ⚠️ `reporter` IS NULL FOR EVERY ROW. These predate accounts, and attributing them to an invented
 * user would be inventing data. `imported_from` records where they came from instead.
 *
 * ⚠️ WHAT WAS TRANSFORMED, AND WHAT WAS NOT.
 *   • `Chapter` → `chapter` for `1` and `Measurement`; `All` becomes `all_chapters = true`, because
 *     it was never a chapter.
 *   • `Date` → `created_at`, parsed from `8 - 20 - 26`. ⚠️ ROW 13 HAS NO DATE IN THE SHEET; it gets
 *     the import time and is flagged below rather than given a plausible-looking one.
 *   • `Issue Category` → `area` verbatim, EXCEPT the two rows where the value is unambiguously a
 *     TYPE rather than a place (`Wording`, `Titles`). ⚠️ The other eleven are left as `area` with
 *     `type` null on purpose: back-classifying them would be me deciding what a tester meant, which
 *     is inventing data with extra steps. The split earns its keep on NEW issues, where the person
 *     filing picks both.
 *   • Descriptions, spelling and all, are imported byte-for-byte.
 *
 *   node --env-file=.env.local scripts/import-tester-sheet.mjs [--commit]
 */

/** [category, ageGroup, chapter, description, status, date] — verbatim from the sheet. */
const ROWS = [
  ['Answer choice options', '3-5', '1', 'The first action I recieved was to place 6 objects infront of the child and have them count outloud, touching each object. The question asks, "How did it go". The answer choices are "Yes, on their own", With a little help, Not yet". Grammaticaly, this could be improved. The question "How did it go" does not give a yes or no answer. Possible answer choices could be "My child was able to complete this activity on their own", "My child was able to complete the activity with a little help", and "My child was not able to complete this activity". Enhancing the option choices for these questions will grammatically improve the website.', 'Ready for Retest', '8 - 20 - 26'],
  ["Milo's voice", 'Any', '1', "Milo's robotic voice could be improved with a more kid friendly voice. As of right now, it sounds very robotic, which may not be appealing to users. ", 'Open', '8 - 20 - 26'],
  ['Turtle spacing', '3-5', '1', 'The turtles are lined up very close to each other I was unable to see all the numbers for the smallest first activity towards the end', 'Ready for Retest', '8 - 20 - 26'],
  ['Chapter ending star award pop up', '3-5', '1', 'After completing chapter 1, the star award pop up came on my screen. It says "Amazing!, Amazing! You are a star!". This could grammaticaly be improved. Instead of saying amazing twice. You could change it to something along the lines of "Activity Completed! Wow! You\'re doing great!". A choice of wording that doesnt sound repetitive. ', 'Resolved', '8 - 26 - 26'],
  ['Smallest first game', '3-5', '1', 'For the bunny animals, all the children bunnies are evenly spaced behind the mother, however for the fish, butterflies, turtles, ladybugs, and squirrels, they are randomly placed behind the mother. They would look more uniform if they were evenly spaced out. ', 'Ready for Retest', '8 - 26- 26'],
  ['Nest game', '3-5', '1', 'The robot voice instructions need to be more sharpened. "Feed the duckling in nest number 7, click on the duckling thats nest say\'s number 7", will sharpen up the instructions. And instead of the check sign just appearing on the screen, the voice could say "great job!" or "great!", when the right answer choice is clicked. There should also be a repeat question button, and subtitles for the question. ', 'Resolved', '8 - 26 - 26'],
  ['Send milo game', '3-5', '1', 'I noticed this game has a Ready option, this feature should be added to all other games or activities, so users can submit their answer when they are ready.', 'Resolved', '8 - 26 - 26'],
  ['Saving game status', '3-5', '1', 'Mid game, i left to go visit another part of the website. When I came back, none of my progress saved and I had to restart the feeding nest game. The game should pick up exactly where the user left off.', 'Ready for Retest', '8 - 26 - 26'],
  ['Shape House', '3-5', '1', "In the Milo's house game. The same update is required. Instead of Milo saying \"yes\" when the correct answer is chosen, he should say something along the lines of \"great job\", or \"good job\". Additionally when I got the hull part, Milo's voice seems to not speak.", 'Ready for Retest', '8 - 29 - 26'],
  ['In general', '3-5', '1', 'Milos voice seems to not be working? I dont hear the audio', 'Ready for Retest', '8 - 29 - 26'],
  ['Measurement Name', '3-5', 'Measurement', 'The title for this chapter should be changed to "Measuring"', 'Ready for Retest', '8 - 29 - 26'],
  ['Wording', '3-5', 'Measurement', 'Instead of it saying "Take one back", it should say "Add block" and "Remove Block" to keep it simple and straight to the point. There should also be (this goes for all chapters) a little box in the top left or right corner that has word typed directions for people to follow. It could be very simple, but just to have something typed out streamlines the experience. ', 'Ready for Retest', '8 - 29 - 26'],
  ['Titles', '3-5', 'All', 'Any "shall" should be changed to "should".', 'Open', ''],
]

/** The only two values that are a TYPE rather than a place. Everything else stays an `area`. */
const TYPES = new Set(['Wording', 'Titles'])
const STATUS = { Open: 'open', 'Ready for Retest': 'ready_for_retest', Resolved: 'resolved' }

/** `8 - 26- 26` and `8 - 20 - 26` both appear. Two formats in thirteen rows is why nobody should
 *  type a date. */
function parseDate(raw) {
  const m = raw.replace(/\s+/g, '').match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/)
  if (!m) return null
  return new Date(Date.UTC(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12)).toISOString()
}

const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const commit = process.argv.includes('--commit')
if (!base || !key) {
  console.error('usage: node --env-file=.env.local scripts/import-tester-sheet.mjs [--commit]')
  process.exit(2)
}
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'review', 'Content-Profile': 'review' }

const existing = await (await fetch(`${base}/rest/v1/issues?select=id`, { headers: H })).json()
if (!Array.isArray(existing)) {
  console.error('could not read review.issues:', JSON.stringify(existing).slice(0, 200))
  process.exit(1)
}
if (existing.length > 0) {
  console.error(`✗ review.issues already has ${existing.length} row(s). This import runs ONCE.`)
  process.exit(1)
}

const undated = []
const rows = ROWS.map(([category, age, chapter, description, status, date], i) => {
  const isType = TYPES.has(category)
  const created = parseDate(date)
  if (!created) undated.push(i + 1)
  return {
    imported_from: 'Chapter_Testing_tester2',
    reporter: null,
    description,
    area: isType ? null : category,
    type: isType ? category : null,
    chapter: chapter === 'All' ? null : chapter,
    all_chapters: chapter === 'All',
    age_band: age === 'Any' ? 'any' : age,
    status: STATUS[status],
    // ⚠️ ALWAYS PRESENT, even when the sheet had no date. PostgREST rejects a bulk insert whose
    // objects have different key sets (`PGRST102: All object keys must match`), so omitting it for
    // the one undated row failed the whole batch. It gets the import time — flagged above, never
    // given a plausible-looking date it did not have.
    created_at: created ?? new Date().toISOString(),
  }
})

const byStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})
console.log(`${rows.length} issue(s) to import from Chapter_Testing_tester2\n`)
console.log(`  status:  ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  type set on: ${rows.filter((r) => r.type).map((r) => r.type).join(', ') || 'none'}  (the other ${rows.filter((r) => !r.type).length} keep the value as \`area\`)`)
console.log(`  all_chapters: ${rows.filter((r) => r.all_chapters).length}`)
console.log(`  reporter: null on every row — these predate accounts`)
if (undated.length) console.log(`  ⚠️ row(s) ${undated.join(', ')} have NO DATE in the sheet; they get the import time, not a plausible-looking one`)
console.log()

if (!commit) {
  console.log('DRY RUN. Nothing written. Re-run with --commit.')
  process.exit(0)
}

const res = await fetch(`${base}/rest/v1/issues`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows) })
if (!res.ok) {
  console.error(`insert failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const written = await res.json()
const after = await (await fetch(`${base}/rest/v1/issues?select=id,status,all_chapters,type`, { headers: H })).json()
console.log(`inserted ${written.length}, read back ${after.length}`)
console.log(after.length === rows.length ? '\nPASS — the sheet is now archive. Do not edit it; edit /tester.' : '\nFAIL — row count does not match.')
process.exit(after.length === rows.length ? 0 : 1)
