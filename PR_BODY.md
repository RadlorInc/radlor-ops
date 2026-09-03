# Radlor Ops — a separate tool, for one outside reviewer

A standalone Next.js app for getting timestamped notes on unreleased Radlor vertical videos back
out as markdown. **New repo, new Vercel project** — it shares no infrastructure with the Milo app,
deliberately: this is a public, token-authenticated surface that accepts free text from a stranger,
and the main app has a COPPA/privacy review and an independent security pass still pending. If this
tool is ever wrong, the worst case is "a reviewer saw the wrong video".

**The database is shared with `radlor-site`** — the free tier caps the account at two projects. Own
`review` schema, own private `review-videos` bucket, `public` untouched. Allowed because the
marketing site holds no children's data; the Milo app remains off-limits regardless of tier.
⚠️ **The `service_role` key is per-project, so this tool can read and write every table in
`radlor-site`, `public.waitlist` included.** That is not hidden by the schema and is not fixed by
RLS. Full reasoning, the 5–7 hour alternative and why it was declined:
[SETUP.md → Blast radius](SETUP.md#blast-radius).

`src/app/api/_rateLimit.ts` is **copied** from the Milo repo, not imported. A shared module would
be the first thread tying the two projects back together.

## What it does

- `/r/<token>` — the reviewer's list, `awaiting_review` videos only.
- `/r/<token>/<slug>` — player left, notes right. "Add note" captures `currentTime`, rounds to the
  second, pauses, and opens the input. Notes sort by timestamp; clicking one seeks. The seven
  review questions sit in a collapsed panel on the page, so they're in front of the reviewer rather
  than in an email they've lost.
- `POST /api/notes` — token resolved server-side, rate limited.
- `GET /api/video-url` — a signed URL with a five-minute life against a private bucket. There is no
  permanent link anywhere.
- `/admin` — every video, its status and version, and an unread-note count. Opened once as
  `/admin?k=<ADMIN_TOKEN>`; the app swaps that for an httpOnly cookie and redirects to the bare
  path, so the token is in the URL for exactly one request instead of every one. No login form.
- `/admin/export` — open notes as markdown, grouped by video and version, sorted by timestamp,
  with a footer saying how many resolved ones were left out. `?all=1` includes them, struck
  through. This is the actual output of the tool.

## On the watermark and `controlsList="nodownload"`

**These are deterrents, not protection.** The video is delivered to the browser over HTTP; anyone
who opens the network tab can copy the stream URL and save the file, and the watermark is a `div`
that a determined person can delete from the DOM before recording. Nothing here secures the video
and nothing here should be described as securing it.

What they do is raise the friction on **casual forwarding** — which, with an outside contractor we
don't know well, is the realistic risk. `nodownload` removes the one-click save from the player
menu. The overlay carries the reviewer's name and email at low opacity and moves to a different
anchor every twenty seconds, including a centre position, so a screen recording carries their
identity and a crop cannot reliably remove it. The point is that a file which leaks is traceable to
the person it was sent to, and that they know it is.

The things actually holding the line are elsewhere: a private bucket with no policies, signed URLs
that die in five minutes, RLS on with no policies so the public key reads nothing, and a token
that can be revoked in one `UPDATE`.

## One deviation from the spec, flagged rather than assumed

**`notes.video_version`** — a column the spec did not list, added because the spec does not work
without it. `version` lives on `videos`, so it is the video's version *now*: the moment a cut is
bumped to v2, every v1 note starts reporting as a v2 note and `/admin/export` groups them under the
wrong heading. Since telling v1 notes from v2 notes is exactly the reason `version` is in the MVP,
the column is stamped from the video row by the server at insert time. Same argument as for
`version` itself: added now it's a line; added later it's a migration over a populated table.

If you'd rather not have it, say so and I'll take it out — but then `version` isn't doing the job
it was put there for.

## Deliberate choices worth a second look

- **Tokens are stored in plain text**, as asked, so a link can be re-sent. The mitigations that go
  with that: never logged (`src/lib/db.ts` never puts a request path into an error), never used as
  a client-side query filter, unreadable by `anon`, revocable in one statement, and
  `Referrer-Policy: no-referrer` so a token in the path can't leak into someone else's access log.
- **`/admin` is gated by an httpOnly cookie**, obtained by opening `?k=<ADMIN_TOKEN>` once. The
  token reaches a log, a history entry or a referrer exactly once. Rotating the env var
  invalidates every outstanding cookie.
- **Unknown, revoked and malformed tokens all get the same 404**, page and API alike. A distinct
  answer for "revoked" confirms to whoever is holding it that the token was once real.
- **The rate limit is in-memory and per serverless instance.** Same ceiling as the Milo copy, and
  for one reviewer on one tool it is nowhere near being reached.

## Not built, on purpose

Replies/threads, cross-reviewer visibility, side-by-side v1/v2 playback, email notifications, and
an upload UI. The version is stored; the comparison UI is not.
