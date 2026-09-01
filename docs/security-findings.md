# Security findings — private

**This repository (`RadlorInc/video-reviewer`) is PRIVATE. `RadlorInc/website` and
`RadlorInc/learn` are PUBLIC.** Findings about any of the three live here. Check that sentence is
still true before adding to it.

---

## 1. `radlor-site` — `/api/waitlist` is a public endpoint holding `service_role`

**Open. Rafi's call. Not tonight's work, but a real item with a reason — not a note that turned up
while scoping something else.**

`RadlorInc/website` → `app/api/waitlist/route.ts` is a **public, unauthenticated endpoint that
accepts free input** and holds `SUPABASE_SERVICE_ROLE_KEY`. That key is scoped to the **project**,
not to a table, and it bypasses RLS. Anything that compromises that route — a supply-chain
dependency, a Next.js RCE — reads and writes every table in `ghuvnqbthbcmqfxcrjrh`, including
`public.waitlist` itself: **email addresses and children's age-bands**.

Nothing about the current design is careless. The route's comments explain why the key is there
(the browser must never contact supabase.co, which `/privacy` states as a checkable claim), the
table has RLS on with no policies, and grants are revoked from `anon`. **The exposure is the key's
scope, not the code.**

### Why it moved up on 2026-08-31

It was first written as a passing note — it surfaced while scoping this tool, which now shares the
same project and the same key. Then two things came out on the same day:

1. `RadlorInc/website` is **public**, and
2. **the route's own source comments in that public repo have always said it holds the service role
   key and that the key bypasses RLS.** `handoff.md` there, also public, has discussed
   `SUPABASE_SERVICE_ROLE_KEY` for longer still, including the line *"a `service_role` key there
   gives every visitor write access to every table in the project."*

So anyone scanning had the fact before anybody wrote a finding about it. **The exposure did not
change; what changed is that it can no longer be treated as obscure.** That is the whole reason
this is filed at this weight rather than as a footnote.

### What the fix is

A dedicated Postgres role with `INSERT` on `public.waitlist` and nothing else, reached over a
**direct connection**. ⚠️ Not via PostgREST: reaching a custom role there needs a JWT signed with
the project's JWT secret, and that same secret signs a `service_role` token, so it buys nothing.
Roughly half a day for that route alone.

### ⚠️⚠️ BOTH TRIGGERS HAVE NOW FIRED — 2026-09-01

**This is no longer a decision about an empty table, and it is Rafi's to make again.**

1. **`public.waitlist` has a row.** It held zero when this decision was made earlier on
   2026-08-31, and that emptiness was *the* reason sharing the project was acceptable rather than
   spending 5–7 hours on a real boundary. ⚠️ **The row was created `2026-08-31 23:34 UTC`** (read
   off `created_at`, not inferred — an earlier draft of this line said "on 2026-09-01", which was
   when it was *observed*, not when it arrived). It holds one real person's email address. Record
   the date, because the argument that justified the decision expired on it.
2. **`review.subscriptions` exists and holds financial data.** Renewal dates, monthly costs and
   credit balances, in the same schema, reachable with the same key.

`scripts/check-blast-radius.mjs` reports both, by row count, on every run:

```
⚠️  1 waitlist row(s). The decision to share this project was made about an EMPTY table.
⚠️  review.subscriptions exists and holds 1 row(s) — FINANCIAL DATA.
```

Nothing has broken and nothing is leaking. What has changed is that the *argument* which justified
sharing no longer holds on its own terms. The original reasoning still stands in one respect —
`radlor-site`'s public `/api/waitlist` route holds the same key over the same table, so hardening
only this tool is still a receipt rather than a boundary. But "do both or neither" now has a real
cost attached to "neither".

**Rafi's call, made 2026-09-01: fix the waitlist route, NOT the review tool's separation.** The
waitlist route is now DONE (#5), so the argument that declined the separation — hardening the second
door on a house whose first door has the same lock — no longer applies.

⚠️ **THE SEPARATION STAYS OPEN AND DELIBERATELY NOT DONE. Two triggers, recorded instead of the
argument, because the argument has already changed once:**

1. **Milo starts taking real money.** Payment data raises the cost of a shared-project compromise
   past what 5–7 hours of role plumbing costs.
2. **`review` holds more than the handful of rows it has today.** Right now it is one video, a few
   notes, one profile and a couple of subscriptions — the blast radius is real but the payload is
   small.

Until one of those fires, launch blockers are worth more than the role plumbing. This is not
"declined"; it is scheduled against facts rather than against a feeling. The
reasoning is the one this document already made — hardening the second door on a house whose first
door has the same lock buys a written boundary and no real risk reduction. The review tool sits
behind auth; the waitlist route sits behind nothing. See #5.

The review tool's own separation stays declined **until the waitlist route is done**, at which point
its `service_role` stops being the same lock as the front door and the question is worth re-asking.
Not before.

---

## 5. `radlor-site` waitlist route — CLOSED 2026-09-01

**Done and verified live.** `/api/waitlist` no longer holds `service_role`.

```
POST /api/waitlist (real form, no JS) → 303 → /waitlist/thanks
row landed: {"email":"<probe>","age_band":"6-8","source":"website"}
check-waitlist-rls.mjs → exit 0
  ok  POST as anon -> 201 (accepted — the form works, and the key is real)
  ok  GET as anon -> 401, denied
  ok  DELETE as anon -> 401 (denied)
  ✅ anon may add a signup and nothing else
```

Verified by submitting the real form and then **reading the table with the service key**, not by
trusting the 303 — which is the thing that would have caught the outage below in four minutes and
is now what `/api/health` answers in one curl.

⚠️ **The consequence for #1: the front door is now fixed, so the review tool's `service_role` is no
longer the same lock as the front door — and the separation question there is worth re-asking.**
The argument that declined it ("hardening the second door on a house whose first door has the same
lock") no longer applies. Still Rafi's call, but it is now a real question rather than a rhetorical
one.

### It took the live form down for four minutes on the way

**The database half is complete and verified.** `anon` now has a **column-level** `INSERT (email,
age_band, source)` grant on `public.waitlist` and exactly one policy. It cannot SELECT, UPDATE or
DELETE — all three refused with `42501`. So a compromise of that endpoint writes a junk row instead
of reading the database.

**The route half is reverted**, because deploying it broke the live public signup form.

### What went wrong, both halves

The route was switched to `SUPABASE_ANON_KEY` and deployed **without confirming that variable
existed in radlor-site's Vercel environment**. It did not. Every submission answered
`/waitlist/problem` and no row landed, for about four minutes, on a form real people use.

- **Mine:** the risk was identified out loud before the push and pushed anyway. An unseen risk is a
  gap in knowledge; a seen-and-shipped one is a gap in the moment between knowing and acting. Now a
  rule in both `CLAUDE.md`s: confirm the variable in the target environment *before* the deploy.
- **The founder's, in his words:** he approved a production change to a form real people submit and
  scoped it as half a day of work rather than as a deploy with a blast radius, and never said
  "confirm the env var" or "try it on a preview deployment".

### The finding worth keeping

**The route answers `303` whether it succeeds or fails.** That is the no-oracle design working as
intended — a distinct error would tell a bot what to fix and would leak whether an address is
already on the list. **It is also why a completely broken endpoint looked healthy from outside.**

A design that refuses to tell an attacker anything refuses to tell you anything either. The fix is
not to weaken the endpoint but to move the signal off the public path: `radlor.com/api/health` now
reports `anon_key_configured`, booleans only, named after the variable rather than the role so it
cannot become a hint about which key a public endpoint is holding. "Is the form working" is one
curl instead of a real submission and a database read.

### The existing gate caught this, and that is the best outcome available

`radlor-site/scripts/check-waitlist-rls.mjs` existed to assert `anon` could do nothing. Its comment
predicted the exact scenario — *"an INSERT policy added in the dashboard at 11pm would make the list
both harvestable and stuffable, and nothing in the repo would change. This is the only thing that
would notice."* It went red at the right assertion.

It has been rewritten for the intended posture rather than deleted, splitting that warning in two:

- **STUFFABLE — yes, deliberately**, bounded by the per-IP rate limit, the honeypot, the unique index
  on `email`, and the anon key being published nowhere in this project.
- **HARVESTABLE — no, never. SELECT is still refused. That is the assertion that protects people's
  email addresses, and it is the one that must never be "made to work".**

Its success message also had to be fixed: it still read *"anon can neither insert, read nor delete"*
while insert was now allowed — a green describing the wrong posture.

### The probe-address convention this leaves behind

`public.waitlist` now holds exactly ONE real person, so a test row that looks like a signup corrupts
the only number the table exists to hold — the same reasoning that removed the fake review note.
Any check that writes there uses an address that **cannot be mistaken for a person**
(`…@example.com`, `…@radlor-test.invalid`) and deletes it **in the same run**, in a `finally` so a
failure part-way cannot leave one behind. Verified on 2026-09-01 by reading the table: 1 row, 0
probe rows, the real signup intact.

---

## 6. Higgsfield balance automation — declined, with triggers

**Closed by decision, 2026-09-01.** 912 credits from one provider is not worth a new credential in
Vercel at a broader-than-needed scope. The hand-edited table already answers the two questions that
matter — what lapses next, and what this costs a month — and it works for providers that expose
nothing at all.

The number is typed in monthly. It is stored with `credits_source: 'manual'`, which renders as
*"you typed this 3d ago"* rather than as a refresh — **calling a typed number `typed` is the entire
reason that column exists.**

**Revisit when either is true:**
1. **Four or more tools** are in `review.subscriptions` — typing four numbers monthly is the point
   at which the automation starts paying for the credential.
2. **A balance has gone stale enough to mislead someone** — if the freshness label is doing the work
   the number should be doing, automate it.

Same for the Supabase and Vercel infra numbers, which are the fourth of the founder's four things:
**typed and honestly labelled beats automated and quietly wrong.**

Cross-reference: [SETUP.md → Blast radius](../SETUP.md#blast-radius).

---

## 2. Process — a security finding was pushed to a repo whose visibility nobody had established

**Closed, recorded for the mechanism.** 2026-08-31.

Finding #1 was written into `RadlorInc/website`'s public `handoff.md`, labelled *"not fixed"*, and
pushed. It was reverted the same day.

**How it happened, both halves.** The author checked the repository's visibility *after* pushing,
not before. The reviewer approved the push while reasoning about CI risk — *"no CI risk"* — and
never asked where it was going. Neither person had established that the repo was public; each had a
reason not to ask that looked sufficient on its own.

**The rule.** *"Safe to break"* and *"safe to publish"* are different axes and neither answers the
other. Establish visibility **before** the first push to any remote, not after — a first push
publishes the whole history at once, and unpublishing is not a thing that exists.

⚠️ **The revert is mitigation, not erasure.** The section is still in that public repo's history in
commit `2b3ed4d`, and in any clone taken before the revert. It is not gone and must not be
described as gone.

What went right, and is worth keeping as the pattern: the `video-reviewer` repo's own first push
was audited **before** it happened — `git log -p` across all 15 commits for JWTs, `sb_secret_`,
AWS keys, PEM blocks, connection strings with passwords and assigned key values (all zero),
`git check-ignore` on `.env` and `.env.local`, and every token-shaped literal traced to a named
test fixture. That is the step that has to come before the irreversible one, every time.

---

## 3. `review` schema applied 2026-08-31 — and what it exposed about the harness

**Closed.** Applied to `ghuvnqbthbcmqfxcrjrh` and verified by reading the database back rather than
by trusting that the statements returned success.

⚠️ **The schema shipped dead and no offline test could have said so.** Supabase's default
privileges grant `anon`/`authenticated`/`service_role` on tables created in `public` and `storage`;
they do **not** extend to a new custom schema. So `review`'s tables were created owner-only, and
`has_table_privilege('service_role','review.videos','SELECT')` was **false**. `service_role` has
`BYPASSRLS`, but bypassing RLS is not holding the GRANT — Postgres checks the grant first — so every
route would have returned `42501 permission denied for table videos`.

`test/fake-supabase.mjs` runs PGlite as a single superuser with no role switching, so **grants are
invisible to it by construction**. 19 green E2E tests said nothing about this and could not have.
That is the same boundary as the RLS check: the harness proves this app's logic, the live project
proves the platform's behaviour, and the second one is not optional.

Fixed by `20260831165900_grant_review_tables_to_service_role.sql` — `select, insert` only, so the
web tier cannot `update` or `delete` a note even holding the service_role key. That does **not**
shrink the blast radius (finding #1 stands); it stops this tool destroying its own record.

Also recorded: `revoke all ... from anon, authenticated` in the first migration is **inert** —
`pg_default_acl` stored no row for it, because in a custom schema there was never a default grant
to revoke. Kept as intent, but the protection is the Postgres default, not that line.

Side effect to know about: applying through the MCP connector **wrote the project's first migration
history rows**. The history is now partial — this repo's three migrations, not `public.waitlist`.
The repo's filenames were renamed to match the recorded versions so the two agree. See SETUP.md.

---

## 4. Supabase Storage accepted an upload that no read path could reach — 2026-08-31

**Closed (worked around). Worth knowing; not a defect in this tool.**

Uploading the expiry-check fixture as **`_expiry-check.webm`** — leading underscore — returned
success and created a row:

```
POST /storage/v1/object/review-videos/_expiry-check.webm
  → {"Key":"review-videos/_expiry-check.webm","Id":"8f32bc61-…"}
storage.objects → review-videos | _expiry-check.webm | 82371 | video/webm
```

…and then **every read path denied it existed**: `object/list` → `[]`, authenticated GET → 400,
`object/sign` → `404 NoSuchKey`, and `DELETE` → `404 NoSuchKey`. The same bytes uploaded as
`plain.webm` listed, signed, downloaded and deleted normally. The leading underscore is the only
difference.

⚠️ **The shape to remember: an upload can report success, create a database row, and be
unreachable through every API.** A write that returns a Key is not evidence the object can be read
back. If a video ever seems to upload but will not play, check the filename before checking the
code — and prefer plain `[a-z0-9-]` object names, which is what `slug` already enforces for the
paths this tool generates.

### The delete was no more trustworthy than the upload

Cleanup, in order, with what each call claimed:

| call | said | was true? |
|---|---|---|
| `DELETE plain.webm` | `{"message":"Successfully deleted"}` | yes |
| `DELETE _expiry-check.webm` | `404 NoSuchKey` — "Object not found" | **a row for it existed minutes earlier** |
| `POST object/list` | `[]` | **also `[]` while the row existed** — it cannot tell the two apart |
| `select count(*) from storage.objects` | `0` | the only statement that settled it |

⚠️ Note what is NOT claimed here: no successful call ever reported removing `_expiry-check.webm`,
so **which action removed it is unknown.** The row existed, then it did not. That is exactly why the
count is the evidence and the API responses are not — a `404` from this endpoint means "I cannot
reach it", which is a statement about the API's view, not about whether the thing exists.

**The rule both halves point at: verify a write through a different path than the one that wrote
it.** The upload's `Key`, the list's `[]` and the delete's `404` are all the storage API describing
its own reachability. `storage.objects` is the database, and it disagreed with all three.

---

## 5. Audit of `RadlorInc/website`'s public docs — 2026-08-31

Read once, deliberately, after learning the repo was public. **Reported, not acted on.**

Scope: `handoff.md` (43 KB, at its pre-finding state), `CLAUDE.md`, `README.md`, `AGENTS.md`,
`docs/brand-facts.md`, `docs/brand-palette.md`, `docs/seo-geo-setup.md`.

| what was looked for | found |
|---|---|
| Secrets — keys, tokens, passwords, connection strings | **none** |
| Personal emails or phone numbers | **none** |
| Supabase project ref | 1 (partial, `ghuvnq`) — an identifier, not a secret; it is in every client request |
| `service_role` / "bypasses RLS" discussion | **7 mentions**, incl. env-var tables and *"a `service_role` key there gives every visitor write access to every table in the project"* |
| Vercel / deployment internals | 18 mentions — project names, protection-bypass mechanics, deploy workflow |
| Connector-scoping notes | 3 — which tooling can and cannot see which project |
| "not fixed" / known-weakness language | 3 |

**Read of it.** Nothing here is a credential and nothing needs emergency action. What it is, is a
detailed operational map — how the site deploys, what holds which key, which tooling is blind to
what — written by people who believed they were writing in private. That is not a leak; it is a
standing condition to decide about deliberately rather than discover twice.

**Not acted on, per instruction.** The options, for whenever it is worth an hour: leave it (it is
mostly design rationale that is defensible in public and arguably good for a company that publishes
checkable claims); move the operational sections to a private repo; or make the repo private. The
guard note now at the top of that `handoff.md` at least stops the next person adding to it
unknowingly.

---

## 7. Any valid reviewer token opened any reviewable video — 2026-09-02

**Fixed the same day, by `review.video_reviewers`. Nothing was exposed; that is the point of
writing it down.**

`/r/<token>` listed every video with `status in ('awaiting_review','reviewed')` and
`/r/<token>/<slug>` resolved a slug through the same filter. Neither asked which reviewer was
asking, because until now **there was no reviewer→video link in the schema at all**. So a valid
token — any valid token — listed every video that was out for review, opened any of them, and
`/api/video-url` would sign a URL for the object. The other reviewer's *notes* were never reachable
(`notes` is keyed `(video_id, reviewer_id, video_version)`), but their `verdict` was, because it was
a column on `videos`.

⚠️ **NOBODY DECIDED THIS.** There is no commit where a wider rule was chosen, and no comment
defending it. It fell out of there being one reviewer and one video, where "every reviewable video"
and "your video" are the same set. The filter that looked like access control was `status`, and
status is a position in a workflow, not an answer to who is asking.

⚠️ **And the exposure was zero the whole time — which is exactly why it survived.** One reviewer,
one video: every test passed, every page was correct, and the tool behaved impeccably. Nothing
about the data staying thin was guaranteed, or even likely; it was going to stop being thin the
first time a second reviewer was added, which is the change that surfaced this. **Uncontested
behaviour that is only safe because the data is thin is a finding, and the moment to record it is
before the data grows, because nobody decides to grow it — it just grows.**

### What replaced it

`review.video_reviewers (video_id, reviewer_id, assigned_at, verdict)` is the missing condition:
no assignment, no video. Applied in `src/lib/db.ts` at every reviewer entry point — the list, the
page, `/api/notes`, `/api/review-done`, and `/api/video-url`, which is the one that hands out a
bearer credential for the object itself.

### The test that would have caught it, and why the old suite could not

Every reviewable video in the fixture belonged to the one reviewer, so "she can open it" and "she
was assigned it" were indistinguishable. The seed now carries **`flood-only`** — `awaiting_review`,
assigned to somebody else — so the assignment is the only thing that can 404 it, with the other
reviewer getting 200 on the same slug as the positive control. Verified by breaking it:
`scripts/break-check.sh` with the assignment check removed from `reviewerVideoBySlug` takes
`e2e/verdict.spec.ts` red on its own `expect`.

### What it does not cover

The token itself is unchanged: still a bearer string in a URL, still shareable by forwarding the
link. Assignment scopes *what a token reaches*, not *who is holding it*. That is the reviewer-
accounts work, and it is the next thing.

---

## 8. `[].every()` is `true` — an empty assignment set nearly read as "cleared to post" — 2026-09-02

**Caught before it shipped. Recorded because of where it came from, not because of what it cost.**

The clearing rule is "every assigned reviewer has approved". Written the obvious way —

```js
cleared: assignments.every((a) => a.verdict === 'approved')
```

— a video with **zero** assignments is cleared. Not because anyone decided that an unreviewed video
is fine to post, but because that is what JavaScript's `every()` answers for an empty array. It is
the correct answer to the question the language is asking (*is there a counterexample?*) and the
opposite of the answer to the question the product is asking (*has everybody signed off?*).

⚠️ **This is the worst output this feature could produce.** Every other failure mode here is
visible: a missing verdict shows as missing, a disagreement shows as a disagreement. "Cleared to
post" on a video **no human has opened** looks exactly like "cleared to post" on a video two people
approved. And it would have arrived on rows that are entirely normal — a video added and not yet
assigned is the default state of every new video.

⚠️ **The class, which is the reason this is in findings and not in a code comment: a default that
comes from a language rather than from a decision.** Nobody writes down "and if nobody was asked,
post it" — so nobody reviews it, and no reader of the rule notices it is missing, because the code
reads exactly like the sentence it is supposed to implement. Vacuous truth over an empty collection
is the common one; `Math.max()` of nothing, an all-`AND` filter with no clauses, and a permission
check that iterates an empty rule list are the same shape.

`src/lib/clearance.ts` requires `assignments.length > 0` explicitly, and
`test/clearance.test.mjs` asserts the empty case on its own — *"nobody assigned is not everybody
approved"* — rather than trusting it to fall out of the other cases. `/admin` renders it as
`nobody assigned`, which is a different string from every other state, so it cannot be misread at a
glance either. The e2e suite drives `quiet-draft`, which is seeded with no assignments for exactly
this.

---

## 9. A repointing migration took the reviewer page down for the length of a deploy — 2026-09-02

**Self-inflicted, recovered by the deploy itself, ~6 minutes. The rule it breaks is one this repo
already had written down, applied to the wrong shape of change.**

`20260902110000_reviewer_accounts.sql` moved `notes.reviewer_id` and `video_reviewers.reviewer_id`
from holding `reviewers.id` to holding `profiles.user_id`. It was applied to the live database
BEFORE the matching code was pushed, on the standing rule that the database dependency goes in
first. For the ~6 minutes between the migration and the build going Ready, the running build
resolved a token to `reviewers.id` and looked assignments up by it, while the rows held `user_id`.
No match: the reviewer's list rendered empty and every video 404'd. Measured, both sides:

| | value | old build compares | new build compares |
|---|---|---|---|
| `reviewers.id` | `9005210c…` | ✅ this | — |
| `reviewers.user_id` | `0c313ddb…` | — | ✅ this |
| `video_reviewers.reviewer_id` | `0c313ddb…` | ✗ no match | ✓ match |

⚠️ **"MIGRATION FIRST" IS NOT THE RULE. The rule is: the dependency goes in before the thing that
needs it.** For an ADDITIVE migration the app is the dependent, so the database goes first and the
old build simply ignores the new table — that is why `video_reviewers` shipped with no outage at
all. For a REPOINTING migration the running app is what the data depends on, and the order inverts.
**A migration that changes what an existing column MEANS is a breaking change to every running
reader, and the deploy window is an outage window.** The shape that avoids it is one both builds can
read — write the new value alongside the old, cut over, then remove — or a confirmed deploy window.

### What made it worse, and is the more useful half

The outage was diagnosed **against a build that was not running.** A CSS-chunk-hash check had
reported "the deploy has not landed" — twice, wrongly, both in the same direction — so the
conclusion was "old build, new data" at a moment when the new build had in fact been Ready for
minutes. On that reasoning a write to the production database was proposed. It was blocked, and the
actual deployment list showed fourteen Ready deployments that day.

⚠️ **A measurement instrument that has been wrong every time it mattered is not weak, it is broken,
and the fix is to delete it rather than to describe it more narrowly.** It has been removed from
the handoff, not caveated. The signals that actually answered the question: `/review` responding
`307 → /login` rather than `404`, because that route exists in exactly one of the two builds. **Pick
a discriminator that only one build can produce, not a hash you have no known-good value for.**

⚠️ And the near-miss is worth its own line: **the proposed remedy was a write to production data,
justified by an unverified belief about which code was running.** The reasoning was checkable in one
request and was not checked, because the conclusion already explained the symptom. Nothing needed
fixing; the deploy had already fixed it.

