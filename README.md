# Radlor video reviewer

An internal tool for getting timestamped notes on unreleased marketing videos from one outside
reviewer, and getting them back as markdown.

**This is a separate project from the Milo app on purpose** — separate repo, separate Vercel
project, separate Supabase project. It is a public, token-authenticated surface that accepts free
text, and it must not sit next to children's data.

- **[SETUP.md](SETUP.md)** — everything to click, in order, and the three env vars.
- **[PR_BODY.md](PR_BODY.md)** — what this does, and what the watermark is and isn't.

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

## Watching a check fail

A check that has not been seen red on the state it exists for is not a check — see
[CLAUDE.md](CLAUDE.md). `scripts/break-check.sh` runs the suite against a deliberately broken tree
and restores the tree unconditionally, including any uncommitted work:

```bash
scripts/break-check.sh "perl -pi -e 's/const TOKEN_LIMIT = 10$/const TOKEN_LIMIT = 10000/' src/app/api/notes/route.ts" e2e/rate-limit.spec.ts
```

Its exit code is inverted on purpose: **0 when the suite goes red** (the check binds), 1 when the
suite passes on the broken state (it does not), 3 when the break edited nothing — a break whose
pattern has drifted produces a green run that looks exactly like a passing check.
