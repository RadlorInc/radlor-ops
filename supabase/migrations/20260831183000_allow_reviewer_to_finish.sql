-- Lets the reviewer mark a video finished from their own page.
--
-- ⚠️ COLUMN-LEVEL, NOT TABLE-LEVEL. `grant update on review.videos` would let the web tier rewrite
-- `storage_path`, `version` and `slug` — i.e. point a reviewer's link at a different file. The
-- reviewer only needs to move `status`, so that is the only column granted. Everything else in the
-- table stays read-only to the route handlers, and the four legal values are still enforced by the
-- CHECK constraint, not by the application.
--
-- Kept in step with 20260831165900: the web tier can SELECT, INSERT, and now UPDATE exactly one
-- column. It still cannot DELETE anything, so a reviewer's notes remain un-erasable from the web.
grant update (status) on review.videos to service_role;

notify pgrst, 'reload schema';
