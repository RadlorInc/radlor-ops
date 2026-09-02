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
 * ⚠️ WHAT THIS CHECKS: the WHOLE document against the schema the file itself names in `$schema`.
 * The first version only compared top-level KEY NAMES, which caught the `"//"` that broke the build
 * and left `{"regions": 5}` passing here and failing at Vercel — most of the schema was already in
 * hand and unread. Validating properly costs a few lines, so it does.
 *
 * ⚠️ THE SCHEMA MISLABELS ITSELF, AND THIS FILE OVERRIDES IT DELIBERATELY. Vercel's schema
 * declares `$schema: draft-04`, and it is not draft-04: it uses a numeric `exclusiveMinimum` and an
 * object-valued `additionalProperties`, both of which are draft-06+. Registering the draft-04
 * meta-schema and taking the declaration at its word makes ajv reject the SCHEMA — sixteen errors,
 * none of them about our file. So the declaration is dropped and it is compiled as draft-07, which
 * is what its contents actually are. Recorded rather than quietly worked around, because "the
 * validator rejected the vendor's schema" is a confusing thing to meet cold.
 *
 * `ajv` is in devDependencies rather than reached for through eslint's tree — a check that depends
 * on a package nobody declared is a check that disappears on somebody else's lockfile update.
 *
 * ⚠️ AND IT FAILS CLOSED. If the schema cannot be fetched it exits non-zero, because "I could not
 * check" must never read the same as "it is fine" — the whole reason this file exists.
 *
 *   node scripts/check-config.mjs
 */
import Ajv from 'ajv'
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

  const ajv = new Ajv({ allErrors: true })
  // See the header: the declaration is wrong about its own contents, so it is compiled as draft-07.
  delete schema.$schema

  // `$schema` is ours, not the config's — the schema does not declare it and would reject it.
  const body = { ...doc }
  delete body.$schema

  let validate
  try {
    validate = ajv.compile(schema)
  } catch (e) {
    console.error(`✗ could not compile the schema from ${url}: ${e.message}`)
    console.error('  Failing rather than skipping — see the header.')
    bad++
    continue
  }

  if (!validate(body)) {
    console.error(`✗ ${name} does not match its schema:`)
    for (const err of validate.errors ?? []) {
      const at = err.dataPath || '(root)'
      console.error(`    ${at} ${err.message}${err.params?.additionalProperty ? ` — "${err.params.additionalProperty}"` : ''}`)
    }
    console.error('  If one of them was meant as a comment: JSON has none. Put it in the commit message.')
    bad++
    continue
  }

  console.log(`✓ ${name}: valid against ${url} (${Object.keys(body).length} key(s) checked, values included)`)
}

process.exit(bad ? 1 : 0)
