# Session Handoff — video reviewer / ops dashboard

> **Read [CLAUDE.md](CLAUDE.md) first.** It holds the standing rules; this file is only "where work
> left off". Keep it short — the product repo's handoff grew to 60 KB and became a running cost on
> every session.

## Where it is right now

**Live** at `https://video-reviewer-liard.vercel.app`, from **`RadlorInc/video-reviewer`** (PRIVATE).
Vercel deploys on push to `main` — it does, verified; do not wait on a manual deploy.

⚠️ **Do not pin a SHA here.** Check it instead: `git log --oneline -1 origin/main`, then confirm the
deployment actually moved (the CSS chunk hash in the served HTML changes between builds).

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
| **reviewer** | ⚠️ still a **token in a URL**, `/r/<token>` — no account | their video, notes, verdict |

Accounts in production: `kuwari84@gmail.com` (admin), `kuwarirafi@gmail.com` (tester). Both real —
**never delete either.** Throwaway accounts for checks use `@example.com` and are deleted against an
explicit allow-list, never "everything except the ones I remember".

## What is live

- **Reviewer side** (phase 0): token link, player with watermark + `nodownload`, timestamped notes,
  seven questions, **Approved / Needs changes** verdict. A note after a verdict clears it and
  reopens the review.
- **Phase 1** — Supabase Auth, `review.profiles`, role gates, RLS. The `?k=<ADMIN_TOKEN>` gate is
  **gone**; `ADMIN_TOKEN` is read by nothing and can be deleted from Vercel and `.env.local`.
- **Phase 2** — costs and renewals (four urgency states, monthly total, freshness labels), to-do
  (25 rows imported), tester issues section.
- **Phase 3** — tester issues (13 imported), session capture instead of a hours column.

**Both sheets are ARCHIVE, not maintained. There is no sync back and there must not be** — two
places to edit one list ends with neither being right. If sync is asked for, say this first.

## ⚠️ Waiting on Rafi — two things, both proposed and neither started

1. **To-do categories.** A mapping for all 25 rows was posted for approval on 2026-09-01, with three
   marked `?` rather than guessed (`Business Case Validation`, `Brush-up Adaptive Learning Portal`,
   `My Cloud`). **Nothing has been written.** Guessing what someone's task meant and storing it as
   fact is the same move as back-classifying tester issues, which was correctly refused.
2. **Reviewer accounts** (a third role, then deleting the token path entirely). Plan and the two
   answers he asked for are in the same message. Recommendation: **no force-change-on-first-login —
   send a single-use Supabase recovery link instead of a password over WhatsApp.** Trade named: a
   reviewer who loses their session needs a new link from Rafi, because there is no password reset
   without SMTP.

   ⚠️ **The migration has real data.** `review.reviewers` has rows and `notes.reviewer_id` points at
   them. Repoint first, read the notes back row-by-row (count, timestamps, bodies, author), and drop
   the token column in a **separate** migration so a bad repoint cannot take the token path with it.

## Open findings and their triggers

All in [docs/security-findings.md](docs/security-findings.md). The two that are scheduled rather
than closed:

- **Review tool's role separation** — revisit when **Milo starts taking real money**, or when
  `review` holds more than the handful of rows it has today.
- **Higgsfield balance automation** — revisit at **four or more tools** in the costs table, or when
  a balance has gone stale enough to mislead. Numbers are typed monthly and labelled *"you typed
  this"*; typed and honestly labelled beats automated and quietly wrong.

`scripts/check-blast-radius.mjs` prints the row counts those triggers turn on, every run.

**Closed on 2026-09-01:** `radlor-site`'s `/api/waitlist` no longer holds `service_role` — it has the
anon key against a column-level INSERT grant. That is why the separation question above is live
again rather than rhetorical.

## Checks

```bash
npm run test:e2e        # 50 Playwright, fully offline against test/fake-supabase.mjs
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
restores unconditionally. Exit **0 means the check binds** — see README.

## Verified nowhere, as of 2026-09-01

- **Nobody has used `/tester` or `/admin` as themselves.** Both are proven to render real data live,
  driven by throwaway accounts; Rafi driving them by hand is outstanding.
- **The stronger issues RLS comparison** — right now a tester sees 0 of the admin's 13, which only
  means something because a control proved their token reads their own profile. It gets sharp once a
  tester has filed something.
- **Self-signup being off** in Supabase Auth — cannot be read from here.
