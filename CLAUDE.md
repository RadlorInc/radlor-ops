@AGENTS.md

# A check must state the intent independently of the code

House rule, carried here deliberately rather than referenced: this is a **separate repo** from
milo-story-mode, so nobody working in it will ever read that repo's `CLAUDE.md`. The rule caught two
defects in this repo on its first day, which is the whole argument for it travelling.

> **A check must state the intent independently of the code. If it imports the value it asserts,
> greps the file the value lives in, or otherwise derives its expectation from the thing under test,
> it is tautological: it passes because the code equals itself, and it will pass through any change
> you make.**

And its second half:

> **It is not just WHAT you assert, it is AT WHICH STATE OF THE UI.** Drive the interface to the
> state the defect lives in before you measure. If a defect only exists after a click, the assertion
> goes after the click.

Both were found the only way they can be found: **by watching the check fail on the broken state
before trusting it**. Run `scripts/break-check.sh <spec> "<break>"` — it stashes, applies the break,
runs the suite and restores unconditionally, so the discipline lives in a file rather than in your
attention.

⚠️ **And the rule turns on its own instruments.** The first version of that script exited 0 when the
suite *passed* on the broken state — the tool built to catch decorative checks reported its own
worst outcome as success. The second version accepted **any** red as proof, which would have
certified a check that goes red because you deleted a semicolon. It now requires the red to come
from the named spec's own `expect(...)`. **Check the checker with the question you check everything
else with: what result is this incapable of distinguishing?**

## The two that got through, in this repo

| what it looked like | what it was |
|---|---|
| `e2e/review-page-details.spec.ts` asserting the seven review questions appear verbatim | it `import`ed `QUESTIONS` from `src/lib/review.ts` and looped `toContainText`. Reworded question 7 to *"One thing to cut."* and it **stayed green** — it was asserting that the code equals itself. The seven strings are now written out in the spec and deep-equalled against the rendered `<li>`s. **The duplication is the mechanism**: changing a question takes two edits, and the failing test in between is the reminder that the wording is a decision, not a detail |
| `e2e/phone.spec.ts` asserting the *Add note* button fits a 390×844 viewport | the right property, one click too early. An uncapped 9:16 video is ~622px tall so the BUTTON still fits; it is the note COMPOSER, which only exists after the click, that falls off the bottom. It passed with the phone media query deleted. Now asserts the video's height against the viewport **and** the Save button's bottom edge *after* opening the composer |

## The rest of the standing rules for this repo

- **A defect noticed in a neighbouring file gets written down before you return to the one you were in** — in that file, or in that repo's handoff. Two minutes, so it survives being busy. Both verification scripts here put a secret within one branch of their own output at some point; the second was *described* while the first was being fixed, and only got fixed because someone asked again. Noticing is not the deliverable; the note is.
- **Never log a reviewer token, in any environment.** `src/lib/db.ts` is the only place a token is
  ever put in a URL, and `rest()` takes a `label` precisely so a thrown error can never stringify
  the request path. A fetch error that echoes its own URL is how a token reaches a log drain in
  plain text, and it looks like ordinary error handling in the diff.
- **`SUPABASE_SERVICE_ROLE_KEY` is server-only and must never carry a `NEXT_PUBLIC_` prefix.** There
  are no `NEXT_PUBLIC_` variables in this app at all — the browser never talks to Supabase. `npm run
  build` with a canary value in the env and a `grep -r` over `.next/static` is the check.
- **Unknown, revoked and malformed tokens get the same 404**, page and API alike. A different answer
  for "revoked" tells whoever is holding it that the token was once real.
- **The `review` schema is a namespace, not a boundary.** This tool shares the `radlor-site`
  Supabase project (free tier: two projects max). Its routes hold that project's `service_role`
  key, which is per-PROJECT and bypasses RLS, so a compromise here reads and writes
  `public.waitlist` — emails and children's age-bands. Accepted, costed at 5–7 hours to fix
  properly, and declined because `radlor-site`'s own public `/api/waitlist` route already holds the
  same key over the same table. ⚠️ **The decision was made about a table with ZERO rows. It reopens
  when that table holds real people** — `scripts/check-blast-radius.mjs` prints the count and says
  so. Sharing with the **Milo** project is still forbidden and does not become allowed if the tier
  gets tighter.
- **Every PostgREST call must carry `Accept-Profile` / `Content-Profile: review`.** Without it the
  request resolves against the default profile, `public`, which is the marketing site's schema.
  `test/fake-supabase.mjs` refuses a request without the header for exactly this reason: if the
  harness were lenient, dropping the header would break nothing locally and ship.
- **The offline harness proves this app's logic, not Supabase's.** `test/fake-supabase.mjs` runs the
  real migration in real Postgres, but only real PostgREST enforces RLS against `anon`. Until
  `scripts/check-anon-locked-out.mjs` has passed against the live project, the security posture is
  **unverified — not verified-by-stand-in**.
