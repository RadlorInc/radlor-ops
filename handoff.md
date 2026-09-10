# Session Handoff — Radlor Ops

> **Read [CLAUDE.md](CLAUDE.md) first.** It holds the standing rules; this file is only "where work
> left off". Keep it short — the product repo's handoff grew to 60 KB and became a running cost on
> every session.

## In one minute

Three people, three screens, one Next.js app on Vercel:

- **admin** (Rafi) — `/admin`: the to-do list, who has access, *Marketing material* — upload a
  cut, watch one, delete one — and *Source material*, the library a cut gets made FROM. ⚠️ **Costs and renewals is gone**
  (2026-09-08, Rafi's call): tracking what Higgsfield and Vercel bill was a second job this tool had
  quietly taken on. The tab, `/api/admin/subscription`, the renewal helpers and eight e2e tests went
  with it. `review.subscriptions` still exists with its row — see *Open findings*.
- **tester** — `/tester`: files what they found wrong in the app, and reads their own issues back.
- **reviewer** — `/review`: watches **every published cut**, leaves timestamped notes on any of
  them, and — on the cuts they are the one **approver** of — says **Approved** or **Needs changes**.

Everyone signs in at `/login`. There is no open sign-up and **no email is ever sent** — Rafi's call
on 2026-09-03. The admin pastes the testers' **email addresses** into the *People* tab; the server
makes one account per address **with no password at all** and hands back one single-use link each.
The admin copies that block and sends it to the tester head, who forwards each person their own
line; opening it is where that person chooses their password, and it signs them straight in.
Forgot a password? *New link* beside their name — which also kills any link they were still
holding. **An admin can open all three surfaces**; a tester and a reviewer see only their own.

**The one rule the whole tool exists for — CHANGED 2026-09-09, Rafi's call:** everyone with a
reviewer account, and the admin, sees all marketing material and can give feedback; only the
people flagged as **approvers** on the People tab can approve or reject. Every new cut is sent to
all of them, and it is **cleared only when every approver has approved** — `clearance()` is
untouched, and one "needs changes" is still not cleared however many approvals sit beside it.

## Where it is right now

**Live** at **`https://ops.radlor.com`**, from **`RadlorInc/radlor-ops`**.

⚠️⚠️ **THE REPO IS PUBLIC, AND HAS BEEN SINCE AT LEAST 2026-09-04.** This line said PRIVATE, CLAUDE.md
said PRIVATE, and GitHub said otherwise every time it was actually asked — finding #10, still open
on 2026-09-09. `docs/security-findings.md` is public with it. The fix is one command and it is
**Rafi's to run**, because it is his repo and his call:

```bash
gh repo view RadlorInc/radlor-ops --json visibility   # ask, never assume — it costs a second
gh repo edit RadlorInc/radlor-ops --visibility private
```

⚠️ Private-again is mitigation, not erasure: the history was already out.
`video-reviewer-liard.vercel.app` still answers as the project's generated domain; **use the
custom one for anything a person sees**, and especially for making `/join` links.
Vercel deploys on push to `main`.

⚠️ **A push is not a deploy — confirm it.** On 2026-09-03 a build **failed** (a `"//"` key in
`vercel.json`; see CLAUDE.md) and several pushes sat undeployed while every local check was green.
Confirm from the running deployment, never from a settings page or from the push succeeding:

```bash
curl -s https://ops.radlor.com/api/health
# {"status":"ok","auth_configured":true,"region":"pdx1","commit":"ea64cdf"}
```

✔ **`commit` ANSWERS "WHICH BUILD" DIRECTLY, since 2026-09-04** — the first seven of
`VERCEL_GIT_COMMIT_SHA`. Compare it with `git log --oneline -1 origin/main`. It was added the
second time in one day that the question was unanswerable: a push that silently did not deploy,
and then a bug report ("the links still vanish") that could not be told apart from "the fix is not
there yet". **Read it before believing any report about production**, yours or somebody else's.

⚠️ **Do not pin a SHA here** — check it: `git log --oneline -1 origin/main`. And when you need to
know *which build* is serving, use **behaviour only one build has** (a route that exists in one, a
field in the health body). ⚠️⚠️ **DO NOT USE THE CSS CHUNK HASH.** This file used to recommend it;
it is removed, not caveated. It reported "no deploy" twice on 2026-09-02 when the deploy had landed,
and the second time produced a confident wrong diagnosis of a live 404 and a proposed write to the
production database.

**Database:** the **`radlor-site` Supabase project**, `ghuvnqbthbcmqfxcrjrh` (**us-west-2**), schema
**`review`**. Not its own project — the free tier caps the account at two. The schema is a
namespace, not a boundary; see [docs/security-findings.md](docs/security-findings.md) #1.

⚠️ **The schema is still `review`, not `ops`.** A rename 404s the live tool from the moment it runs
until a human edits *API → Exposed schemas*, which no migration can reach.

## The custom domain, and the deploy that silently stopped — both closed 2026-09-04

Kept short on 2026-09-09: the risks are gone and only the reusable shapes are worth carrying.

**`ops.radlor.com` is the domain to use.** GoDaddy holds `radlor.com`'s DNS — a plain CNAME to
`097fda5c5f8bccec.vercel-dns-017.com`, deliberately not the `19e7809ba6b0ec76…` that `www` uses,
which belongs to the marketing site. `video-reviewer-liard.vercel.app` still answers as the
generated domain.

⚠️ **The Vercel project is still named `video-reviewer`, and that is now cosmetic.** `/join` links
are built from `location.origin`, so on a custom domain they do not care what the project is
called. The fix for "renaming breaks outstanding links" was not to schedule the rename carefully —
it was to stop the links depending on the generated name. **If a domain ever moves again**, the
rule that mattered is: outstanding `/join` links point at the OLD host and die instantly, and the
person holding one gets a dead host rather than anything this app can explain. Move first, make
links after.

⚠️⚠️ **A PUSH THAT SILENTLY DID NOT DEPLOY — the shape to recognise.** On 2026-09-04 the Git
connection went stale after the repo rename. Nothing errored: `git push` succeeded, GitHub held the
commit, the site served 200s, `npm run check` was green. The only thing that disagreed was asking
production for a value the change moves — the same shape as `/api/waitlist` answering 303 either
way. Reconnected in *Settings → Git*; `/api/health`'s `commit` field exists because of this.

⚠️ **Reconnecting does not deploy, and *Redeploy* does not test the hook** — it builds through a
path that never touches it. Only a fresh push does. ⚠️ **The Vercel MCP connector cannot see this
project**: `get_project` 404s the id in `.vercel/project.json`, `list_deployments` and the runtime
logs answer 403. It is outside whatever that token is scoped to, so diagnosing a production error
means probing the real dependencies from a script, not reading logs. ⚠️ And that same
`project.json` says `"projectName": "radlor-ops"` while Vercel 404s the id beside it — **an
artifact's self-description is a claim** (CLAUDE.md), not evidence.

**Accounts in production:** `kuwari84@gmail.com` (admin), `kuwarirafi@gmail.com` (tester). Both real
— **never delete either.** Throwaway accounts for checks use `@example.com` and are deleted against
an explicit allow-list, never "everything except the ones I remember".


## Accounts by link — LIVE since 2026-09-04, migration applied and in production use

**The *email* version is gone** — it was `1d74b49`: an *Invite someone* form calling
`/auth/v1/invite`, plus `/forgot`, `/auth/confirm` and `/set-password`. It never worked in
production and never would have: it needed custom SMTP and rewritten templates, and Rafi
decided the same evening that no email is to be sent at all. **Nobody should configure SMTP**, and the
templates should be left alone — there is no mailer in this design.

**What the tree now does** — accounts by link, nothing emailed, and the admin never types or sends
a password:

- `supabase/migrations/20260904090000_invite_links.sql` — `review.invite_links`: `token_hash`
  (sha256 of the raw token; **the table never holds a working link**), `user_id` **not null**,
  `expires_at`, `used_at`. RLS on, **no policies**: only `service_role` touches it.
  ⚠️ `grant update` is written explicitly, because default privileges already hand over
  select+insert and the grants you *don't* write are invisible in the diff (CLAUDE.md).
- **There is no "anyone may sign up" link and no `revoked_at`.** One link belongs to one person and
  is spent on use; **re-issuing is what revoking looks like** — `newInviteLink` marks every unused
  link that person holds as used before writing the new one. That is one button instead of a Stop
  button plus a list, and it is the thing an admin does anyway when a link goes to the wrong person.
- `POST /api/admin/links` (admin only): `{ emails: [...], role }` creates a user per address
  (`POST /auth/v1/admin/users`, `email_confirm: true`, **no password**) + its `profiles` row +
  a link each; `{ user_id }` makes one fresh link for somebody who already exists. Returns
  **paths**, and the client prefixes `location.origin` so a link copied from a preview deployment
  points at that deployment. Each address gets its own try/catch and its own line in `skipped` —
  one typo in a pasted list must not cost the other forty their links.
- `/join/[token]` + `POST /api/join`: spent, superseded, expired and unknown are all the **same
  404**. The route re-checks the link itself (the page's 404 is a rendering decision), sets the
  password, spends the link **after** the password lands — the other order loses the account to
  everyone if the auth call fails — then signs them in and redirects to `/login`, which already
  sends a signed-in person to the surface their role is for. Rate limited **20/min per IP**: a
  room of testers on one office wifi is the normal case.
- The name on the profile is the address's local part, tidied (`ponytail:` in the route). The ask
  was emails and nothing else; the upgrade path is a name field on the join page.
- `e2e/join.spec.ts` replaces `e2e/auth.spec.ts`; `test/fake-supabase.mjs` lost the mailer
  stand-ins (`/invite`, `/recover`, `/verify`, `PUT /auth/v1/user`, `/_outbox`) and gained the
  admin users API, service-key-or-401.

⚠️ **A lenient harness was hiding a production bug, and it is fixed in both places.** A POST with
`Prefer: return=minimal` answers **201 with an empty body**, not 204 — `res.json()` throws on that.
The fake answered `null`, which is valid JSON, so every minimal insert passed offline and would
have failed live. `rest()` now decides on the body's emptiness, and the fake sends a genuinely empty 201.

**Break-checked** (by hand — `scripts/break-check.sh` stashes uncommitted work, so it needs a
commit first): neuter the supersede write → the "new link kills the old" spec goes red on its own
`expect`; neuter `spendInviteLink` → the single-use assertion goes red. Nothing else moves.

**Done on 2026-09-04:** the migration is applied to `radlor-site` (through the MCP connector, which
records it — never `supabase db push` against this project, SETUP.md:59). Grants read back off the
live database, not assumed from the file:

| | select | insert | update | delete |
|---|---|---|---|---|
| `service_role` | t | t | **t** | f |
| `anon` | f | f | f | f |
| `authenticated` | f | f | f | f |

RLS on, **0 policies**, 0 rows. `scripts/check-anon-locked-out.mjs` covers the table and passes —
`service_role` reaches it (HTTP 200, the positive control) and `anon` is refused at the same
address with `42501`, so the denial is a denial and not a wrong address.

⚠️ `update` being **t** is the one to re-check after any permission work: default privileges only
hand over select+insert, so without the explicit grant a link would never be spent — every link
would stay alive for ever and the offline suite would stay green through it (PGlite is one
superuser; it cannot see this).

✔ **DONE, END TO END IN PRODUCTION, 2026-09-04.** `kuwarirafi@gmail.com` was issued a link from
*Who has access* → *New link*, opened it, chose their own password, landed on `/tester`, filed a
report, and it showed up on `/admin`. That is every part of the design exercised by a real person
on the real system: link issue, single use, password set, sign-in, role routing, and the write
reaching the admin's read through the cache. **No email was sent by anything at any point.**

The original list, kept because the order is the reusable part:

1. Merge `accounts-by-link` into `main` and push. The commit is `13c7a24`; it is deliberately NOT
   on `main`, because a push to `main` deploys and this code reads a table that only existed from
   this afternoon.
2. Confirm from the *running deployment* — not the dashboard — that `/api/admin/links` answers as
   the admin (the old build 404s it for everyone), then make a link for a throwaway `@example.com`
   address, open it, and delete that account afterwards against the allow-list.
3. **Then** `kuwarirafi@gmail.com`: it already has an account, so it goes through *New link* beside
   their name, **not** the paste box — the paste box will (correctly) answer "already has an
   account" and create nothing.
4. Delete the Supabase *Invite user* / *Reset password* template edits if any were made. There is
   no mailer in this design.

## ⚠️ The links were destroyed by the refresh meant to show them — 2026-09-04

**Fixed in `bbbae4c`, and worth reading before touching `People.tsx`.** Three testers' links were
generated in production and never reached the admin: the accounts were created, the rows said
*Not joined yet*, and the links themselves were **gone for good**, because the table stores sha256
and nothing else. There is no recovery path — only *New link*, which supersedes and re-issues.

`router.refresh()`, called to redraw *Who has access*, remounts the component holding the links and
empties its state. It was always a race; adding the "not joined yet" chip put another server fetch
in the way and the race started landing the other way every time. **The precious value was living
in the state that a routine re-render throws away.**

- The links now live in `sessionStorage`, read through `useSyncExternalStore` — surviving the
  remount *and* an accidental reload. Restoring in an effect is a setState in an effect and the
  React Compiler's lint rejects it, correctly: the value exists before first paint.
- A bearer token in browser storage, deliberately: per tab, dies with the tab, strict CSP, and it
  is on screen for that admin anyway. *Done — hide these* wipes it.
- **Per-row Copy buttons.** Copying one person's line out of one blob by hand is precisely where
  the wrong link reaches the wrong person.
- The chip said *"expires in 6 days"* on a link made seconds earlier — a stray `- 1` undoing the
  server's `Math.ceil`. Under-reporting an expiry is the direction somebody plans around.
  ⚠️ **The window is 21 days since 2026-09-07, not 7** — and `e2e/join.spec.ts` writes `21` out
  rather than importing `DAYS`, which is why changing it went red instead of through. Three
  sentences in the interface say how long a link lasts; all three have to move together.

⚠️ **Two assertions had to move, and both had been passing for the wrong reason:**

1. The block was asserted **right after the click** — in the gap before the refresh destroyed it.
   `makeLinks` now waits for the row count to move first, which puts the assertion on the far side
   of the thing that breaks it. *"AT WHICH STATE OF THE UI"*, exactly as CLAUDE.md says.
2. *"the block changed"* used `not.toHaveText(<innerText snapshot>)`. **`toHaveText` normalises
   whitespace**, so it was satisfied instantly by the newlines rather than by anything changing,
   and the read after it returned the stale link and compared it to itself. It now waits for the
   OLD token to leave the screen.

⚠️ **And how the diagnosis nearly went wrong.** The first probe removed `router.refresh()` **and**
switched from a coordinate click to a scripted one, then read the result as proof about the
refresh. Two variables, one conclusion — it happened to be right and could as easily not have
been. **Change one thing.** The second probe drove it exactly as a person does and sampled at 1s,
4s and 9s.

## ⚠️ Waiting on Rafi — two decisions

1. **Make the repo private** (see *Where it is right now*). It is his repo; nobody else should
   change its visibility.
2. **`review.subscriptions` — drop it, or keep it?** Nothing in the app has read or written it
   since Costs was removed on 2026-09-08, but the table, its RLS policies and its row are all still
   there, and that row is one of the two triggers `check-blast-radius.mjs` reports. Dropping a table
   holding real billing figures is not a side effect of deleting a tab; it needs its own migration
   and somebody deciding the row is not wanted.

**Nothing else is blocked on him.** The section below is the last thing that was.

### ✔ The tester-vs-admin RLS check — done

**The tester-vs-admin RLS check RAN AND PASSED, 2026-09-04**, against the live project:

```
CONTROL A  admin reads profiles      → HTTP 200  2 row(s)
CONTROL B  tester reads profiles     → HTTP 200  1 row(s)
CHECK      tester sees the admin row  → no ✔      tester sees only itself → yes ✔
ISSUES     admin 15 ⊃ tester 1        → yes ✔      all reporter=tester    → yes ✔
```

**What that proves, stated no wider than it is:** with a token the DATABASE accepted, one tester is
limited to their own rows **by policy, at the database** — not by the app choosing what to ask for.
Both controls are green, so a denial is not being confused with an unreachable address, and the
tester owns a row, so *"saw only its own"* is not satisfied vacuously by an empty set. This is the
class the offline harness cannot see at all (PGlite is one superuser), so it was the last open
authorization gap and it is now closed.

**What it does NOT prove**, and neither should any summary of it:

- Only ONE tester was compared against the admin. That a *second* tester cannot read the first
  one's rows follows from the policy being on `reporter`, but it follows — it was not measured.
- Nothing about `type` suggestions, which still come from `issueVocabulary()` on the service key
  and can include values off rows the caller cannot read. Separate item, still open below.

```bash
node --env-file=.env.local scripts/check-tester-cannot-read-admin.mjs
```

It needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `TESTER_EMAIL` / `TESTER_PASSWORD` **in `.env.local`** —
not inline in front of the binary, which puts both passwords into shell history; and this repo does
not `source` env files (CLAUDE.md). `.env.local` is gitignored (`.gitignore:8`).

⚠️ **Re-running it needs a tester whose password you are allowed to hold** — see the note in
*Verified nowhere*. If a throwaway `@example.com` tester was made for this run, **delete it and
clear its credentials out of `.env.local`**; a live account whose password sits in a file is a
worse thing than the gap the check closed.

## Marketing material got an upload, a player and a delete — 2026-09-05 → 09

The tab that was a read-only table is now the whole loop. ✔ **All three parts have run in
production**, which for once is not a claim about the offline suite.

**Upload.** Title, file, tick who reviews it. ⚠️ **The file never passes through this app** — a
serverless request body caps at a few megabytes and a cut is tens, so the route mints a one-shot
signed URL and the browser PUTs straight to Supabase. ⚠️ **The row is written FIRST, as a `draft`**,
which is the one status reviewers cannot see: an upload that dies half way then leaves something
only the admin looks at, rather than bytes in a bucket nothing knows about. ⚠️ **And publishing
reads the object back through the reviewer's own path** — sign, then fetch one byte with `Range` —
never through the API that wrote it, because a write to this very bucket has returned success for
an object that was afterwards unreachable (finding #4).

**Watch**, on cleared cuts only. `/api/video-url` grew a second door: an admin who is not an
assigned reviewer can sign a cut that is **CLEARED**, computed from every assignment — not
`videos.status`, which says `reviewed` the moment ONE reviewer answers and would open a cut
somebody is still objecting to. The reviewer path runs first and is untouched.

**Delete**, with a `<dialog>` that counts what goes: *"and 3 notes from 2 reviewers"*. ⚠️ **The row
goes first and the object second**, because the two leftovers are not equally bad — an object with
no row is litter nobody sees; a row whose file has gone is a reviewer opening a dead player. A
failed object delete is **reported**, not swallowed: the slug is free again and the next upload
under the same title aims at a path that still exists.

⚠️ **THE FIRST UPLOAD IN PRODUCTION 500'd, AND NOTHING OFFLINE COULD HAVE SAID SO.** `42501
permission denied for table video_reviewers` — a revoke from 2026-09-02 whose stated reason
(*"Nothing in `src/` inserts here"*) had stopped being true the day before. Full write-up in
CLAUDE.md; `scripts/check-grants.mjs` is what now watches it. **A privilege is a claim about the
system, so it goes stale exactly like a comment does.**

**Also in this stretch**, all deployed and each confirmed from `/api/health`:

- **To-do**: filter chips by status, and the status pill is a **`<select>`** rather than a button
  that cycled. Cycling could only go forwards, so Done → In progress meant two presses *through*
  `not_started` — a state the database really held on the way past. ⚠️ The area meters keep reading
  the WHOLE list while a filter is on, and the reorder arrows are **withdrawn** while it is:
  position belongs to the whole list, so "up" would swap with a row you cannot see.
- **Chapter testing**: the form asks the short questions first and the prose last, and *"Plain words
  are perfect"* moved into the textarea's placeholder. `Age Group` · `Chapter Name` ·
  `Where in the chapter?` · `Select Problem Type`, then the details box above *Send it in*.
- **Join links last 21 days, not 7** (`DAYS` in `/api/admin/links`). A week was the wrong end of the
  trade: three of the first round were still unopened on day four. ⚠️ Three links **already sent**
  were extended in the database so the URLs people were holding kept working — *New link* would
  have done the opposite and killed them.

⚠️ **What is in production right now** (read back 2026-09-09, do not trust this list, re-read it):
two cuts, `rope-reel-v1-mp4` and `equals-reel-v1`, both `awaiting_review`, both assigned to
**mikuraja2** alone, both with their objects really in the bucket (2.8 MB and 4.8 MB). ⚠️ **The two
earlier videos — `equals-reel` and `rope-reel` — were DELETED**, with `equals-reel`'s notes and
Rafi's approval, and their files went from storage too. That is the delete path verified end to end
against real Supabase; it was not a test.

⚠️ **The titles are filenames.** `slug` is derived from the title and ends up in a URL *and* in the
object name, so `rope-reel-v1.mp4` became `rope-reel-v1-mp4` and the file `rope-reel-v1-mp4-v1.mp4`.
Nothing is broken; the next one is worth typing as a title.

**Not built:** a second version of a cut (`version` is hard-coded `1`), reordering, and any way to
change who the approver is after upload.

## One approver, everyone watches — 2026-09-09

Rafi: *give the admin and all the people under reviewer access to view all the marketing material
and give feedback, but only one person has the authorisation for approval and rejection.*

**What moved.** `reviewerVideoBySlug(slug)` no longer takes a reviewer: any `awaiting_review` /
`reviewed` cut resolves for anyone `requireRole('reviewer','admin')` let in. `videosForReviewer`
lists them all and marks each `decides` (the assignment row exists) — the list pill says *Your
decision needed* / *You finished this* / *Feedback welcome*. `/api/notes` and `/api/video-url`
stopped asking about the assignment; **`/api/review-done` asks `myAssignment()` itself** and 404s
without a row. The Review page renders no verdict buttons for a non-approver. The upload form's
chips became a one-of-many pick (*Who approves it?*), and `POST /api/admin/video` answers 400
`one_approver` for anything but exactly one id. The admin's Watch button now sits on every
published row; `clearedVideoForAdmin` in `/api/video-url` was deleted, not kept — one lookup now
answers everyone.

**No migration.** Grants are unchanged: `insert (video_id, reviewer_id)` was already column-level,
`update (verdict)` is still reached only through `/api/review-done`. Production already has one
row per cut (`mikuraja2` on both), so it is already in the new shape.

**Same afternoon, second ask — the approver is a PERSON, not a per-cut pick.** Rafi: *when you
give someone access as a reviewer there should be a way to make any reviewer the person who can
approve or reject; otherwise the reviewer only gives feedback.* So the per-cut picker lived for a
few hours and is gone:

- `20260909150000_profiles_can_approve.sql` — `profiles.can_approve boolean not null default
  false`, `grant update (can_approve) … to service_role`, and a backfill that flags whoever holds
  an assignment (refuses if that is more than one person). ✔ **APPLIED to `radlor-site` on
  2026-09-09 through the MCP connector (recorded as `profiles_can_approve`), BEFORE the push** —
  the new build selects the column, the old one ignored it. Read back, not assumed:

  | `profiles` | update `can_approve` | update `role` | update `name` | select `can_approve` |
  |---|---|---|---|---|
  | `service_role` | **t** | f | f | t |
  | `authenticated` | f | f | f | t |
  | `anon` | f | f | f | f |

  Flagged by the backfill: `mikuraja2` (reviewer), the one person on both live cuts.
  `scripts/check-grants.mjs` ran live straight after: **16 of 16**, the two new profile probes
  included.
- **People tab**: a fourth choice when pasting addresses — *Reviewer who approves or rejects*
  (refused only for a tester) — and *Make approver* / *Feedback only* beside every reviewer and
  admin. ⚠️ **Several people may hold it** — Rafi's second word the same evening, *"don't restrict
  it to one, we can create multiple"*; for about an hour setting one cleared the others. Every
  holder is named on each new cut and **a cut clears only when all of them approved**, which is
  the rule `clearance()` always had. A line above the list says who they are, or that it is nobody.
- **Upload** reads the flag on the server (`approverIds()`, uncached) and ignores anything the
  client says about reviewers; the form names who will be asked, and is disabled with the reason
  when nobody holds it. `POST /api/admin/video` answers 400 `no_approver` in that state.
- ⚠️ **The flag says who gets ASKED next; the `video_reviewers` row still says who may ANSWER.**
  Moving the flag from A to B leaves A deciding the cuts already out and puts B on the next one.
  There is still no reassignment. Flood in the seed is exactly this: feedback-only by flag, and
  still the approver on `flood-only` by row.
- `e2e/upload.spec.ts` carries it, mutating tests last in the file, each driving its own
  precondition; `-g` runs them alone.

⚠️ **Left deliberately:** the multi-row fixtures (`split-cut`, `overwrite-cut`, `doomed-cut`,
`equals-reel-final`) and everything that reads them — `clearance().disagreement`, the *Reviewers
disagree* banner, `progressLabel`. The new route cannot create a second row, so in new data these
are unreachable; they still tell the truth about the old rows and about a row somebody adds by
SQL. A `unique (video_id)` on `video_reviewers` is the honest enforcement of "one approver" and is
**not applied**: it is a migration, and it means collapsing those fixtures and the specs on them
in the same change. Do it as its own act, or leave the route as the enforcement and say so.

⚠️ **Verified offline only.** Nobody has yet opened a cut as a non-approver in production. The
smallest thing that changes that: sign in as any reviewer who is not `mikuraja2`, open one of the
two live cuts, leave a note, confirm there are no verdict buttons, and read `/admin`.

## ⚠️ The dashboard counted the notes and would not show them — fixed 2026-09-10

Rafi: *"as an admin, the notes the reviewer left for changes — I can't see them at all."* He was
right, and three real notes were in the database while he said it (`rope-reel-v1-mp4`,
`equals-reel-v1`, `tower-reel-v1-mp4`, all from `mikuraja2`, all open).

**Nothing was broken.** *Marketing material* had an *Unread notes* column showing a NUMBER, and the
only place the words existed was `/admin/export` — plain text, behind a small grey
*Open notes as markdown →* link above the table. So the tool said "there is feedback waiting" and
provided no way to read it from there.

> **A count with no way to reach the thing it counts is worse than no count.** It spends the
> reader's attention telling them something exists and then withholds it. The export was not the
> wrong artifact — it is for pasting into a chat — it was the wrong *only* door.

`src/app/admin/ReviewerNotes.tsx` renders them under the table: native `<details>` per cut, open
when anything is unread, grouped by `video_version`, each note showing its timestamp, its text, and
**who wrote it** — which matters more since 2026-09-09, because every reviewer can now leave notes
on every cut. Resolved ones are struck through. It is server-rendered from `allNotes()`, which the
page already fetched for the two counts, so it adds **no query**.

⚠️ **Still no way to mark a note resolved from the interface** — `resolved_at` is set by hand in
SQL, and the /admin cache table below still lists that write as TTL-only. Now that the notes are
readable, that is the obvious next ask; it was not this one.

`e2e/admin-notes.spec.ts` writes the note bodies out rather than importing the seed, and asserts
before any click (the complaint was about what the tab shows on arrival). Break-checked three ways:
section not rendered, versions collapsed onto the current one, resolved styling dropped — the last
asserts the **computed** `line-through`, not the class name.

## Source material, and the People tab grew teeth — 2026-09-10

Two asks, one afternoon.

### 1. *Source material* — a tab for what a cut is made FROM

`review.material` (20260910100000) plus its own private bucket `review-material`
(20260910100100). One row is either a **link** or a **file**, and **no format is refused** — Rafi's
words were "kuch bhi ho sakhta hai video, link, pdf kuch bhi". That is the opposite of
*Marketing material*, which whitelists four playable extensions because a reviewer has to press
play; nobody presses play on a font file.

⚠️ **It is deliberately NOT `review.videos` with a flag.** A row there has a version, a status,
assigned approvers, notes and a clearing rule. Sharing the table would put an "and not material"
clause into every reviewer query — the condition that gets forgotten once and shows an unreleased
brand deck to an outside reviewer.

- **The bucket is in its own migration file**, and the table's file must never say the words
  `storage` + `.` even in a comment: the offline harness SKIPS any migration matching that, because
  PGlite has no such schema, and one stray mention would take the whole table with it.
- **Files: row first, upload second, verify third**, exactly like a cut. `ready` stays false until
  the route has fetched a byte back through the reader's own path — finding #4 is why. An upload
  that died half way shows as *Upload did not finish* and offers no link, rather than a link that
  404s on the first click. A **link** is ready on arrival; there is nothing to verify.
- **Open is a plain `<a>` at `/api/admin/material?id=…`, which 302s to a freshly signed URL.**
  Nothing signed is ever rendered into the page, and there is no popup-blocker dance.
- ⚠️ **Only `http`/`https` links are saved.** Parsed with `new URL`, not pattern-matched: a
  `javascript:` URL rendered as an anchor on the admin's own page is a stored redirect into
  whatever the author of the pasted string wanted.
- **Admins only.** Whether reviewers should see the library is an open question, not an oversight —
  it is one line in `RoleNav` plus a role gate if the answer turns out to be yes.

### 2. People: change a role, and — for Rafi alone — remove somebody

`20260910110000` adds `profiles.is_owner` and grants `update (role)`.

✔ **ALL THREE MIGRATIONS APPLIED to `radlor-site` on 2026-09-10, through the MCP connector, BEFORE
the push.** Read back rather than assumed:

| | `material` select / insert / delete | `material` update `ready` / `storage_path` | `profiles` update `role` / `is_owner` / `name` |
|---|---|---|---|
| `service_role` | t / t / t | **t** / f | **t** / **f** / **f** |
| `authenticated` | f / f / f | f / f | f / f / f |
| `anon` | f / f / f | f / f | f / f / f |

Bucket `review-material` is **private**; `review.material` has RLS **on with 0 policies**.
`scripts/check-grants.mjs` ran live straight after: **23 of 23**.

✔ **The owner is set: `Rafi` (`kuwari84@gmail.com`), the first account created — exactly one row
has `is_owner`.** The other two admins do not, and see no Remove control.

⚠️ **`is_owner` HAS NO GRANT, AND THE ABSENCE IS THE FEATURE.** Nothing in the web tier can write
it, so ownership is not something this application can hand to anybody including itself. **The repo
does not say who the owner is** — no email, no uuid, no backfill — because this repo is public and
who holds the destructive button is environment data. It is one statement per environment:

```sql
update review.profiles set is_owner = true where user_id = '<the founder>';
```

Until that runs, **nobody** is the owner and the Remove control does not exist for anyone. That is
the correct way for it to fail.

⚠️ **`grant update (role)` REVERSES A STATED PROPERTY OF THE SCHEMA, KNOWINGLY.** 20260901120000
shipped saying "Nothing signed in can grant itself a role, which is the one write that would
matter", and `check-grants.mjs` asserted that refusal until today. It is given up because a tool
where fixing "I picked Tester by mistake" means opening Supabase has a decorative People tab. What
carries the weight instead: `name` and `is_owner` stay un-updatable, and `/api/admin/people`
refuses your own row and the owner's. **The grant check flips that row to `allowed` in the same
commit**, and gains two new refusals beside it (`is_owner`, `name`) so the row cannot be read as
"profiles became writable".

⚠️ **A "never leave zero admins" guard was written here and then DELETED as unreachable.** The
caller is always an admin and may never target their own row, so any admin being demoted or removed
is a *second* admin — at least two before the write, at least one after, always. A guard that
cannot fire is worse than none: it reads as the protection and is exercised by nothing. The
invariant is real; the not-yourself rule is what enforces it.

**Removing somebody deletes the AUTH USER, not the profile row.** `review.profiles` has no delete
grant and never will, so this cannot go through PostgREST at all; the profile follows by
`on delete cascade`, and so do their notes and verdicts. Their filed **issues survive** —
`issues.reporter` is `on delete set null`. The confirm says all three, with the real numbers.

⚠️ **And the real numbers are read UNCACHED, which is a bug this work created and a test caught.**
The obvious implementation counts `allNotes()` and `allAssignments()`, both right there and both
behind the 60-second cache — so the confirm on an irreversible control told a test "0 notes" about
somebody who had one. `workCountsByPerson()` reads them fresh, on the People tab only.

⚠️ **`Deputy Admin` exists in the seed for one property**: an admin who is *not* the owner. Without
it, "only the owner may remove somebody" cannot be told apart from "any admin may". It was called
`Second Admin` for an hour, until `filter({ hasText: 'second' })` in the upload spec matched it as
well — **a fixture's name has to be unique against every other fixture's name**, not merely
descriptive.

⚠️ **The offline harness had no `DELETE /auth/v1/admin/users/<id>` at all**, so Remove failed
against it with the shim's own `{"error":"no route"}` and read as a broken feature. Added, and it
deletes from `auth.users` so the REAL cascade runs — a shim that deleted the profile row directly
would pass the suite while proving nothing about the path production takes.

**Break-checked, ten ways** — unfinished uploads offered anyway, any URL scheme accepted, one-press
remove, the material route letting a reviewer in, the role write made a no-op, any admin removing
people, demotion leaving the approval flag on, the confirm's counts unread, your own row re-rolable,
and the owner's row re-rolable.

⚠️ **AND BREAK-CHECK CAUGHT A TEST THAT COULD NOT TELL TWO RULES APART.** "Your own row cannot be
re-roled" was asserted by having the harness admin PATCH themselves — but that account is both the
caller AND the owner, so deleting the not-yourself rule still produced a 400, from the owner rule,
and the check went green on the broken build. `Deputy Admin` is the only fixture where the two give
different answers, and the spec now asserts the **error code** rather than the status. Same family
as the `WHERE` clause that names the column under test: **when two rules can refuse the same
request, a test aimed where both fire is measuring neither.**

⚠️ **Two of the ten first came back `rc=5` — "the break stopped the suite".** `if (false) return
gate.deny` does not compile, so `next build` failed and every spec was red for a reason that had
nothing to do with the check. The verdict script refused to certify it, which is exactly what it
exists for. The breaks were narrowed to ones that COMPILE and change behaviour: let a reviewer
through the role gate, and make the role write target the row's existing value.

## The screens, and what changed on 2026-09-03

**One flat tab strip**, on every surface, showing only what the role can actually open:

`Dashboard · To-do 3 · Marketing material 5 · People · Chapter testing 2 · My reviews 1`

⚠️ **The tab KEY for Marketing material is still `videos`** — `/admin?tab=videos`. Only the word a
person reads changed (2026-09-06), so every bookmark and all seven specs that drive that URL still
land. Renaming the key is a separate, larger act.

A tester and a reviewer have one destination each, so they get no strip at all. Badges count **what
needs something**, never how many rows exist — a badge stuck at 25 stops being read.

- **Dashboard** is itself a tab: one card per section, each the smallest thing that answers "do I
  need to open this?". Every card links into its tab.
- ⚠️ **The two warnings render ABOVE the tabs, on every tab** — *approved by everyone but still has
  open notes*, and *reviewers disagree*. Tabs put detail away; they never put signal away. A spec
  lands on the default tab and expects the warning, so moving one inside a tab goes red.
- ⚠️ **There is no admin "Issues" tab.** It was `/tester` under a second name — same rows, same
  status control. Issues are read and triaged on **Chapter testing**, where the reporter's name now
  shows for a triager.

**The issue form:**

- `area` is **free text with no suggestion list**. It had one for a day; Rafi's call on 2026-09-03:
  an area is whatever part of the app the person was looking at, and offering a list makes the
  listed answers feel like the allowed ones. **Do not put it back citing convergence** — the cost
  (`measurement` and `Measurement` both existing) was accepted knowingly, and `e2e/tester.spec.ts`
  asserts the absence so re-adding it goes red rather than landing as an improvement.
- `type` keeps a `<datalist>`: a small vocabulary (`Titles`, `Wording`, `scale`) where one thing
  really does have one name. Suggestions, never a whitelist.
- **The chapter question** is one bordered control: a chapter box and a checkbox labelled
  **"Not about one chapter"**, with examples underneath. Ticking clears and disables the chapter
  box; the route forces `chapter` to null as well. Rafi filed "the app is lagging" against `ch 1`
  — the definition of an all-chapters issue — because the old label read as a scope *filter*. The
  wording is asserted verbatim in the spec, so changing it is a deliberate two-edit act.

⚠️ **Nothing auto-corrects what somebody typed, anywhere, and it must not start.** Silently
rewriting a person's data teaches them the tool edits their words, which is worse than a typo.
Cleaning up is a deliberate human act, by SQL — there is no edit control, the same as assignments
and videos:

```sql
-- Filter on the id AND the old value: if anything already changed it, this matches nothing rather
-- than overwriting whatever somebody else set.
update review.issues set area = 'measurement'
 where id = '…' and area = 'measurrement';
```

⚠️⚠️ **THAT "read-only" CLAIM IS FALSE AND WAS FALSE WHEN IT WAS WRITTEN — corrected 2026-09-10.**
An `update … returning` through `execute_sql` ran and returned the changed row. The sentence below
is kept because the METHOD it recommends is still the right one for a data fix (PostgREST, with the
grants the app actually holds, so the fix cannot do more than the app could). But do not repeat the
reason: a tool's capabilities are what it answers, not what a handoff says about it — the same rule
this file applies to repo visibility and to `$schema`. ⚠️ And it cuts the other way: `execute_sql`
can write, so it can write things no route could. It is not a safe place to be casual.

⚠️ The Supabase MCP's `execute_sql` was believed **read-only**; a data fix goes through PostgREST with the
service key, which does hold `update` on `review.issues`. Two were done this way on 2026-09-03:
Rafi's row's `area` spelling, and moving it to `all_chapters` with `chapter` null.

## Multiple reviewers

⚠️ **Read the section above this one first — since 2026-09-09 a cut has ONE approver and the
assignment no longer gates who can see it.** What follows describes the table and the clearing
rule, which still hold; the "every reviewer must approve" framing is history.

`review.video_reviewers` — `(video_id, reviewer_id, assigned_at, verdict)` — is the assignment, and
where `verdict` lives. It used to mean **no assignment, no video** (finding #7); it now means
**no assignment, no verdict** — the row names who decides, and everyone with the role watches.

**Cleared to post = every assigned reviewer approved.** `src/lib/clearance.ts` is the only place
that rule lives; `npm run test:clearance` checks it. ⚠️ Zero assignments is **not** cleared —
`[].every()` is `true`, which is how "cleared to post" would land on a video nobody has opened
(finding #8). `/admin` shows each reviewer's answer by name and disagreement as disagreement.

⚠️ **THAT LAST SENTENCE USED TO READ "assignment is a SQL statement Rafi runs … the web tier has no
INSERT or DELETE on the table". BOTH HALVES ARE NOW FALSE.** *Marketing material* uploads a cut and
ticks who reviews it, which is an INSERT here from a route. There is still **no reassignment UI**:
nothing changes who is on a video after it is created, and nothing unassigns — `delete` on this
table is still refused, and the only way an assignment disappears is with its video.

The privilege was reopened **column-level**, which is the part to keep:

```sql
grant insert (video_id, reviewer_id) on review.video_reviewers to service_role;
```

The web tier can ask somebody to review a cut and can **never**, through any bug in any route,
write what they concluded — `verdict` is not in the grant, it is nullable with no default, so an
assignment lands as "not finished". Writing a verdict is still `update (verdict)` through
`/api/review-done`, filtered to one reviewer's own row. ⚠️ `assignReviewers` therefore does **not**
send `verdict: null`; naming the column at all is refused with `42501`.

⚠️ **`review.reviewers` is vestigial** — nothing in `src/` reads it, names come from `profiles`.
Left standing for one release; dropping it is one line, on its own.

⚠️ **`videos.verdict` is a stale column.** Nothing reads or writes it; the copy has been read back
off the live database, so its drop (plus the `revoke update (verdict)` with it) is safe to do as its
own migration.

## ⚠️ Migrations — read before applying another one

The reviewer page 404'd in production for the length of a deploy on 2026-09-02, because a
**repointing** migration was applied ahead of the push. Full write-up as finding #9.

> **"Migration first" is not the rule. The dependency goes in before the thing that needs it — and
> for a migration that changes what an existing column MEANS, the running app is the dependency, so
> the order inverts. The deploy window is an outage window.**

Applied in the right order afterwards: the code that stopped reading `reviewers.token` shipped
first, the deploy was confirmed, *then* the column was dropped.

## The /admin cache

`allVideos`, `allNotes`, `allAssignments`, `allReviewers` go through `unstable_cache`, tagged, TTL
**60s**. ⚠️ **`src/lib/adminDb.ts` is deliberately NOT cached** — those reads go through `asUser()`
and RLS decides, so the same query returns different rows to different people.

| write | changes | route | invalidates |
|---|---|---|---|
| a note added | `allNotes` | `/api/notes` | ✅ `notes` |
| a note that REOPENS a review | `allAssignments`, `allVideos` | `/api/notes` | ✅ both, conditionally |
| a verdict set | `allAssignments` | `/api/review-done` | ✅ `assignments` |
| the video status it derives | `allVideos` | `/api/review-done` | ✅ `videos` |
| a video and its assignments added | `allVideos`, `allAssignments` | `/api/admin/video` POST | ✅ both |
| a video published out of draft | `allVideos` | `/api/admin/video` PATCH | ✅ `videos` |
| a video deleted | all three | `/api/admin/video` DELETE | ✅ `videos`, `assignments`, `notes` |
| a note marked resolved | `allNotes` | **SQL by hand** | ❌ TTL only |
| a profile added or renamed | `allReviewers` | **SQL by hand** | ❌ TTL only |

⚠️ **The rows still marked "SQL by hand" are why the 60s TTL is not a nicety.** There used to be
three of them and adding a video was one; since 2026-09-08 that goes through a route which
invalidates properly.

The four `/api/notes` and `/api/review-done` paths are each proven by break-check, against a spec
that drives its own precondition — see the two CLAUDE.md sections that exist because the first
version had the cache unwatched and then had break-check certify two checks that did not bind.
⚠️ **The three `/api/admin/video` rows are NOT break-checked for invalidation.** `e2e/upload.spec.ts`
and `e2e/delete-video.spec.ts` both cross from the write to the screen, so a deleted `revalidateTag`
would be caught — but that was never proven by watching it fail, which is the only thing that makes
the claim worth anything. Prove it or reword it; do not leave it reading as verified.

## Why the function region is pdx1

`vercel.json` pins Vercel functions to **pdx1** = **us-west-2**, where the database is. Measured
2026-09-02 after a report of 1–2s between tab clicks: functions were in `iad1` (us-east), so every
read crossed the United States and a page render is three sequential waves of them. The database
cannot move — a Supabase project's region is fixed at creation and it belongs to `radlor-site` — so
the function moved to it.

⚠️ **This does not make the app fast from India.** The floor is Mumbai to the US west coast. What
this removes is the extra US crossing paid on every wave on top of it. Genuinely quick from India is
a Supabase project in `ap-south`: a migration, not a config line.

⚠️ **The explanation lives HERE and not in `vercel.json`** — the first version put it in the file as
a `"//"` key and failed the production build.

## ⚠️ The offline suite was reading the previous run's cache — fixed 2026-09-09

`e2e/delete-video.spec.ts` went red twice in a row on a full run and green alone, with no
change to anything it touches. The row it deletes, `doomed-cut`, was **in the database** (the
spec's own PostgREST read said so) and **not on `/admin`** — nor in the disagreement banner, nor
in the DELETE route's `allVideos().find()`, which answered `not_found`. Videos and assignments
were from another world; notes were current.

**The other world was the previous run.** `next start` persists every `unstable_cache` entry to
`.next/cache/fetch-cache` (Next's own comment: *"so it can be persisted across deploys"*), keyed on
`cb.toString()` + the key parts — no build id — and `revalidateTag` state does **not** survive a
restart. So a fresh harness with a freshly seeded PGlite sat under a Next server whose first reads
of `videos` and `assignments` came from whatever the last run wrote, and stayed there until a route
in the run invalidated that tag. The last run had *passed* `delete-video`, so its persisted list had
no `doomed-cut`. Whether a run failed depended on what the run before it left behind: run 1 red,
run 2 red, a five-file prefix green, run 3 green, with the tree unchanged throughout.

`playwright.config.ts` now runs `rm -rf .next/cache/fetch-cache` before `next build`. ⚠️ **This
is a harness property, not an app bug** — production is one deployment with one cache and the
routes invalidate by tag correctly (the cache checks in `verdict.spec.ts` still prove that). But
it is the same shape as the rest of CLAUDE.md: a check that passes or fails on history is not a
check, and this one had been passing for the wrong reason on every run whose predecessor happened
to leave the right leftovers.

## Checks

```bash
npm run check           # everything below, in one go — run this before you push
npm run test:e2e        # 68 Playwright, fully offline against test/fake-supabase.mjs
npm run check:config    # vercel.json validated in full against Vercel's published schema
npm run test:clearance  # when a video is cleared to post
npm run test:verdict    # the break-check verdict logic
```

⚠️ **`node --test test/renewal.test.mjs` used to be on that list and the file is gone** — it went
with Costs and renewals on 2026-09-08. A command in a handoff that no longer runs is the same
species of stale as a grant comment: it reads as a step somebody skipped.

⚠️ **A green suite covers behaviour, not permission.** PGlite runs as one superuser with no role
switching, so grants, RLS and anything that depends on *who is asking* are invisible to it by
construction. The declared blind spot is at the top of `test/fake-supabase.mjs`. The only
authorization coverage is five scripts run by hand against the live project:

```
scripts/check-grants.mjs                     what service_role may do — 23 privileges, both ways
scripts/check-anon-locked-out.mjs            anon is denied, with a service_role control (now incl. material)
scripts/check-tester-cannot-read-admin.mjs   profiles AND issues, with two controls
scripts/check-signed-url-expiry.mjs          a signed URL really dies
scripts/check-blast-radius.mjs               the documented exposure is still what the docs say
```

⚠️ **`check-grants.mjs` is new on 2026-09-09 and it exists because this class cost a second time.**
The upload form answered **500 in production on its first use** — `42501 permission denied for
table video_reviewers` — with all 68 offline tests green. It asks **behaviourally**, real verbs
through PostgREST as `service_role`, because PostgREST cannot call `has_table_privilege` without an
RPC and an RPC added so a checker can pass is a new thing to trust. It asserts the **falses** too:
a checker that only confirmed the privileges we want would pass on a database where the web tier
can delete every tester's issue. It writes one throwaway video and deletes it, clearing any
leftover first. **Run it after any migration.** ⚠️ One existing row FLIPPED from `refused` to
`allowed` on 2026-09-10 (`profiles: change role`) — read the comment beside it before believing the
change was accidental. Last run 2026-09-10, after all three of that day's migrations were applied:
**23 of 23**.

Re-run them after any change to a grant, a policy, a role, the exposed schemas, or a key.
`scripts/break-check.sh <spec> "<break>"` runs one spec against a deliberately broken tree and
restores unconditionally; exit **0 means the check binds**.

**Last full run: 2026-09-01, 4 of 4 PASS.** The role split is demonstrated, not asserted — a
sentence only writable after the fourth, which is why a three-of-four table was not left standing.
⚠️ The issues half was the **weak** form: the tester read 0 of the admin's 13, and 0 is also what a
rejected token returns. It meant something only because CONTROL B proved the same token could read
its own profile. That is the gap the run above closes.

## Open findings and their triggers

All in [docs/security-findings.md](docs/security-findings.md). Two are scheduled rather than closed:

- **Review tool's role separation** — ⚠️ **both triggers fired 2026-09-01**: `public.waitlist` holds
  a real row (the trade was accepted about an **empty** table) and `review.subscriptions` holds
  financial data. ⚠️ The second trigger is now odd in a way worth naming: the app no longer READS
  that table, but the key it holds still reaches it, so the exposure is unchanged while the reason
  to have the data here has gone. Dropping the table would retire the trigger outright. **Re-decided the same day, unchanged: defer both** — but the old argument is gone,
  since `radlor-site`'s `/api/waitlist` no longer holds `service_role`. What defers it now is only
  the price. **Next revisit: when Milo takes real money**, not on the next row.
- **Higgsfield balance automation** — ⚠️ **moot in this tool since 2026-09-08**: Costs and renewals
  was removed, so there is no balance here to automate or to go stale. The finding is kept because
  the *data* did not go anywhere — `review.subscriptions` still holds it, and whatever tracks
  spending next inherits the same choice. Typed and honestly labelled beats automated and quietly
  wrong.

`scripts/check-blast-radius.mjs` prints the row counts those triggers turn on, every run.

## Verified nowhere, as of 2026-09-09

- ⚠️ **The strong tester-vs-admin comparison — still NOT RUN, and the way to run it CHANGED on
  2026-09-04.** The data got better: `kuwarirafi@gmail.com` came in through a `/join` link, set
  their own password, filed from `/tester`, and the row reached `/admin`. So a tester owns rows and
  the script's "a tester owning nothing is a FAIL" arm is satisfied — but **re-read the counts when
  you run it rather than trusting the 1 / 14 that used to be here**, because rows have been added
  since.
  ⚠️⚠️ **The wrinkle, and it is caused by this very design: the admin no longer knows anybody's
  password.** The script wants `TESTER_EMAIL` / `TESTER_PASSWORD` in `.env.local`, and there is now
  no honest way to fill them for a real tester — the whole point of accounts-by-link is that the
  password is chosen by the person and never travels. **Do not ask a tester for theirs.** Make a
  throwaway `@example.com` tester through *People*, open its link yourself, set a password you
  chose, file one issue as it, and run the comparison against that; delete it afterwards against
  the allow-list. The check is unchanged in what it proves — only the fixture has to be one you are
  allowed to hold the password to.
- **That `type` suggestions include values from rows the caller cannot read.** It is the whole
  reason `issueVocabulary()` uses the service key, and the offline harness cannot see it: PGlite has
  no policies, so a list of everyone's values is indistinguishable from a list of the caller's own.
  An assertion would go green on exactly the broken build.
- **Multiple reviewers against the live project — STILL 1:1, and now easier to fix.** Production has
  two cuts and **one reviewer on each** (`mikuraja2`), so the disagreement banner, the progress
  label and the clearing rule have still only ever been driven against the offline fixture. ⚠️ The
  smallest thing that changes this used to be a SQL statement; it is now **one more chip ticked at
  upload time** — but only at upload time, because nothing reassigns an existing video. So: upload a
  throwaway cut with two people ticked, have both answer differently, and read `/admin`.
- ⚠️ **The upload → assign → publish path IS verified in production (2026-09-08), and so is
  delete.** Two cuts went up through the form and their objects are really in the bucket; two
  earlier ones were destroyed by the Delete button, rows, notes, verdicts and files. What that does
  **not** cover: a failed object delete (the branch that tells the admin the file is still in
  storage) has never happened for real, and neither has an upload that gets a signed URL and then
  fails to PUT. Both are handled and both are unwitnessed.
- **Nobody has driven `/admin` or `/tester` as themselves beyond filing one issue.** The reviewer
  surface has been: Rafi signed in at `/review` on 2026-09-02 and confirmed it, which is what
  allowed the token path to be deleted. ✔ **Partly retired 2026-09-04:** a second person now has
  driven `/tester` as themselves, from a link, through to the row appearing on `/admin`. The
  reviewer surface has still only ever had one human on it.
- **Self-signup being off** in Supabase Auth — cannot be read from here.
