-- Accounts by link, and NO EMAIL IS EVER SENT (Rafi, 2026-09-03: "meko email nahi bhejna").
--
-- The flow this table exists for: the admin pastes the testers' EMAILS — no passwords, nothing to
-- hand over — and the server makes one Supabase Auth user per address with no password at all,
-- plus one row here. The admin copies the resulting block of `email → link` lines, sends it to the
-- tester head, who forwards each person their own line. Opening it is where the password is chosen.
--
-- ⚠️ THE TABLE NEVER HOLDS A WORKING LINK. `token_hash` is sha256 of the raw token; the raw token
-- exists only in the URL the admin copied. A dump of this table cannot be turned back into a way in.
--
-- ⚠️ ONE PERSON PER LINK, SINGLE USE. `user_id` is NOT NULL: there is no "anyone may sign up"
-- link, because the whole point is that the ADMIN decides which addresses exist. A link is spent
-- the moment a password is set through it.
--
-- ⚠️ REVOKING IS RE-ISSUING. There is no `revoked_at` and no Stop button: making a new link for
-- somebody marks every unused link they already have as used, so the one line the admin just
-- copied is the only one alive. A link forwarded to the wrong person is killed by pressing the
-- same button again, which is the thing an admin would do anyway.
create table if not exists review.invite_links (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id    uuid not null references review.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists invite_links_user_id_idx on review.invite_links (user_id);

alter table review.invite_links enable row level security;

-- ⚠️ NO POLICIES, ON PURPOSE. RLS on with nothing granted to `authenticated` means a signed-in
-- user — admin included — cannot read a token hash or invent a row through PostgREST. Only the
-- routes, holding the service key, touch this table.
--
-- ⚠️ AND `update` IS GRANTED EXPLICITLY, BECAUSE THE ONES YOU DON'T WRITE ARE LOAD-BEARING TOO.
-- 20260831165900 set default privileges granting select+insert on every table created in this
-- schema, so those two arrive whether or not this file names them — writing "it cannot UPDATE" in
-- a comment would describe an intention and enforce nothing (see 20260902093000, and CLAUDE.md).
-- Marking a link used is an UPDATE, so it is granted here and read back off the live project after
-- applying with has_table_privilege.
grant update on review.invite_links to service_role;

notify pgrst, 'reload schema';
