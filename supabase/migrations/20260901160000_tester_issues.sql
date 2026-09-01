-- The tester interface: what `Chapter_Testing_tester2` was, with the columns doing one job each.
--
-- The sheet audit is the design input. What it found, and what changed as a result:
--
--   `Issue Category`  did TWO jobs — mostly a LOCATION (`Nest game`, `Shape House`) and sometimes a
--                     TYPE (`Wording`, `Titles`) — so it could be filtered on neither. Split into
--                     `area` and `type`, both optional.
--   `Chapter`         held three kinds of value: a number (`1`), a name (`Measurement`) and a scope
--                     word (`All`). `All` is not a chapter, so it is a boolean flag; the other two
--                     are a reference the tester picks rather than free text.
--   `Date`            was typed by hand in two different formats, with one row missing it entirely.
--                     Nobody should type a date: `created_at` is set on submit.
--   `Working Record`  (Testing Date, testing Hours) was COMPLETELY EMPTY since the sheet was made.
--                     That is not demand for the column, it is friction: logging hours means
--                     remembering to open a second tab afterwards. Captured automatically instead —
--                     see `review.testing_sessions`.
--   `Age Group`       was 3-5 twelve times and `Any` once. Kept, constrained to the real bands.
--   `Status`          kept as-is, INCLUDING `Ready for Retest`, which is a real state and was the
--                     most-used one (8 of 13).
--
-- One tester had 13 rows and another had zero. That is a fact about friction, not about demand, so
-- this assumes several testers from the start.

create table if not exists review.issues (
  id            uuid primary key default gen_random_uuid(),
  -- Null for the 13 rows imported from the sheet: they predate accounts, and inventing a user to
  -- attribute them to would be inventing data. `imported_from` records where they came from.
  reporter      uuid references review.profiles (user_id) on delete set null,
  imported_from text,

  description   text not null check (length(btrim(description)) between 1 and 4000),

  -- Both optional, and separate, so either can be filtered on.
  area          text check (area is null or length(btrim(area)) between 1 and 60),
  type          text check (type is null or length(btrim(type)) between 1 and 40),

  chapter       text check (chapter is null or length(btrim(chapter)) between 1 and 40),
  -- ⚠️ `All` WAS A VALUE IN THE CHAPTER COLUMN AND IS NOT A CHAPTER. It is a scope, so it is a
  -- flag; the constraint stops a row claiming to be both one chapter and all of them.
  all_chapters  boolean not null default false,
  constraint issues_chapter_scope check (not (all_chapters and chapter is not null)),

  age_band      text check (age_band is null or age_band in ('3-5','6-8','9-11','12-14','15-16','17-18','any')),

  status        text not null default 'open'
                check (status in ('open', 'ready_for_retest', 'resolved')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists issues_reporter_idx on review.issues (reporter, created_at desc);
create index if not exists issues_status_idx on review.issues (status, created_at desc);

/**
 * The `Working Record` tab, captured instead of typed.
 *
 * ⚠️ NOBODY OPENS A SECOND TAB TO LOG HOURS — that tab held zero rows from the day it was created.
 * A session is opened by the act of filing an issue and extended by the next one; a gap longer than
 * the window starts a new one. It is an approximation of "time spent testing" and it is honest
 * about that, which beats a column nobody fills in.
 */
create table if not exists review.testing_sessions (
  id          uuid primary key default gen_random_uuid(),
  tester      uuid not null references review.profiles (user_id) on delete cascade,
  started_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  issue_count int not null default 0
);

create index if not exists sessions_tester_idx on review.testing_sessions (tester, last_seen_at desc);

alter table review.issues enable row level security;
alter table review.testing_sessions enable row level security;

grant select, insert, update on review.issues to authenticated;
grant select, insert, update on review.testing_sessions to authenticated;
grant select, insert, update on review.issues to service_role;
grant select, insert, update on review.testing_sessions to service_role;

/**
 * ⚠️ A TESTER SEES THEIR OWN ISSUES, NOT EVERYONE'S — the same rule as a reviewer and their notes,
 * and the shape the sheets already had (one file per tester). An admin sees all of them, because
 * triaging is the whole point of the admin view.
 */
create policy issues_read_own on review.issues
  for select to authenticated using (reporter = auth.uid() or review.is_admin());

create policy issues_insert_own on review.issues
  for insert to authenticated with check (reporter = auth.uid());

-- Only an admin moves an issue's status. A tester filing "it's fixed" about their own report is
-- how a retest queue stops meaning anything.
create policy issues_admin_update on review.issues
  for update to authenticated using (review.is_admin()) with check (review.is_admin());

create policy sessions_own on review.testing_sessions
  for select to authenticated using (tester = auth.uid() or review.is_admin());
create policy sessions_insert_own on review.testing_sessions
  for insert to authenticated with check (tester = auth.uid());
create policy sessions_update_own on review.testing_sessions
  for update to authenticated using (tester = auth.uid()) with check (tester = auth.uid());

notify pgrst, 'reload schema';
