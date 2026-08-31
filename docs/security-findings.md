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

### Two triggers that should force a revisit

1. **`public.waitlist` filling up.** It held **zero rows on 2026-08-31**, which is the only reason
   this tool was allowed to share the project rather than spend 5–7 hours on a real boundary. The
   moment it holds real people, both decisions reopen. `scripts/check-blast-radius.mjs` prints the
   count and says so.
2. **Fixing one app and not the other.** This tool holds the same key over the same table. Closing
   one door while the other stands open is a receipt, not a boundary — do both or neither.

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

## 3. Audit of `RadlorInc/website`'s public docs — 2026-08-31

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
