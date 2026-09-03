# Radlor Ops

An internal tool for getting timestamped notes on unreleased marketing videos from one outside
reviewer, and getting them back as markdown.

**Separate from the Milo app on purpose** — separate repo, separate Vercel project. It is a public,
token-authenticated surface that accepts free text, and it must not sit next to children's data.

⚠️ **It does NOT have its own Supabase project.** The free tier caps the account at two, so it
shares `radlor-site`'s database, in its own **`review` schema** with its own private
**`review-videos`** bucket. That is allowed — the marketing site holds no children's data — but the
`service_role` key is per-project, so **anything that compromises this tool reads and writes every
table in `radlor-site`**. That cost is accepted, costed and recorded in
[SETUP.md → Blast radius](SETUP.md#blast-radius). The schema is a namespace, not a boundary.

- **[handoff.md](handoff.md)** — where work left off, what's waiting on a decision, what's unverified.
- **[SETUP.md](SETUP.md)** — everything to click, in order, and the env vars.
- **[PR_BODY.md](PR_BODY.md)** — what this does, and what the watermark is and isn't.
- **[docs/security-findings.md](docs/security-findings.md)** — open findings, including one about
  the marketing site. This repo is private; the site's is not.

## Routes

| Route | Who | What |
|---|---|---|
| `/r/<token>` | reviewer | Videos with status `awaiting_review`. Unknown or revoked → 404. |
| `/r/<token>/<slug>` | reviewer | Player + notes panel + the seven questions. |
| `POST /api/notes` | reviewer | One note. Token resolved server-side, rate limited per token. |
| `GET /api/video-url` | reviewer | A five-minute signed URL for a private-bucket object. |
| `/admin` | you | Videos, status, version, unread-note count. Open `/admin?k=<ADMIN_TOKEN>` once; it becomes an httpOnly cookie and the parameter is stripped. |
| `/admin/export` | you | Open notes as markdown, by video and version. `?all=1` adds the resolved ones, struck through. |

Everything else, including `/`, is a 404.

## Commands

```bash
npm run dev          # localhost:3019 — needs .env.local
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint
npm run test:e2e     # Playwright, fully offline (see below)
```

## The test harness

`npm run test:e2e` runs against `test/fake-supabase.mjs`, not against Supabase: PGlite (Postgres
compiled to WASM) running **this repo's real migration**, plus a storage endpoint that signs and
expires URLs for real. Playwright builds and starts a **production** build, so the checks see the
real CSP and the real HTTP status of a 404 page.

It proves this app's logic. It proves nothing about Supabase's own RLS enforcement or its
signed-URL implementation — those are checked once, against the live project, by
`scripts/check-anon-locked-out.mjs` and `scripts/check-signed-url-expiry.mjs`. See SETUP.md.

`scripts/check-blast-radius.mjs` is a third kind of thing again: a **documentation test**. It
asserts the sharing exposure is exactly what SETUP.md records, so the written radius cannot drift
while nobody is looking. It is not protection and its own first comment says so.

## Watching a check fail

A check that has not been seen red on the state it exists for is not a check — see
[CLAUDE.md](CLAUDE.md). `scripts/break-check.sh` runs one spec against a deliberately broken tree
and restores the tree unconditionally, including any uncommitted work:

```bash
scripts/break-check.sh e2e/rate-limit.spec.ts "perl -pi -e 's/const TOKEN_LIMIT = 10$/const TOKEN_LIMIT = 10000/' src/app/api/notes/route.ts"
```

You name **the spec you claim your break should turn red**, because red on its own is not evidence:
a break that stops the code compiling turns every spec red, and a script that accepts any red would
certify a check that would also go red if you deleted a semicolon. The exit code is about *your
check*, not about playwright:

| exit | meaning |
|---|---|
| **0** | the named spec went red **on its own assertion** — the check binds |
| 1 | the named spec passed on the broken state — the check is decorative |
| 3 | the break edited nothing; its pattern has drifted — nothing was tested |
| 4 | the named spec went red, but from a throw or a bare timeout — red for the wrong reason |
| 5 | the run never reached the named spec (build died, config error) — nothing was tested |

`scripts/break-verdict.mjs` draws that distinction; `npm run test:verdict` checks it against crafted
reports, including the two outcomes this repo's specs are too well-ordered to produce naturally.
