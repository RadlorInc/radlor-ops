# Session Handoff — Radlor Ops

> **Read [CLAUDE.md](CLAUDE.md) first.** It holds the standing rules; this file is only "where work
> left off". Keep it short — the product repo's handoff grew to 60 KB and became a running cost on
> every session.

## In one minute

Three people, three screens, one Next.js app on Vercel:

- **admin** (Rafi) — `/admin`: what things cost, the to-do list, which videos are cleared to post.
- **tester** — `/tester`: files what they found wrong in the app, and reads their own issues back.
- **reviewer** — `/review`: watches the video assigned to them, leaves timestamped notes, says
  **Approved** or **Needs changes**.

Everyone signs in at `/login`. There is no open sign-up and **no email is ever sent** — Rafi's call
on 2026-09-03. The admin pastes the testers' **email addresses** into the *People* tab; the server
makes one account per address **with no password at all** and hands back one single-use link each.
The admin copies that block and sends it to the tester head, who forwards each person their own
line; opening it is where that person chooses their password, and it signs them straight in.
Forgot a password? *New link* beside their name — which also kills any link they were still
holding. **An admin can open all three surfaces**; a tester and a reviewer see only their own.

**The one rule the whole tool exists for:** a video is cleared to post only when **every** assigned
reviewer has approved. One "needs changes" is not cleared, however many approvals sit beside it.

## Where it is right now

**Live** at `https://video-reviewer-liard.vercel.app`, from **`RadlorInc/radlor-ops`** (PRIVATE).
Vercel deploys on push to `main`.

⚠️ **A push is not a deploy — confirm it.** On 2026-09-03 a build **failed** (a `"//"` key in
`vercel.json`; see CLAUDE.md) and several pushes sat undeployed while every local check was green.
Confirm from the running deployment, never from a settings page or from the push succeeding:

```bash
curl -s https://video-reviewer-liard.vercel.app/api/health
# {"status":"ok","auth_configured":true,"region":"pdx1"}
```

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

## ⚠️ The Vercel project is still called `video-reviewer` — and renaming it breaks live links

The app was renamed to **Radlor Ops** on 2026-09-04: browser title, `package.json`, README, and the
GitHub repo (`RadlorInc/video-reviewer` → `RadlorInc/radlor-ops`). **The Vercel project and its
`video-reviewer-liard.vercel.app` domain were deliberately left alone.** It is a dashboard job —
*Project → Settings → General → Project Name* — and nothing in this repo can do it.

⚠️ **Do it only while no `/join/<token>` link is outstanding.** Those links are built from
`location.origin` at the moment the admin copies them, so every link already forwarded to a tester
points at the OLD domain and dies the moment the project is renamed. The person holding one gets a
dead host, not a 404 from this app — there is no way to explain it to them from inside the tool.
The safe window is: rename first, THEN make the links. There is no reason to rename it at all
except tidiness, so if links are out, it waits.

⚠️ **And check the Git connection after the repo rename.** Vercel usually follows a GitHub rename
on its own, but "usually" is not a check: open *Project → Settings → Git* and confirm it names
`RadlorInc/radlor-ops`. A stale connection does not error — it just quietly stops deploying, and
the first symptom is a push that changes nothing.

Nothing else needs the name: Supabase's Site URL and redirect URLs play no part in this design
(no mail is sent), and `next.config.ts` derives its media origin from `SUPABASE_URL`, not from the
app's own host.

**Accounts in production:** `kuwari84@gmail.com` (admin), `kuwarirafi@gmail.com` (tester). Both real
— **never delete either.** Throwaway accounts for checks use `@example.com` and are deleted against
an explicit allow-list, never "everything except the ones I remember".

## Accounts by link — built 2026-09-04, MIGRATION APPLIED, NOT YET DEPLOYED

**What is live on Vercel right now** (`1d74b49`) is the *email* version: an *Invite someone* form
calling `/auth/v1/invite`, plus `/forgot`, `/auth/confirm` and `/set-password`. ⚠️ **It does not
work in production and never will** — it needs custom SMTP and rewritten templates, and Rafi
decided the same evening that no email is to be sent at all. **Nobody should configure SMTP.
Nobody should send an invite from that tab.** The working tree replaces all of it.

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

**Still to do, in this order:**

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

## ⚠️ Waiting on Rafi — one thing

**Run the tester-vs-admin RLS check.** It is the only authorization property with a gap right now,
and it finally has the data it needs (see *Verified nowhere*).

```bash
node --env-file=.env.local scripts/check-tester-cannot-read-admin.mjs
```

It needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `TESTER_EMAIL` / `TESTER_PASSWORD` **in `.env.local`** —
not inline in front of the binary, which puts both passwords into shell history; and this repo does
not `source` env files (CLAUDE.md). `.env.local` is gitignored (`.gitignore:8`).

## The screens, and what changed on 2026-09-03

**One flat tab strip**, on every surface, showing only what the role can actually open:

`Dashboard · Costs 1 · To-do 3 · Videos 5 · Chapter testing 2 · My reviews 1`

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

⚠️ The Supabase MCP's `execute_sql` is **read-only**; a data fix goes through PostgREST with the
service key, which does hold `update` on `review.issues`. Two were done this way on 2026-09-03:
Rafi's row's `area` spelling, and moving it to `all_chapters` with `chapter` null.

## Multiple reviewers

`review.video_reviewers` — `(video_id, reviewer_id, assigned_at, verdict)` — is the assignment, and
where `verdict` lives. **No assignment, no video:** before it existed, any valid token opened any
reviewable video (finding #7).

**Cleared to post = every assigned reviewer approved.** `src/lib/clearance.ts` is the only place
that rule lives; `npm run test:clearance` checks it. ⚠️ Zero assignments is **not** cleared —
`[].every()` is `true`, which is how "cleared to post" would land on a video nobody has opened
(finding #8). `/admin` shows each reviewer's answer by name and disagreement as disagreement.

**Assignment is a SQL statement Rafi runs**, like adding a video — no reassignment UI, no due dates,
no reminders, and the web tier has no INSERT or DELETE on the table.

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
| a video or an assignment added | `allVideos`, `allAssignments` | **SQL by hand** | ❌ TTL only |
| a note marked resolved | `allNotes` | **SQL by hand** | ❌ TTL only |
| a profile added or renamed | `allReviewers` | **SQL by hand** | ❌ TTL only |

⚠️ **The bottom three are why the 60s TTL is not a nicety.** All four app paths are proven by
break-check, each against a spec that drives its own precondition — see the two CLAUDE.md sections
that exist because the first version had the cache unwatched and then had break-check certify two
checks that did not bind.

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

## Checks

```bash
npm run check           # everything below, in one go — run this before you push
npm run test:e2e        # 61 Playwright, fully offline against test/fake-supabase.mjs
npm run check:config    # vercel.json validated in full against Vercel's published schema
npm run test:clearance  # when a video is cleared to post
npm run test:verdict    # the break-check verdict logic
node --test test/renewal.test.mjs
```

⚠️ **A green suite covers behaviour, not permission.** PGlite runs as one superuser with no role
switching, so grants, RLS and anything that depends on *who is asking* are invisible to it by
construction. The declared blind spot is at the top of `test/fake-supabase.mjs`. The only
authorization coverage is four scripts run by hand against the live project:

```
scripts/check-anon-locked-out.mjs            anon is denied, with a service_role control
scripts/check-tester-cannot-read-admin.mjs   profiles AND issues, with two controls
scripts/check-signed-url-expiry.mjs          a signed URL really dies
scripts/check-blast-radius.mjs               the documented exposure is still what the docs say
```

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
  financial data. **Re-decided the same day, unchanged: defer both** — but the old argument is gone,
  since `radlor-site`'s `/api/waitlist` no longer holds `service_role`. What defers it now is only
  the price. **Next revisit: when Milo takes real money**, not on the next row.
- **Higgsfield balance automation** — revisit at **four or more tools**, or when a balance has gone
  stale enough to mislead. Typed and honestly labelled beats automated and quietly wrong.

`scripts/check-blast-radius.mjs` prints the row counts those triggers turn on, every run.

## Verified nowhere, as of 2026-09-03

- ⚠️ **The strong tester-vs-admin comparison — available and NOT RUN.** Rafi filed a real issue in
  production on 2026-09-03, so a tester finally owns a row. The script is upgraded: **a tester
  owning nothing is now a FAIL** (zero satisfied "saw only its own" vacuously), and the admin's view
  must CONTAIN the tester's and be strictly larger. Expect tester **1**, admin **14**.
- **That `type` suggestions include values from rows the caller cannot read.** It is the whole
  reason `issueVocabulary()` uses the service key, and the offline harness cannot see it: PGlite has
  no policies, so a list of everyone's values is indistinguishable from a list of the caller's own.
  An assertion would go green on exactly the broken build.
- **Multiple reviewers against the live project.** Production has one reviewer and one video, so
  only the 1:1 case is exercised there. The disagreement banner, the progress label and the clearing
  rule have been driven only against the offline fixture. Assigning a second reviewer to
  `equals-reel` is the smallest thing that changes that.
- **Nobody has driven `/admin` or `/tester` as themselves beyond filing one issue.** The reviewer
  surface has been: Rafi signed in at `/review` on 2026-09-02 and confirmed it, which is what
  allowed the token path to be deleted.
- **Self-signup being off** in Supabase Auth — cannot be read from here.
