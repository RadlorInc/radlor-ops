/**
 * Validates the config files the PLATFORM parses, against their own published schemas.
 *
 * ⚠️ THIS EXISTS BECAUSE NOTHING ELSE IN THIS REPO CAN SEE THESE FILES. `vercel.json` is read by
 * Vercel at build time — `tsc`, eslint and 60 Playwright specs were all green while it contained a
 * key that made the production build fail schema validation. Every check we had was blind to it by
 * construction, and the first thing that noticed was a failed deploy.
 *
 * The key was `"//"`, used as a comment. JSON has no comments and the schema sets
 * `additionalProperties: false`, so an unknown top-level key is a hard error. The explanation
 * belongs in a commit message or the handoff, not in the file.
 *
 * ⚠️ WHAT THIS ACTUALLY CHECKS, WHICH IS LESS THAN "THE FILE IS VALID": it fetches the schema the
 * file itself names in `$schema` and asserts that every TOP-LEVEL KEY is one the schema declares.
 * That is the exact class that broke the build, and it is authoritative because the rule comes from
 * Vercel's own schema rather than from a list copied into this repo. It does NOT check the types or
 * shapes of the values — `{"regions": 5}` would pass here and fail at Vercel. Saying so is the
 * point; a check that is described as more than it is, is worse than none.
 *
 * ⚠️ AND IT FAILS CLOSED. If the schema cannot be fetched it exits non-zero, because "I could not
 * check" must never read the same as "it is fine" — the whole reason this file exists.
 *
 *   node scripts/check-config.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['vercel.json']

let bad = 0

for (const name of FILES) {
  let doc
  try {
    doc = JSON.parse(await readFile(join(ROOT, name), 'utf8'))
  } catch (e) {
    console.error(`✗ ${name} is not valid JSON: ${e.message}`)
    bad++
    continue
  }

  const url = doc.$schema
  if (!url) {
    console.error(`✗ ${name} has no $schema, so there is nothing to validate it against.`)
    bad++
    continue
  }

  let schema
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    schema = await res.json()
  } catch (e) {
    console.error(`✗ could not fetch ${url}: ${e.message}`)
    console.error('  Failing rather than skipping: an unchecked config file is what this catches.')
    bad++
    continue
  }

  const allowed = new Set([...Object.keys(schema.properties ?? {}), '$schema'])
  const unknown = Object.keys(doc).filter((k) => !allowed.has(k))
  if (unknown.length) {
    console.error(`✗ ${name}: ${unknown.map((k) => `"${k}"`).join(', ')} — not in the schema.`)
    console.error('  Vercel sets additionalProperties:false, so the build fails on these.')
    console.error('  If one of them was meant as a comment: JSON has none. Put it in the commit message.')
    bad++
    continue
  }

  console.log(`✓ ${name}: ${Object.keys(doc).length} top-level key(s), all declared by the schema`)
}

process.exit(bad ? 1 : 0)
