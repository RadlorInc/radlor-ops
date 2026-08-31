-- Video reviewer: one outside marketing reviewer, timestamped notes on unreleased vertical videos.
--
-- Threat model this schema is written against: the ONLY public surface is a token in a URL that a
-- stranger holds. So no table is readable by `anon` at all, and every reviewer-facing read is done
-- server-side by the service role after it has resolved that token itself. RLS is enabled with NO
-- policies, which in Postgres means "deny everything except the roles that bypass RLS" — that is
-- the intended state here, not an unfinished one.

create table if not exists reviewers (
  -- gen_random_uuid() is core Postgres from 13 on; no pgcrypto extension needed.
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  email       text not null check (length(btrim(email)) between 3 and 254),
  -- PLAIN TEXT ON PURPOSE (founder's call): the link has to be re-sendable, which a hash forbids.
  -- The mitigations that go with that choice: never logged, never a client-side query filter,
  -- unreadable by `anon`, and revocable in one UPDATE.
  token       text not null unique check (length(token) >= 24),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$'),
  title        text not null check (length(btrim(title)) between 1 and 200),
  storage_path text not null check (length(storage_path) between 1 and 400),
  version      int  not null default 1 check (version >= 1),
  -- Exactly four values, enforced by the database rather than by convention.
  status       text not null default 'draft'
               check (status in ('draft', 'awaiting_review', 'reviewed', 'revising')),
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists notes (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references videos (id) on delete cascade,
  reviewer_id   uuid not null references reviewers (id) on delete cascade,
  t_seconds     int  not null check (t_seconds >= 0 and t_seconds <= 86400),
  body          text not null check (length(btrim(body)) between 1 and 4000),
  -- ⚠️ NOT IN THE ORIGINAL SPEC, AND THE SPEC DOES NOT WORK WITHOUT IT. `version` lives on
  -- `videos`, so it is the video's version NOW — the moment a video is bumped to v2 every v1 note
  -- silently reports as a v2 note, which is the exact thing `version` was added to prevent, and
  -- `/admin/export` would group them under the wrong heading. Stamped from the video row at insert
  -- time by the server route. Same argument the founder made for `version` itself: a column added
  -- later is a migration over a populated table; added now it is a line.
  video_version int  not null check (video_version >= 1),
  -- Set when the founder has acted on the note. Kept per (note, version) so an acted-on v1 comment
  -- does not resurface against v2.
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- The reviewer's panel reads (video, reviewer) ordered by timestamp; /admin counts unresolved
-- notes per video. One index covers both.
create index if not exists notes_video_reviewer_t_idx on notes (video_id, reviewer_id, t_seconds);

alter table reviewers enable row level security;
alter table videos    enable row level security;
alter table notes     enable row level security;

-- Belt as well as braces. RLS with no policies already denies `anon`, but a future `create policy`
-- written in a hurry cannot grant what the role has no privilege to touch in the first place.
revoke all on reviewers from anon, authenticated;
revoke all on videos    from anon, authenticated;
revoke all on notes     from anon, authenticated;

-- Deliberately NO policies. Every reviewer-facing operation goes through a server route that
-- resolves the token with the service role, which bypasses RLS. If you ever add a policy here,
-- the token must still never appear in a client-side filter.
