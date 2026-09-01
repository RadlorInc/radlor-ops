-- The token door is closed. This drops the credential itself.
--
-- ⚠️ ORDER, AND IT IS THE OPPOSITE OF THE LAST ONE. `20260902110000` was applied before its code
-- was pushed, on the rule that the database goes first — and it repointed a column the running
-- build read, so the reviewer page 404'd for the length of the deploy (finding #9). This migration
-- REMOVES a column the running build reads. Same class, so:
--
--     THE CODE THAT STOPS READING `reviewers.token` SHIPS FIRST, IS CONFIRMED DEPLOYED, AND ONLY
--     THEN IS THIS APPLIED.
--
-- Applied in the other order, every reviewer page 500s the moment PostgREST stops returning the
-- column. The dependency goes in before the thing that needs it; here the dependency is the deploy.
--
-- ⚠️ AND IT IS ONLY SAFE BECAUSE A HUMAN CONFIRMED THE NEW DOOR. Rafi signed in at /review on
-- 2026-09-02 and said it worked. Until that sentence existed this was a lockout waiting to happen:
-- there is no SMTP on this project, so a reviewer who cannot get in has no self-serve way back.
alter table review.reviewers drop column if exists token;

-- ⚠️ `review.reviewers` IS NOW VESTIGIAL AND IS DELIBERATELY NOT DROPPED HERE. Nothing in `src/`
-- reads it — reviewer names come from `review.profiles`, and both foreign keys moved there. It is
-- left standing for one release with `name`, `email` and `user_id` still in it, because a table
-- nobody reads costs nothing and a table nobody can get back costs whatever was in it. Dropping it
-- is one line, on its own, once nobody has wanted the old rows for a while.

notify pgrst, 'reload schema';
