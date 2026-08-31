-- ⚠️ WITHOUT THIS THE APP IS COMPLETELY DEAD, AND NOTHING OFFLINE COULD HAVE TOLD US.
--
-- Supabase's default privileges grant anon/authenticated/service_role on tables created in
-- `public` and `storage`. They do NOT extend to a NEW CUSTOM SCHEMA. So `review`'s tables were
-- created with the plain Postgres default — owner only — and `service_role` held no privilege on
-- them at all. `service_role` has BYPASSRLS, but bypassing RLS is not the same as holding the
-- GRANT: Postgres checks the grant first, so every route would have returned
-- `42501 permission denied for table videos`.
--
-- Measured before applying, not inferred:
--   has_table_privilege('service_role','review.videos','SELECT') → false
-- and after:
--   → true
--
-- ⚠️ THE OFFLINE HARNESS COULD NEVER HAVE CAUGHT THIS. PGlite runs everything as one superuser
-- with no role switching, so grants are invisible to it by construction. `test/fake-supabase.mjs`
-- proves this app's logic; it cannot prove the platform's permissions. This is what verifying
-- against the real project is for, and it is the second time that distinction has paid.

-- SELECT and INSERT only, deliberately: exactly what the server routes do — read videos, reviewers
-- and notes, and append notes. UPDATE and DELETE (bumping a version, resolving a note, revoking a
-- token) happen in the SQL editor as `postgres` and are unaffected. So even holding the
-- service_role key, the web tier cannot alter or delete a note the reviewer has written.
-- ⚠️ This does NOT shrink the blast radius — service_role still holds full default privileges on
-- `public`, including `waitlist`. See SETUP.md → Blast radius. It only stops this tool destroying
-- its own record.
grant select, insert on all tables in schema review to service_role;

-- Same for anything added to this schema later, or the next table arrives silently unreadable and
-- the failure looks like a broken deploy rather than a missing grant.
alter default privileges in schema review grant select, insert on tables to service_role;

notify pgrst, 'reload schema';
