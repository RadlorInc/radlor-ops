# Setup

Everything you have to click, in order. Nothing in this repo creates an account, a project or a
bucket — the code assumes they exist and fails loudly if they don't.

Time: about fifteen minutes, once.

---

## 1. Supabase project

1. https://supabase.com/dashboard → **New project**.
2. Organisation: whichever you like. **Do not reuse the Milo project** — that is the whole point of
   this being a separate tool.
3. Name: `radlor-video-reviewer`. Region: closest to you. Set a database password and keep it.
4. Wait for it to provision.

Then **Settings → API** and copy two things:

| What | Where it goes |
|---|---|
| Project URL (`https://<ref>.supabase.co`) | `SUPABASE_URL` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The `service_role` key bypasses RLS entirely. It is server-only. It must never be given a
> `NEXT_PUBLIC_` prefix, and it must never be pasted into a client component. There is deliberately
> no `NEXT_PUBLIC_` variable anywhere in this app — the browser never talks to Supabase.

## 2. Apply the migration

**SQL Editor → New query**, paste the whole of
[`supabase/migrations/20260831120000_init_video_reviewer.sql`](supabase/migrations/20260831120000_init_video_reviewer.sql),
run it.

(Or, if you'd rather use the CLI: `supabase link --project-ref <ref>` then `supabase db push`.)

Check afterwards, in **Table Editor**, that `reviewers`, `videos` and `notes` all show the
**RLS enabled** badge. They should have **zero policies** — that is correct here and not an
unfinished job. RLS on with no policies means `anon` can read nothing at all; every reviewer-facing
read happens server-side after the route has resolved the token itself.

## 3. Storage bucket

**Storage → New bucket**:

- Name: `videos` (exactly — it is a constant in `src/lib/storage.ts`, not an env var, so a typo
  fails on the first play rather than pointing quietly at nothing)
- **Public bucket: OFF**
- Leave it with no policies.

Nothing but the service role can read it, and the only way to a byte of video is a signed URL
minted by `/api/video-url`, which dies after five minutes.

## 4. Vercel project

1. Push this repo to GitHub (its own repo — not a folder in the Milo one).
2. https://vercel.com/new → import it → **New Project**. Framework preset: Next.js. Root directory:
   repo root.
3. Before the first deploy, **Environment Variables** — add all three, for
   **Production, Preview and Development**:

```
SUPABASE_URL               https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  <service_role key from step 1>
ADMIN_TOKEN                <a long random string — see below>
```

Generate the admin token with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

4. Deploy.

> `ADMIN_TOKEN` unset means `/admin` is **closed**, not open — a missing variable can never be a
> way in. If you deploy without it, `/admin` 404s until you set it and redeploy.

You open `/admin?k=<ADMIN_TOKEN>` **once**. The app immediately swaps it for an httpOnly cookie and
redirects to `/admin` with the parameter stripped, so the token lands in your browser history, any
referrer header and Vercel's request log exactly once rather than on every request. After that,
bookmark the bare `/admin` — the cookie lasts a week, and rotating `ADMIN_TOKEN` kills every
outstanding one.

(If you want to hit it from `curl` rather than a browser, you need to hold the cookie and follow
the redirect: `curl -sL -c jar -b jar 'https://<domain>/admin/export?k=<ADMIN_TOKEN>'`.)

## 5. Create the reviewer

Generate a token:

```bash
node -e "console.log('tok_' + require('crypto').randomBytes(24).toString('base64url'))"
```

Then **SQL Editor**:

```sql
insert into reviewers (name, email, token)
values ('Their Name', 'them@agency.com', 'tok_…paste…');
```

Their link is `https://<your-vercel-domain>/r/tok_…`. Send it to them. Keep the token — it is stored
in plain text on purpose so you can re-send the same link instead of issuing a new one.

To revoke:

```sql
update reviewers set revoked_at = now() where email = 'them@agency.com';
```

The link 404s from the next request — identically to a token that never existed.

## 6. Add a video

Upload the file to the `videos` bucket (Storage → `videos` → Upload, or your own script), then:

```sql
insert into videos (slug, title, storage_path, version, status, sort_order)
values ('equals-reel-final', 'Equals sign reel (final cut)', 'equals-reel-final-v1.mp4',
        1, 'awaiting_review', 0);
```

`storage_path` is the path **inside** the bucket, with no bucket name and no leading slash.
`slug` is lowercase letters, digits and hyphens (enforced by a check constraint).

`status` must be one of `draft`, `awaiting_review`, `reviewed`, `revising` — also enforced by a
check constraint, so a typo is an error rather than a video that quietly stops appearing.

---

## Verifying it works

Two things the offline test harness in this repo *cannot* prove, because they are Supabase's
behaviour and not this app's. Run each once, against the real project:

**Anon can read nothing** (needs the public anon/publishable key from Settings → API):

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> \
  node scripts/check-anon-locked-out.mjs
```

**A signed URL dies when it expires** — signs a 2-second URL, fetches it, waits, fetches it again:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/check-signed-url-expiry.mjs equals-reel-final-v1.mp4
```

---

## Running the loop

All of this is SQL in the dashboard. There is no admin UI for it on purpose — each one is a single
statement, and a UI for five statements is a UI to maintain.

**Send a cut out for review:**

```sql
update videos set status = 'awaiting_review' where slug = 'equals-reel-final';
```

**Mark notes as acted on** (this is what clears the unread count on `/admin`, and what stops a v1
comment resurfacing against v2):

```sql
update notes set resolved_at = now()
where video_id = (select id from videos where slug = 'equals-reel-final')
  and resolved_at is null;
```

**Ship v2 for review:**

```sql
update videos
set version = version + 1,
    storage_path = 'equals-reel-final-v2.mp4',
    status = 'awaiting_review'
where slug = 'equals-reel-final';
```

The reviewer's panel then shows an empty note list for v2; their v1 notes are still in the database
and still exported under the `— v1` heading, because each note is stamped with the version it was
written against.

**Take it off their list when you're done:**

```sql
update videos set status = 'reviewed' where slug = 'equals-reel-final';
```

**Get the notes out:** `https://<your-domain>/admin/export` — markdown, grouped by video and
version, sorted by timestamp, ready to paste.

It shows **open notes only** by default, with a footer line saying how many resolved ones it left
out, so a short export never quietly reads as a complete one. `?all=1` includes the resolved ones
too, struck through. That is what makes the `resolved_at` update above worth doing: after a bump to
v2 the reviewer's panel clears, so an unresolved v1 note exists only in this export.

---

## Local development

```bash
cp .env.example .env.local     # then fill it in
npm install
npm run dev                    # http://localhost:3019
```

The test suite needs none of that — it runs fully offline against `test/fake-supabase.mjs`:

```bash
npm run test:e2e
```

---

## Things that are deliberately not here

- **No email.** SMTP is unstarted; the unread count on `/admin` is the notification.
- **No upload UI.** Files go into the bucket by hand or by your own script.
- **No reply threads, no shared visibility between reviewers, no side-by-side v1/v2 player.** The
  version is stored; the comparison UI is not built.
- **No hashed tokens.** Plain text, so the link can be re-sent. See the PR body.
- **No admin login form.** The token-in-a-link is swapped for a cookie on first use; there is
  nothing to log into and no password to store.
