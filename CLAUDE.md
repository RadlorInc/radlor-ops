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

## Repository visibility

**This repo (`RadlorInc/radlor-ops`) is PRIVATE. `RadlorInc/website` and `RadlorInc/learn` are
PUBLIC.** Security findings — about this tool or about either of those — go in
[docs/security-findings.md](docs/security-findings.md), here. One was written into the public site
repo on 2026-08-31 and reverted the same day; the revert is mitigation, not erasure.
⚠️ **"Safe to break" and "safe to publish" are different questions.** Establish a remote's
visibility BEFORE the first push, not after — a first push publishes the whole history at once.

⚠️⚠️ **AND DO NOT ESTABLISH IT BY READING THIS PARAGRAPH.** The sentence above said PRIVATE on
2026-09-04 while GitHub said PUBLIC, and had done for five days — finding #10. A repo's visibility
is not a fact the repo can state about itself; it is one call to the system that owns the answer,
and it costs a second:

```bash
gh repo view RadlorInc/radlor-ops --json visibility
```

Same shape as `$schema` declaring a draft it is not, and as a migration comment claiming a grant it
does not hold. **Validate against what a thing IS, not what it says it is** — including this file.

### The third face: filtering on the property under test

Same disease, added 2026-09-01. `e2e/tester.spec.ts` asserted a new issue was flagged
`all_chapters`, and fetched the row with `?all_chapters=eq.true&order=created_at.desc&limit=1`.
Break the flag and the query returns an **older** row that already had it — green, on a build where
the feature was gone.

> **A filter that can only return rows already satisfying the assertion is not a query, it is a way
> of not looking.** Fetch the row by its identity — newest overall, or by id — then assert the
> property. The tell is a `WHERE` clause naming the same column as the `expect`.

So the rule has three faces, all of which pass because the code equals itself:
**(a)** grep-coupled to where a literal lives · **(b)** import-coupled to the value under test ·
**(c)** filter-coupled to the property under test.

### The fourth face: a check whose result depends on another check

Added 2026-09-02. Two specs in `e2e/verdict.spec.ts` both drove `split-cut` — one *wrote* verdicts
to prove a reviewer cannot overwrite another, the other *read* the seeded disagreement off `/admin`.
The reader passed or failed on which ran first.

> **A suite where one test's result depends on another's order reports test order, not behaviour.**
> It fails in both directions — green because the mutation happened to run last, red on a build
> that is fine. The fix is a fixture per spec (`overwrite-cut` now exists solely so `split-cut`
> stays a fixture), not a re-ordering, and not a restore step at the end of the mutating test.

⚠️ **And the fixtures have to be the cases the OLD code gets wrong**, or a break-check is theatre.
`quiet-draft` could not prove the new assignment filter: `status` already refused it on the build
being replaced, so it 404s either way. `flood-only` — reviewable, and somebody else's — can only be
refused by the assignment. Same for the clearing rule: "every assigned reviewer approved" and "the
`verdict` column says approved" agree on every 1:1 row, so a fixture where each video has one
reviewer passes against the code you just deleted. It took `split-cut`, with two reviewers who
disagree, before the check could tell the two rules apart. **Pick the fixture the old code answers
wrong; that is what makes the red mean something** — the same job the positive controls do in
`check-anon-locked-out.mjs`.

### The fifth face: a gap BETWEEN two passing tests

Added 2026-09-02. `/admin` reads through a cache and the write routes invalidate it by tag.
Deleting every `revalidateTag` call left the whole suite **green**. Two specs existed and both
passed: one *read* a verdict off the dashboard — a SEEDED one — and one *wrote* a verdict and read
it back **straight out of the database**. Neither was wrong. Nothing joined them, and the join was
exactly where the cache sits.

> **A gap between two passing tests is invisible in a way a failing test never is.** Coverage is
> counted per test, so nobody notices that no single test crosses from the write to the read the
> user actually looks at. Ask of any new layer: *which test goes all the way through it?* — and if
> the answer is two tests that each go half way, the layer is unwatched.

⚠️ **And "invalidation is tested" must not stand for one path out of five.** Enumerate the writes
that touch the cached data and prove each one separately; the same shape as three-of-four reading
as verified.

### ⚠️ break-check certifies RED, not red-BECAUSE-OF-THE-BREAK

Added 2026-09-02, from the same batch, and it is the sharper half. `scripts/break-check.sh` runs the
named spec with `-g` on a broken tree and passes when it goes red **on its own `expect`**. That is
not the same as failing *because of the break*. Four cache checks were written and break-check
said all four bound. Run alone on a HEALTHY tree, two of them were red anyway — they inherited
state from the tests above them, and `-g` runs them without it. A third passed against the seed's
own value without the code under test ever executing.

> **A test that depends on its neighbours cannot be break-checked, because break-check runs it
> alone.** Before trusting a green ✓ from it, run the spec by itself on an unbroken tree. And write
> the assertion against a value the write CHANGES — asserting what is already on screen is
> satisfied by the stale read you are trying to catch.

### Config the PLATFORM parses is outside every check we have

Added 2026-09-02. `vercel.json` was given a `"//"` key as a comment. JSON has no comments and
Vercel validates the file with `additionalProperties: false`, so **the production build failed** —
and `tsc`, eslint and 60 Playwright specs were all green while it did. Nothing in this repo reads
that file; the first thing that noticed was a broken deploy.

> **A file the platform parses at build time is invisible to every test we own. Validate it against
> its own published schema, or it is unverified — the same word we use for authorization the
> offline harness cannot see.**

`npm run check:config` fetches the schema each file names in `$schema` and validates the **whole
document** against it with ajv — types, item types, `minItems`, unknown keys, nested values. Proven
against five broken files, including the one that actually failed the deploy and the
`{"regions": 5}` the first version let through: that version compared only top-level key names,
which is most of a fetched schema left unread.

⚠️ It **fails closed** when the schema cannot be fetched or compiled, because "I could not check"
must never read as "it is fine" — the exact failure this file exists to prevent. ⚠️ And Vercel's
schema declares a draft it is not — see *an artifact's self-description is a claim* below. It is in
`npm run check`, which is the thing to run before pushing.

⚠️ And the explanation that went in that key was the cause, not an innocent bystander: the comment
was worth writing, the file was the wrong place. **Prose about a config decision goes in the commit
message or the handoff.**

### The grants you DON'T write are load-bearing too

Added 2026-09-02. `20260902090000_video_reviewers.sql` granted `select` and `update (verdict)` and
said in a comment: *"It cannot INSERT."* Read back off the live project, `service_role` **could**
insert. Nothing granted it — `20260831165900` had set

```sql
alter default privileges in schema review grant select, insert on tables to service_role;
```

so every table created in this schema arrives with INSERT already on it.

> **In a schema carrying default privileges, the absence of a `grant` line looks exactly like a
> denial and is not one.** Naming the grants you want describes an intention; only a `revoke`
> enforces one. And the diff shows you the lines that are there, never the ones inherited.

PGlite runs as one superuser, so this class is invisible to `npm run test:e2e` at any effort — it is
the same axis as the GRANTs that left the suite 19/19 green while every route would have answered
`42501`. **Read privileges back out of the live project after creating a table**, with
`has_table_privilege` / `has_column_privilege`, and assert the falses as loudly as the trues.

### And the corollary about deleting a check

A test that goes green on something the harness **structurally cannot observe** is worse than no
test, because it consumes the attention that would otherwise notice the gap. When
`e2e/tester.spec.ts` needed "a tester sees only their own issues" — an RLS policy, invisible to
PGlite — the right move was to **delete it and move the property to a live script**, not to make it
pass offline. Deleting a check is sometimes the honest option; making it green never is.

## The rest of the standing rules for this repo

- ⚠️ **State the property the assertion actually checks, not the stronger one you believe is true.** A report that overstates a PASSING test is harder to catch than a failing one — nothing goes red and everything downstream reads as verified. `e2e/token-404.spec.ts` compares two 404 pages' `innerText`; it reached the reader as *"byte-identical bodies"*, which was never true (Next serialises the route param, so each 404 carries its own token). The test was right; the sentence about it was not. It surfaced only because a later run compared the raw bodies and disagreed with the passing test — when a claim and a test disagree, the claim is the likelier liar.
- ⚠️ **AN ARTIFACT'S SELF-DESCRIPTION IS A CLAIM, NOT A FACT.** Same class as the rule above, and it
  bites hardest when the artifact belongs to somebody else. Vercel's `vercel.json` schema declares
  `$schema: draft-04` and is not draft-04 — it uses a numeric `exclusiveMinimum` and an
  object-valued `additionalProperties`, both draft-06+. Taking the declaration at its word and
  registering the draft-04 meta-schema made `ajv` reject **the vendor's own schema** with sixteen
  errors, not one of which was about our file. Anyone meeting that cold would spend an hour on it,
  which is why `scripts/check-config.mjs` drops the declaration and compiles the schema as what its
  contents are — and says so at the top. **Validate against what a thing IS, not what it says it
  is**; a version header, a `Content-Type`, a `$schema`, a filename extension are all the same
  shape.
  *(This rule pairs with a `document.fonts.check()` example that lives in the OTHER repo. It is not
  here, and nobody working in this one will read it — the same reason the tautology rule was copied
  across rather than referenced. The example above has to carry the class on its own.)*
- **A check that depends on an UNDECLARED package disappears silently.** `ajv` was sitting in
  `node_modules` via eslint's tree and worked perfectly; it is now in `devDependencies`, because
  the day somebody else's lockfile dedupes it away, `check:config` stops running and nothing says a
  word — a green run and an absent run look identical from outside.
- **A defect noticed in a neighbouring file gets written down before you return to the one you were in** — in that file, or in that repo's handoff. Two minutes, so it survives being busy. Both verification scripts here put a secret within one branch of their own output at some point; the second was *described* while the first was being fixed, and only got fixed because someone asked again. Noticing is not the deliverable; the note is.
- ⚠️⚠️ **AN ENV VAR A ROUTE DEPENDS ON IS CONFIRMED PRESENT IN THE TARGET ENVIRONMENT *BEFORE* THE
  DEPLOY THAT NEEDS IT — NEVER AFTER.** Not "I'll check if it breaks". Before.
  On 2026-09-01 the radlor.com waitlist route was switched to `SUPABASE_ANON_KEY` and deployed
  without confirming that variable existed in that project's Vercel environment. It did not. The
  live public signup form was down for about four minutes, and **the risk had been identified out
  loud before the push**. An unseen risk is a gap in knowledge; a seen-and-shipped one is a gap in
  the moment between knowing and acting, and only the second is fixable by a rule — so this is a
  rule. It is the same shape as the lockout sequencing (build auth → sign in → then remove the old
  gate), which went right precisely because it was written down first.
  ⚠️ And on Vercel, **setting the variable is not enough — it takes effect on the next deploy**, so
  confirm it from the running deployment, not from the dashboard.
- ⚠️ **A ROUTE THAT REFUSES TO TELL AN ATTACKER ANYTHING REFUSES TO TELL YOU ANYTHING EITHER.**
  `/api/waitlist` answers `303` whether it succeeded or failed — the right design, and the reason a
  completely broken endpoint looked healthy from outside for four minutes. The fix is not to weaken
  the endpoint but to put the signal somewhere else: a health route reporting whether the
  dependency is present, booleans only, named after the VARIABLE rather than the role so it cannot
  become a hint about which key a public endpoint holds. `/api/health` does this in both repos.
- ⚠️ **NEVER `source` AN ENV FILE — PARSE IT.** `set -a; . ./.env.local` runs the file as a shell
  script, so a value you did not choose is executed. On 2026-08-31 an `ADMIN_TOKEN` containing
  shell-special characters was partly evaluated and a fragment of it printed into a terminal — by
  the loading method that had been chosen specifically to keep secrets out of the transcript. **The
  mitigation was the mechanism**, which is a shape worth recognising on sight. Use
  `node --env-file=.env.local <script>`, which parses. A value you did not generate can contain
  anything, and the ones you did generate get rotated into ones you didn't.
- ⚠️ **NEVER `source` AN ENV FILE — PARSE IT.** `set -a; . ./.env.local` runs the file as a shell
  script, so a value you did not choose is executed. On 2026-08-31 an `ADMIN_TOKEN` containing
  shell-special characters was partly evaluated and a fragment of it printed into a terminal — by
  the loading method that had been chosen specifically to keep secrets out of the transcript. **The
  mitigation was the mechanism**, which is a shape worth recognising on sight. Use
  `node --env-file=.env.local <script>`, which parses. A value you did not generate can contain
  anything, and the ones you did generate get rotated into ones you didn't.
- ⚠️ **A STORAGE WRITE RETURNING SUCCESS IS NOT EVIDENCE THE OBJECT CAN BE READ BACK.** On
  2026-08-31 an upload named `_expiry-check.webm` returned a `Key`, wrote an 82 KB row into
  `storage.objects`, and was then unreachable through `list`, GET, `sign` AND `DELETE` — while
  identical bytes under a plain name behaved normally. The list and delete endpoints could not tell
  "absent" from "unreachable", and only `select count(*) from storage.objects` settled it.
  **Verify a write through a different path than the one that wrote it**, and keep object names to
  `[a-z0-9-]` (which `slug` already enforces for the paths this app generates).
  See [docs/security-findings.md](docs/security-findings.md) #4.
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
- ⚠️⚠️ **THE OFFLINE HARNESS CANNOT SEE AUTHORIZATION, AND NEVER WILL.** PGlite runs as one
  superuser with no role switching, so **anything whose behaviour depends on WHO IS ASKING is
  invisible to it by construction** — grants, RLS, role membership, `BYPASSRLS`, default
  privileges, storage policies. Not "uncovered": uncoverable. It has cost twice, both in the same
  direction: RLS enforcement for `anon`, and then GRANTs on 2026-08-31, where the suite was 19/19
  green while `service_role` could not read a single table and every route would have answered
  `42501`. **A green `npm run test:e2e` covers behaviour, not permission.** The only authorization
  coverage this tool has is the three scripts in `scripts/`, run by hand against the live project —
  they are not finishing touches. Re-run them after any change to a grant, a policy, a role, the
  exposed schemas, or a key. The declared blind spot is at the top of `test/fake-supabase.mjs`.
- **The offline harness proves this app's logic, not Supabase's.** `test/fake-supabase.mjs` runs the
  real migration in real Postgres, but only real PostgREST enforces RLS against `anon`. Until
  `scripts/check-anon-locked-out.mjs` has passed against the live project, the security posture is
  **unverified — not verified-by-stand-in**.
