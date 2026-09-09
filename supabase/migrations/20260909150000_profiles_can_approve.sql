-- WHO MAY APPROVE OR REJECT IS A PROPERTY OF THE PERSON, SET BY THE ADMIN. Rafi, 2026-09-09:
-- "when you give someone access as a reviewer there should be a way to make any reviewer the
-- person who can approve or reject; otherwise the reviewer only gives feedback."
--
-- ⚠️ ONE COLUMN, NOT A FOURTH ROLE. `profiles.role` still gates the SURFACE (an approver is a
-- reviewer who can open /review, nothing more); this flag decides who the upload route names on a
-- new cut's `video_reviewers` row — and that row is still what /api/review-done checks. So:
--   • the flag says who gets ASKED on cuts uploaded from now on;
--   • the row says who may ANSWER on a cut already out.
-- Moving the flag from A to B does not take A's in-flight cuts away and does not hand them to B;
-- there is no reassignment in this tool, and inventing one here would be a second feature.
--
-- ⚠️ ANY NUMBER OF PEOPLE MAY HOLD IT. (This comment said "exactly one, enforced by the route" when
-- the migration was applied on 2026-09-09; Rafi lifted that the same evening — "we can create
-- multiple" — and the route stopped clearing other holders. The SQL below never enforced one, so
-- nothing about the database changed.) Every holder is named on each new cut, and `clearance()`
-- clears it only when all of them have approved.
--
-- ⚠️ THE GRANT IS COLUMN-LEVEL AND EXPLICIT. Default privileges in this schema hand `service_role`
-- select+insert on every new table and nothing on new columns' UPDATE; without the line below the
-- People button would answer 42501 in production and the offline suite would stay green — the
-- exact class scripts/check-grants.mjs exists for. `role` and `name` stay un-updatable from the
-- web tier: nothing signed in can promote itself to admin, which is the write that would matter.
--
-- ⚠️ BACKFILL: whoever already holds an assignment becomes the approver, because on 2026-09-09
-- every assignment row IS an approver (there is one per cut, and the person on it decides). On the
-- live project that is one person on two cuts. If it were two different people the route's
-- one-holder rule would be violated from the start, so it raises rather than picking one.
--
-- ⚠️ ORDER: APPLY THIS BEFORE THE BUILD THAT READS IT. Additive with a default, so the running
-- build ignores it; the next build selects the column and 400s from PostgREST until it exists.
-- The opposite of finding #9's sequencing, for the reason that file gives: the dependency goes in
-- first, and this time the column is the dependency.

alter table review.profiles
  add column if not exists can_approve boolean not null default false;

grant update (can_approve) on review.profiles to service_role;

do $$
declare n int;
begin
  select count(distinct reviewer_id) into n from review.video_reviewers;
  if n > 1 then
    raise exception
      'refusing to backfill can_approve: % different people hold assignments, and the tool allows '
      'one approver. Set the flag by hand for the one who should keep it.', n;
  end if;
  update review.profiles p
     set can_approve = true
   where exists (select 1 from review.video_reviewers a where a.reviewer_id = p.user_id);
end $$;

notify pgrst, 'reload schema';
