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

1. **`public.waitlist` has a row.** It held zero on 2026-08-31, and that emptiness was *the* reason
   sharing the project was acceptable rather than spending 5–7 hours on a real boundary. It now
   holds one real person's email address and a child's age-band.
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

**Still open. Still Rafi's call.** The fix is unchanged: a dedicated Postgres role over a direct
connection for each app, plus a storage-only S3 key here. Costed at 5–7 hours for this tool and
roughly half a day for the waitlist route.

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
