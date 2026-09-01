-- The admin view's two tables: what Radlor pays for, and what is left to do before go-live.
--
-- ⚠️ THIS IS THE FINANCIAL DATA THE BLAST-RADIUS NOTE'S SECOND TRIGGER IS ABOUT. Renewal dates and
-- monthly costs live here, in a project whose own public /api/waitlist route holds the same
-- service_role key. `scripts/check-blast-radius.mjs` probes for this table and says so.
--
-- ⚠️ AND NEVER AN API KEY. Balances, dates and amounts only. If the dashboard ever calls a provider
-- to refresh a number, the key lives in the environment and only the NUMBER it returns is stored.
-- There is deliberately no column here that could hold one.

create table if not exists review.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  tool              text not null unique check (length(btrim(tool)) between 1 and 80),
  plan              text check (plan is null or length(btrim(plan)) between 1 and 80),
  renewal_date      date,
  monthly_cost      numeric(10, 2) check (monthly_cost is null or monthly_cost >= 0),
  credits_remaining numeric(14, 2) check (credits_remaining is null or credits_remaining >= 0),
  -- ⚠️ WHERE THE NUMBER CAME FROM, AND WHEN. A stale number presented as live is worse than one
  -- labelled "you typed this on the 3rd", so the UI shows both and never implies freshness it
  -- cannot demonstrate.
  credits_source    text not null default 'manual' check (credits_source in ('manual', 'api')),
  last_updated      timestamptz not null default now(),
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create table if not exists review.todos (
  id         uuid primary key default gen_random_uuid(),
  task       text not null check (length(btrim(task)) between 1 and 300),
  -- ⚠️ `done` IS A NEW STATE THE SHEET NEVER USED. Its 23 rows are only "Not Started" and
  -- "In Progress" — nothing has ever been completed there. Adding a terminal state is a design
  -- decision, made deliberately rather than copied.
  status     text not null default 'not_started'
             check (status in ('not_started', 'in_progress', 'done')),
  -- The sheet's second tab, folded in as a field. `Marketing` was a separate tab with no status
  -- column while marketing work also sat in the main tab WITH one — the same idea recorded twice.
  area       text check (area is null or length(btrim(area)) between 1 and 40),
  -- ⚠️ EXPLICIT, BECAUSE ROW POSITION IS REAL ORDERING AND WOULD OTHERWISE BE LOST ON IMPORT.
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_order_idx on review.todos (sort_order, created_at);

alter table review.subscriptions enable row level security;
alter table review.todos enable row level security;

/**
 * ⚠️ RLS DOES THE GATING HERE, NOT THE APP. These routes read and write with the SIGNED-IN USER'S
 * token, not the service key — so the policy is what admits them. Reading with service_role would
 * work identically whether these policies were right or absent, and the app would be doing the
 * authorising while RLS sat there looking reassuring.
 *
 * No DELETE policy and no DELETE grant: the four actions the sheet earned are add, edit, mark done
 * and reorder. Nothing here can erase a line item.
 */
grant select, insert, update on review.subscriptions to authenticated;
grant select, insert, update on review.todos to authenticated;

create policy subs_admin_read   on review.subscriptions for select to authenticated using (review.is_admin());
create policy subs_admin_write  on review.subscriptions for insert to authenticated with check (review.is_admin());
create policy subs_admin_edit   on review.subscriptions for update to authenticated using (review.is_admin()) with check (review.is_admin());

create policy todos_admin_read  on review.todos for select to authenticated using (review.is_admin());
create policy todos_admin_write on review.todos for insert to authenticated with check (review.is_admin());
create policy todos_admin_edit  on review.todos for update to authenticated using (review.is_admin()) with check (review.is_admin());

-- The service role still needs its grant for the one-time sheet import, which runs as a script.
grant select, insert, update on review.subscriptions to service_role;
grant select, insert, update on review.todos to service_role;

notify pgrst, 'reload schema';
