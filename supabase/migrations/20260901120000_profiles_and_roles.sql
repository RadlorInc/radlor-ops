-- Real accounts, and the first RLS in this schema that has to distinguish two kinds of person.
--
-- ⚠️ WHY NOW AND NOT LATER. Retrofitting RLS onto a populated multi-role schema is a different job
-- from doing it while there are three tables and almost no rows. The admin view is about to hold
-- subscription costs, renewal dates and spend — a forwarded link exposing a draft reel is
-- embarrassing; one exposing what Radlor spends and when its subscriptions lapse is different in
-- kind.
--
-- ⚠️ THE SCHEMA IS STILL `review`, NOT `ops`. The rename was the founder's lean and it is declined
-- for now, with the reason recorded rather than the decision hidden: `review` is served through
-- PostgREST only because it is listed in the project's API → Exposed schemas setting, which is a
-- DASHBOARD field this code cannot change. `alter schema review rename to ops` therefore 404s the
-- live reviewer tool from the instant it runs until a human edits that field — on a tool an outside
-- reviewer is using today. The zero-downtime path exists (add `ops` to Exposed schemas FIRST, then
-- rename, then drop `review` from the list) but it is three coordinated steps for a naming
-- improvement whose cost of being slightly wrong is zero. Revisit as deliberate maintenance.

create table if not exists review.profiles (
  -- One row per Supabase Auth user. Reviewers never get one: they are a token in a URL and no
  -- account, which is the whole reason an outside contractor needs no onboarding.
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'tester')),
  name       text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

alter table review.profiles enable row level security;

/**
 * ⚠️ SECURITY DEFINER IS LOAD-BEARING, NOT A CONVENIENCE. A policy on `profiles` that reads
 * `profiles` to decide who you are recurses forever — Postgres raises 42P17 and every query on the
 * table fails. Running the lookup as the function owner steps outside RLS for that one read.
 * `search_path` is pinned so the function cannot be redirected by a caller's search_path.
 */
create or replace function review.is_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = review, pg_temp
as $$
  select exists (
    select 1 from review.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
$$;

revoke all on function review.is_admin() from public;
grant execute on function review.is_admin() to authenticated;

-- ⚠️ EVERY SIGNED-IN USER IS THE SAME POSTGRES ROLE (`authenticated`). Grants cannot tell an admin
-- from a tester — the app-level role lives in a column, not in a database role — so RLS is the ONLY
-- mechanism that can, and the denial it produces is "zero rows", not `42501`. See
-- scripts/check-tester-cannot-read-admin.mjs, which asserts that shape rather than a SQLSTATE that
-- this design cannot ever emit.
grant select on review.profiles to authenticated;
grant select, insert on review.profiles to service_role;

-- You can always see yourself. An admin can see everyone.
create policy profiles_read_own on review.profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy profiles_read_all_if_admin on review.profiles
  for select to authenticated
  using (review.is_admin());

-- No INSERT/UPDATE/DELETE policies at all: accounts are created by a human in the Supabase
-- dashboard and their profile row is written with the service role. Nothing signed in can grant
-- itself a role, which is the one write that would matter.

notify pgrst, 'reload schema';
