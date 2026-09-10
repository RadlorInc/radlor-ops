-- TWO CHANGES TO `profiles`, AND THEY PULL IN OPPOSITE DIRECTIONS ON PURPOSE.
--
-- Rafi, 2026-09-10: only he should be able to remove a person, and there should be a way to change
-- somebody's role.
--
-- ── 1. `is_owner` — and NOTHING may write it ────────────────────────────────────────────────────
--
-- ⚠️ NO GRANT IS WRITTEN FOR THIS COLUMN, AND THAT ABSENCE IS THE FEATURE. Default privileges in
-- this schema hand out `select, insert` on new TABLES; they say nothing about UPDATE on a new
-- COLUMN, so with no `grant update (is_owner)` the web tier is refused with 42501 no matter what
-- any route asks for. Ownership is therefore not something this application can hand to anybody,
-- including to itself — it is one statement a human runs against the database.
--
-- ⚠️ AND THE REPO DOES NOT SAY WHO THE OWNER IS. No backfill, no email, no uuid in this file:
-- `RadlorInc/radlor-ops` is public, and who holds the destructive button in somebody's tool is
-- environment data, not source. The default is `false`, so a database this migration has just run
-- against has NO owner and the delete control does not exist for anybody — which is the correct
-- way for this to fail. Set it with one statement, per environment:
--
--     update review.profiles set is_owner = true where user_id = '<the founder>';
--
-- ── 2. `update (role)` — a privilege that was deliberately withheld until today ─────────────────
--
-- ⚠️ THIS REVERSES A STATED PROPERTY, SO IT SAYS SO OUT LOUD. 20260901120000 shipped with
-- "No INSERT/UPDATE/DELETE policies at all … Nothing signed in can grant itself a role, which is
-- the one write that would matter", and scripts/check-grants.mjs has asserted that refusal ever
-- since. It is being given up knowingly, because a tool where fixing "I picked Tester by mistake"
-- means opening Supabase is a tool whose People tab is decorative.
--
-- What is NOT given up, and what carries the weight instead:
--   • `name` and `is_owner` stay un-updatable — the grant below names one column.
--   • `/api/admin/people` refuses to change YOUR OWN role, the OWNER's role, and any change that
--     would leave the project with zero admins. That last one is the disaster this reverses into:
--     three clicks and /admin is unreachable to every account that exists, with no recovery inside
--     the product.
--   • check-grants.mjs flips this row from `refused` to `allowed` in the same commit. A checker
--     left asserting the old answer would go red on a correct build, and be edited in a hurry by
--     somebody who did not read this.
alter table review.profiles
  add column if not exists is_owner boolean not null default false;

grant update (role) on review.profiles to service_role;

notify pgrst, 'reload schema';
