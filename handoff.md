# Session Handoff — video reviewer / ops dashboard

> **Read [CLAUDE.md](CLAUDE.md) first.** It holds the standing rules; this file is only "where work
> left off". Keep it short — the product repo's handoff grew to 60 KB and became a running cost on
> every session.

## Where it is right now

**Live** at `https://video-reviewer-liard.vercel.app`, from **`RadlorInc/video-reviewer`** (PRIVATE).
Vercel deploys on push to `main` — it does, verified; do not wait on a manual deploy.

⚠️ **Do not pin a SHA here.** Check it instead: `git log --oneline -1 origin/main`, then confirm the
deploy from the **Vercel dashboard's Deployments list**, which names the commit.

⚠️⚠️ **DO NOT USE THE CSS CHUNK HASH TO DETECT A DEPLOY. This file used to recommend it; it is
removed, not caveated.** It reported "no deploy" twice on 2026-09-02 when the deploy had in fact
landed — both times in the same direction, and the second one produced a confident wrong diagnosis
of a live 404 and a proposed write to the production database. A method that has been wrong every
time it mattered does not get a narrower description. The readable signals from here are the page
HTML, the response headers, and **behaviour only one build has** — `/review` answering `307 → /login`
instead of `404` is what settled it, because that route does not exist in the older build.

**Database:** the **`radlor-site` Supabase project**, `ghuvnqbthbcmqfxcrjrh`, schema **`review`**.
Not its own project — the free tier caps the account at two. The schema is a namespace, not a
boundary; see [docs/security-findings.md](docs/security-findings.md) #1.

⚠️ **The schema is still `review`, not `ops`.** A rename 404s the live reviewer tool from the moment
it runs until a human edits *API → Exposed schemas*, which no migration can reach. Reasoning is in
the first migration.

## The three roles

| role | how they get in | what they see |
|---|---|---|
| **admin** | account, `/login` | `/admin` — costs, to-do, tester issues, videos, export |
| **tester** | account, `/login` | `/tester` — file and read their own issues. `/admin` 404s |
| **reviewer** | account, `/login` → `/review` | videos **assigned to them**, notes, verdict. `/admin` and `/tester` 404 |

Accounts in production: `kuwari84@gmail.com` (admin), `kuwarirafi@gmail.com` (tester). Both real —
**never delete either.** Throwaway accounts for checks use `@example.com` and are deleted against an
explicit allow-list, never "everything except the ones I remember".

## What is live

- **Reviewer side** (phase 0): player with watermark + `nodownload`, timestamped notes,
  seven questions, **Approved / Needs changes** verdict. A note after a verdict clears it and
  reopens the review.
- **Phase 1** — Supabase Auth, `review.profiles`, role gates, RLS. The `?k=<ADMIN_TOKEN>` gate is
  **gone**; `ADMIN_TOKEN` is read by nothing and can be deleted from Vercel and `.env.local`.
- **Phase 2** — costs and renewals (four urgency states, monthly total, freshness labels), to-do
  (25 rows imported), tester issues section.
- **Phase 3** — tester issues (13 imported), session capture instead of a hours column.

**Both sheets are ARCHIVE, not maintained. There is no sync back and there must not be** — two
places to edit one list ends with neither being right. If sync is asked for, say this first.

## ⚠️ Waiting on Rafi — nothing outstanding

1. ~~**To-do categories.**~~ **Done 2026-09-01** — `scripts/set-todo-areas.mjs`, all 25 rows carry
   an `area`. Seven: Website, Marketing, Social, Legal, Testing, Ops, Product.
   ⚠️ **Three of them are the assistant's guess, not Rafi's answer**, and stay guesses until he
   says otherwise: `My Cloud` → Ops, `Brush-up Adaptive Learning Portal` → Product,
   `Business Case Validation` → Product. He asked for a call rather than a fourth question; the
   label is in the script's docblock, in its output and here, because a guess whose provenance is
   only in a chat log reads as fact by the next session. Correcting one is one word in `/admin`.
2. ~~**Reviewer accounts.**~~ **Done 2026-09-02.** Third role `reviewer`; `/review` is the signed-in
   surface, scoped by assignment. `notes.reviewer_id` and `video_reviewers.reviewer_id` hold
   `profiles.user_id`. **The token path is removed** — `/r/<token>`, `reviewerByToken()` and the
   `reviewers.token` column are all gone, after Rafi signed in at `/review` and confirmed it.
   ⚠️ **That confirmation was the gate, not a formality.** No SMTP means no self-serve reset, so a
   reviewer who cannot get in has no way back without Rafi. Same order the `?k=` gate went in.
   ⚠️ **And the no-SMTP consequence stays stated plainly in SETUP.md.** Do not soften it; it is what
   makes someone ask for SMTP at the point it starts costing them.

   ⚠️ `review.reviewers` is now **vestigial** — nothing in `src/` reads it, names come from
   `profiles`. Left standing for one release with `name`/`email`/`user_id`; dropping it is one line,
   on its own, when nobody has wanted the old rows for a while.

## Multiple reviewers — built, applied and pushed 2026-09-02

Rafi asked for more than one person on the same video. `review.video_reviewers` is the assignment
— `(video_id, reviewer_id, assigned_at, verdict)`, PK on the first two — and it is where `verdict`
now lives. **The rule: a video is cleared to post only when EVERY assigned reviewer has approved.**
One `changes_needed` is not cleared however many approvals sit beside it; a later approval does not
overwrite an earlier objection, because each verdict is its own row. `src/lib/clearance.ts` holds
that in one function, `npm run test:clearance` checks it, and both it and the assignment scoping
were proven with `scripts/break-check.sh` rather than asserted.

⚠️ **Two findings came out of it**, both in [docs/security-findings.md](docs/security-findings.md):
**#7** any valid token opened any reviewable video (nobody decided that; it fell out of there being
one video) and **#8** `[].every()` is `true`, so a video with zero assignments read as *cleared to
post* until the length check was added.

**Applied to the live project 2026-09-01/02, in this order, with a read between each step:**

1. `20260902090000_video_reviewers.sql` — applied. Pre-state read first: 1 reviewer, 1 video, 1
   verdict, table absent. The backfill's one-reviewer guard therefore did not fire.
2. Backfill **read back as a row, not as a success code**: `equals-reel` → Rafi's assignment
   (`9005210c…`), `verdict = 'approved'`, `videos.verdict` still `approved` beside it, 1 assignment
   total. Then read again through **PostgREST with the profile header**, which is the path the app
   actually uses — a `select` privilege and an exposed schema are different questions.
3. ⚠️ **The privilege read-back found the previous migration's comment was FALSE** — see
   `20260902093000_video_reviewers_revoke_insert.sql` and the CLAUDE.md rule it produced. Now:
   select ✔ · update(verdict) ✔ · insert ✘ · delete ✘ · anon select ✘.
4. Pushed. `origin/main` at `4569c76`.
5. Pushed and deployed. ⚠️ See the incident below before repeating this sequence.

⚠️ **`videos.verdict` is still there, and now it is safe to drop.** Nothing reads or writes it; the
copy has been read back off the live database. The drop and the `revoke update (verdict)` that goes
with it are the next migration — still a separate one, applied on its own.

**Assignment is a SQL statement Rafi runs**, like adding a video. Deliberately no reassignment UI,
no due dates, no reminders — and the web tier now genuinely has no INSERT or DELETE on the table,
so a route bug cannot invent an assignment. A fabricated assignment is a fabricated reviewer.

**Still true, and load-bearing:** a reviewer sees their own notes and their own verdict, never
another reviewer's. It is what stops one reviewer anchoring on another's opinion.

⚠️ **The Vercel MCP connector cannot see this project** — `list_deployments` 403s and
`get_deployment` 404s under the only team it can reach (which holds `adaptivelearn` /
`RadlorInc/learn` and nothing else). **Auto-deploy IS on and works**: every push all day produced a
Ready production deployment. So a deploy that looks missing from here is a reading failure, not a
pipeline failure — check the dashboard, or a behaviour only the new build has.

## ⚠️ The incident on 2026-09-02 — read before applying another migration

The reviewer page 404'd in production for the length of a deploy, because a **repointing** migration
was applied ahead of the push on the rule that the database goes first. That rule is for ADDITIVE
migrations. Full write-up as finding #9 in [docs/security-findings.md](docs/security-findings.md);
the two sentences worth carrying:

> **"Migration first" is not the rule. The dependency goes in before the thing that needs it — and
> for a migration that changes what an existing column MEANS, the running app is the dependency, so
> the order inverts. The deploy window is an outage window.**

> **A measurement that has been wrong every time it mattered gets deleted, not caveated.** The
> CSS-chunk-hash deploy check said "not deployed" twice while the deploy was Ready, and on that
> basis a write to production data was proposed for a system that was already fine.

## Open findings and their triggers

All in [docs/security-findings.md](docs/security-findings.md). The two that are scheduled rather
than closed:

- **Review tool's role separation** — ⚠️ **both triggers fired on 2026-09-01** (measured by
  `check-blast-radius.mjs`): `public.waitlist` holds **1 real row**, and the trade was accepted about
  an **empty** table; `review.subscriptions` holds **1 row of financial data**. Nothing about the
  exposure changed, only the contents behind it.
  **Re-decided the same day, unchanged: defer both.** Note that the old argument for deferring is
  gone — `radlor-site`'s `/api/waitlist` no longer holds `service_role`, so "the public front door
  already holds this key, sealing the side door is theatre" no longer applies. What holds it now is
  only the price: the launch blockers are worth more than five hours of role plumbing.
  **Next revisit: when Milo takes real money** — not on the next row.
- **Higgsfield balance automation** — revisit at **four or more tools** in the costs table, or when
  a balance has gone stale enough to mislead. Numbers are typed monthly and labelled *"you typed
  this"*; typed and honestly labelled beats automated and quietly wrong.

`scripts/check-blast-radius.mjs` prints the row counts those triggers turn on, every run.

**Closed on 2026-09-01:** `radlor-site`'s `/api/waitlist` no longer holds `service_role` — it has the
anon key against a column-level INSERT grant. That is why the separation question above is live
again rather than rhetorical.

## Checks

```bash
npm run test:e2e        # 55 Playwright, fully offline against test/fake-supabase.mjs
npm run test:verdict    # the break-check verdict logic
npm run test:clearance  # when a video is cleared to post — every assigned reviewer approved
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
restores unconditionally. Exit **0 means the check binds** — see README.

## Ran 2026-09-01 against the live project — 4 of 4 PASS

All four, in one sitting. **The role split is demonstrated, not asserted** — which is a sentence
that could only be written after the fourth one, and is the reason a three-of-four table was not
left standing. Three of four green reads as "nearly verified" and is not: it was missing the only
check that puts a tester against an admin's data, which is the property the whole split exists for.
A partial run gets reported as a partial run.

- `check-anon-locked-out` — a stranger with the public key gets `42501` on all three tables, with a
  `service_role` control proving the address is reachable.
- `check-signed-url-expiry` — the same signed URL, 200 before the expiry and `InvalidJWT` after.
  SETUP.md's example object name was stale (`equals-reel-final-v1.mp4` does not exist; the live one
  is `equals-reel-v1.mp4`) — the check exited 1 with `NoSuchKey`, which was it being right. Fixed.
- `check-blast-radius` — the exposure still matches what SETUP.md records; **both reopening
  triggers fired**, see above.
- `check-tester-cannot-read-admin` — **what it proved**, not merely that it went green: the admin's
  token reads 2 profile rows and the tester's reads 1, *its own*; the tester cannot see the admin's
  row. On issues, admin 13 and tester 0, and the tester saw only rows it filed.

```bash
node --env-file=.env.local scripts/check-tester-cannot-read-admin.mjs
```

It needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `TESTER_EMAIL` / `TESTER_PASSWORD` — the two real
accounts' passwords. **Put them in `.env.local` and let `--env-file` parse them.** Not inline in
front of the binary: that puts both passwords into shell history, and this repo does not `source`
env files (CLAUDE.md). `.env.local` is gitignored — confirmed, `.gitignore:8`.

⚠️ **The issues half of that check is the weak half, and a green result is where that gets lost.**
The tester reads **0** of the admin's 13 — but `0` is also what a rejected token, an unexposed
schema and a typo'd table name return. It means something only because CONTROL B, the same token
against `profiles`, came back 200 with 1 row: the credential works, so the empty result is a denial
and not a failure to ask. The **stronger form** — a tester seeing exactly their own N out of the
admin's N+13 — needs a tester to have filed something. Rafi is filing one; **re-run this check
after that**, and the assertion stops depending on a control to be meaningful.

## Verified nowhere, as of 2026-09-01

- **Nobody has used `/tester` or `/admin` as themselves.** Both are proven to render real data live,
  driven by throwaway accounts; Rafi driving them by hand is outstanding.
- **The stronger issues RLS comparison** — pending a real tester issue, then a re-run of
  `check-tester-cannot-read-admin`. Detail above; do not let the 4-of-4 line absorb it.
- **That the multi-reviewer build is actually DEPLOYED.** The database half is applied and read
  back; the app half is pushed and unconfirmed — see step 5 above. Nothing is broken either way,
  because the migration only added.
- **Multiple reviewers against the live project.** Production still has one reviewer and one
  video, so the 1:1 case is the only one exercised there. `/admin`'s disagreement banner, the
  progress label and the clearing rule have been driven only against the offline fixture. Assigning
  a second reviewer to `equals-reel` is the smallest thing that changes that.
- **Self-signup being off** in Supabase Auth — cannot be read from here.
