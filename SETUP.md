# Setup

Everything you have to click, in order. Nothing in this repo creates an account, a project or a
bucket — the code assumes they exist and fails loudly if they don't.

Time: about fifteen minutes, once.

> ⚠️ **The `?k=<ADMIN_TOKEN>` gate is GONE.** `/admin` and `/tester` need a real account now —
> Supabase Auth, email + password, **self-signup off**. Accounts are created by hand in
> Authentication → Users (tick *Auto Confirm User*; there is no SMTP), and their `review.profiles`
> row is written with the service key. Nothing signed in can grant itself a role. `ADMIN_TOKEN` is
> no longer read by anything and can be deleted from Vercel and `.env.local`.
>
> **Steps 1, 2 and 4 are already done** on `ghuvnqbthbcmqfxcrjrh` (2026-08-31): the `review` schema,
> its three tables and grants, and the private `review-videos` bucket all exist and were verified by
> reading the database back. **What is left for you is step 3 (Exposed schemas) and step 5 (env
> vars).** The rest is kept because this is the reproducible record of how it was set up.

**Read [Blast radius](#blast-radius) before you start.** This tool shares a database with the
marketing site, and that has a cost you are agreeing to by following these steps.

---

## 1. Supabase project — the EXISTING one

⚠️ **Do not create a project.** The free tier caps this account at two, so this tool goes into the
existing **`radlor-site`** project (`ghuvnqbthbcmqfxcrjrh`) — the marketing site's.

That is allowed because `radlor-site` holds no children's data. **Sharing with the Milo app is
still forbidden, and does not become allowed if the tier gets tighter.** The cost of sharing this
one is real and is written down under [Blast radius](#blast-radius) below; read that section, it is
not boilerplate.

**Settings → API**, copy two things:

| What | Where it goes |
|---|---|
| Project URL (`https://ghuvnqbthbcmqfxcrjrh.supabase.co`) | `SUPABASE_URL` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The `service_role` key bypasses RLS entirely and is scoped to the **project**, not to a
> schema. It is server-only. It must never be given a `NEXT_PUBLIC_` prefix and must never be
> pasted into a client component. There is deliberately no `NEXT_PUBLIC_` variable anywhere in this
> app — the browser never talks to Supabase.

## 2. Apply the migration

**SQL Editor → New query**, paste each of the three files in `supabase/migrations/` in filename
order and run them. They create a **`review` schema** and put all three tables in it; `public`
belongs to the marketing site.

⚠️ The third one, `..._grant_review_tables_to_service_role.sql`, is not optional and is not
tidying. Supabase's default privileges cover `public` and `storage` but **not a new custom
schema**, so the tables are created owner-only and `service_role` has no privilege on them —
`BYPASSRLS` does not substitute for a `GRANT`. Without it every route answers
`42501 permission denied for table videos`. It was found by reading the live database after
applying, because no offline test can see a grant.

> ⚠️ **Do NOT `supabase db push` against this project.** Its history now holds this repo's three
> migrations (applied 2026-08-31 through the MCP connector, which records them) but **not**
> `public.waitlist`, which predates it and was applied by hand. So the history is partial: a push
> from the *radlor-site* repo would try to apply its waitlist migration on top of the existing
> table. Apply anything new the same way — SQL editor, or the connector.

Check afterwards, in **Table Editor** (schema selector → `review`), that `reviewers`, `videos` and
`notes` all show the **RLS enabled** badge with **zero policies**. That is correct here and not an
unfinished job: RLS on with no policies means `anon` can read nothing at all, and every
reviewer-facing read happens server-side after the route has resolved the token itself.

## 3. Expose the `review` schema to the API

**Settings → API → Exposed schemas.** It currently reads `public, graphql_public`. Change it to:

```
public, graphql_public, review
```

⚠️ **`review` goes LAST.** The first entry is PostgREST's *default profile*, so keeping `public`
first means an unqualified request can never accidentally land in this tool's tables. This app
always sends `Accept-Profile: review` / `Content-Profile: review` explicitly.

Without this step every route 404s with `PGRST106`, which reads exactly like a broken deploy.
Exposing the schema grants nothing on its own — the migration revokes all table privileges from
`anon` and `authenticated`, and RLS is on.

## 4. Storage bucket

**Storage → New bucket**:

- Name: `review-videos` (exactly — it is a constant in `src/lib/storage.ts`, not an env var, so a
  typo fails on the first play rather than pointing quietly at nothing)
- **Public bucket: OFF**
- Leave it with no policies.

⚠️ **Its own bucket, its own name.** This project belongs to the marketing site too. It has zero
buckets today, which is not a reason to take the generic name `videos` — that is how two tools end
up writing into one.

Nothing but the service role can read it, and the only way to a byte of video is a signed URL
minted by `/api/video-url`, which dies after five minutes.

## 5. Vercel project

1. Push this repo to GitHub (its own repo — not a folder in the Milo one). The repo stays
   separate even though the database no longer is.
2. https://vercel.com/new → import it → **New Project**. Framework preset: Next.js. Root directory:
   repo root.
3. Before the first deploy, **Environment Variables** — add all three, for
   **Production, Preview and Development**:

```
SUPABASE_URL               https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  <service_role key from step 1>
SUPABASE_ANON_KEY          <anon / publishable key>
```

`SUPABASE_ANON_KEY` is the project's public key. It is server-only here too — it talks to Supabase
Auth and reads as the SIGNED-IN USER so RLS policies apply. It gets no `NEXT_PUBLIC_` prefix,
because the browser still never contacts Supabase in this app.

Check it landed: `curl -s https://<domain>/api/health` → `"auth_configured": true`.

4. Deploy.

> A missing `SUPABASE_ANON_KEY` means nobody can sign in — closed, not open.

Sign in at `/login`. A signed-OUT visitor to `/admin` or `/tester` gets the login page rather than
a 404 — admins and testers are expected users, and hiding the door from someone who is supposed to
walk through it is a support ticket, not security. A signed-IN **tester** who tries `/admin` gets a
**404**, because they do not need to learn that page exists.

## 6. Create the reviewer

Generate a token:

```bash
node -e "console.log('tok_' + require('crypto').randomBytes(24).toString('base64url'))"
```

Then **SQL Editor**:

```sql
insert into review.reviewers (name, email, token)
values ('Their Name', 'them@agency.com', 'tok_…paste…');
```

Their link is `https://<your-vercel-domain>/r/tok_…`. Send it to them. Keep the token — it is stored
in plain text on purpose so you can re-send the same link instead of issuing a new one.

To revoke:

```sql
update review.reviewers set revoked_at = now() where email = 'them@agency.com';
```

The link 404s from the next request — identically to a token that never existed.

## 7. Add a video

Upload the file to the `review-videos` bucket (Storage → `review-videos` → Upload, or your own script), then:

```sql
insert into review.videos (slug, title, storage_path, version, status, sort_order)
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

**Anon can read nothing** (needs the public anon/publishable key from Settings → API). This is the
one that matters — until it passes, the security posture is **unverified, not verified-by-stand-in**:

```bash
SUPABASE_URL=https://ghuvnqbthbcmqfxcrjrh.supabase.co \
SUPABASE_ANON_KEY=<anon key> SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/check-anon-locked-out.mjs
```

It needs the service key too, as a **positive control**: it makes the identical request with the
identical profile header as `service_role` first, and refuses to report on `anon` at all unless
that succeeds. It then requires a specific `42501 permission denied` — not merely "no rows came
back", which is also what an unexposed schema, a missing table and a restored grant look like.

**A signed URL dies when it expires** — signs a 2-second URL, fetches it, waits, fetches it again:

```bash
SUPABASE_URL=https://ghuvnqbthbcmqfxcrjrh.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/check-signed-url-expiry.mjs equals-reel-final-v1.mp4
```

**The blast radius is what the docs say it is** — a documentation test, not a boundary (see below):

```bash
SUPABASE_URL=https://ghuvnqbthbcmqfxcrjrh.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/check-blast-radius.mjs
```

---

## Blast radius

This tool's server routes hold **`radlor-site`'s `service_role` key**. That key is scoped to the
**project**, not to a schema, and it bypasses RLS. So, plainly:

> **Anything that compromises this tool reads and writes every table in `radlor-site`, including
> `public.waitlist`.**

The `review` schema is a **namespace, not a boundary**. It stops a name collision; it stops nothing
else. Nothing in this repo changes that, and no amount of RLS on the `review` tables changes it
either, because the key that bypasses RLS is in the same process.

**Why this was accepted rather than fixed.** A real boundary needs a dedicated Postgres role over a
direct connection (PostgREST can only reach a custom role via a JWT signed with the project's JWT
secret — and that same secret signs a `service_role` token, so it buys nothing), plus a
storage-only S3 access key for signing, because Supabase has no per-bucket credential. Costed at
5–7 hours plus a `pg` dependency and a Supavisor connection to manage on serverless. It was not
built for one reason: **`radlor-site`'s own `/api/waitlist` is a public endpoint that already holds
this same key over this same table.** Hardening this door while that one stands open is a receipt,
not a boundary. If the exposure is worth closing, it is worth closing for both apps at once.

⚠️⚠️ **BOTH REOPENING TRIGGERS HAVE FIRED (2026-09-01).** `public.waitlist` now holds a real row,
and `review.subscriptions` now holds financial data. See
[docs/security-findings.md](docs/security-findings.md) #1 — the decision below was made about an
empty table and no longer rests on that.

⚠️ **AND THIS DECISION WAS MADE ABOUT AN EMPTY TABLE.** On 2026-08-31 `public.waitlist` held
**zero rows**. It is a table of **email addresses and children's age-bands**, and the moment it has
real people in it the calculation changes and **the separation question reopens** — the decision
above should not quietly survive the table filling up. `scripts/check-blast-radius.mjs` prints the
row count and says so when it is no longer zero, so the trigger is a fact rather than someone
remembering.

## Running the loop

All of this is SQL in the dashboard. There is no admin UI for it on purpose — each one is a single
statement, and a UI for five statements is a UI to maintain.

**Send a cut out for review:**

```sql
update review.videos set status = 'awaiting_review' where slug = 'equals-reel-final';
```

**Mark notes as acted on** (this is what clears the unread count on `/admin`, and what stops a v1
comment resurfacing against v2):

```sql
update review.notes set resolved_at = now()
where video_id = (select id from review.videos where slug = 'equals-reel-final')
  and resolved_at is null;
```

**Ship v2 for review:**

```sql
update review.videos
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
update review.videos set status = 'reviewed' where slug = 'equals-reel-final';
```

You usually won't need that one. The reviewer has two buttons — **Approved — good to post** and
**Needs changes** — and either sets `status = 'reviewed'` plus a **`verdict`**.

`status` is where the video sits in the flow; `verdict` is what the reviewer concluded. They are
separate columns on purpose: "reviewed" alone never told you whether it was cleared to post.

If the reviewer adds another note after choosing, the verdict is **cleared to null** and the status
flips back to `awaiting_review`, and the page says so. A verdict that survived new feedback would be
a lie about what they currently think — and "approved" sitting above a note that contradicts it is
how something gets posted it shouldn't be. A `reviewed` video stays visible on their list, marked,
so thinking of one more thing does not lock them out.

`/admin` shows the verdict per video and calls out **approved-with-open-notes** — a real state, not
a contradiction: they liked it and still left things worth reading. It does not block you; it just
does not let it be silent. The export puts the verdict in the heading:

```
## equals-reel — v1 — APPROVED
```

⚠️ Only the **current** version's heading carries it. `verdict` lives on the video row, so stamping
it on a v1 heading for a video now at v2 would label an old round with a judgement never passed on
it — the same trap `notes.video_version` exists for. Verdict history is not stored.

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
- **No dedicated database role, and no separation from the marketing site's data.** Deliberate,
  costed, and written up under [Blast radius](#blast-radius). Not an oversight.
