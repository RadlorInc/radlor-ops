-- ⚠️ THIS RE-OPENS SOMETHING 20260902093000 DELIBERATELY CLOSED, AND THE PREMISE IS WHAT CHANGED.
--
-- That migration revoked INSERT on `review.video_reviewers` and gave its reason plainly: "Nothing
-- in `src/` inserts here: assignment is a statement Rafi runs, like adding a video." That was true
-- when it was written and it is not true now — the Marketing material tab uploads a cut and ticks
-- who should review it, and that is an INSERT into this table from a route.
--
-- The revoke was not wrong. It has just stopped describing the system, and a privilege kept for a
-- reason that has expired is how the next person concludes the database is arbitrary. The cost was
-- real: the upload form answered 500 in production on its first use, with
-- `42501 permission denied for table video_reviewers`, and every one of the 68 offline tests was
-- green — PGlite runs as one superuser, so this class is invisible to it by construction.
--
-- ⚠️ COLUMN-LEVEL, WHICH KEEPS MOST OF WHAT THE REVOKE WAS PROTECTING. Its real fear was not the
-- assignment row; it was that "a fabricated assignment is a fabricated reviewer". The half that
-- makes a fabricated assignment dangerous is a VERDICT arriving with it — a row that claims
-- somebody has already approved something. Granting only `(video_id, reviewer_id)` means the web
-- tier can ask a person to review a cut and can never, through any bug in any route, write what
-- they concluded. `verdict` is nullable with no default, so it lands as NULL: "not finished".
--
-- Writing a verdict stays exactly where it was: `update (verdict)` from 20260902090000, reached
-- only through /api/review-done, filtered to one reviewer's own row.
grant insert (video_id, reviewer_id) on review.video_reviewers to service_role;

notify pgrst, 'reload schema';
