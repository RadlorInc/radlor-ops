-- ⚠️ THE PREVIOUS MIGRATION'S COMMENT WAS FALSE ON THE LIVE DATABASE, AND THAT IS WHY THIS FILE
-- EXISTS. It said, of `review.video_reviewers`: "It cannot INSERT — assignment is a SQL statement
-- Rafi runs". Read back after applying, `has_table_privilege('service_role', …, 'insert')` was
-- **true**.
--
-- Not because a grant was written. Because 20260831165900 set
--
--     alter default privileges in schema review grant select, insert on tables to service_role;
--
-- so EVERY table created in this schema arrives with INSERT already granted. Naming only the
-- grants I wanted described the intent and enforced nothing; the absence of a `grant insert` line
-- looked exactly like a denial and was not one. A property is what the database answers, not what
-- the migration that created it says about itself.
--
-- ⚠️ The general form, worth more than this one table: in a schema with default privileges, the
-- grants a migration DOES NOT write are as load-bearing as the ones it does — and they are
-- invisible in the diff. The offline harness cannot see this class at all (PGlite runs as one
-- superuser), so it is only ever found by reading privileges back out of the live project.
--
-- Nothing in `src/` inserts here: assignment is a statement Rafi runs, like adding a video. This
-- makes the database agree with that, so a route bug cannot invent an assignment — and a fabricated
-- assignment is a fabricated reviewer, which is the one row this table must never hold.
revoke insert on review.video_reviewers from service_role;

notify pgrst, 'reload schema';
