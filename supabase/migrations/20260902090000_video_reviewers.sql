-- MORE THAN ONE PERSON CAN REVIEW ONE VIDEO. That is the change; everything below follows from it.
--
-- ⚠️ AND IT FIXES SOMETHING NOBODY DECIDED. Before this table there was no reviewer→video link at
-- all: `/r/<token>` listed EVERY video with `status in (awaiting_review, reviewed)`, and
-- `/r/<token>/<slug>` resolved a slug with no reviewer condition — so any valid token opened any
-- reviewable video, and saw its verdict. Nothing chose that. It fell out of there being one video
-- and one reviewer, and it was only ever safe because the data was thin. Recorded as finding #7 in
-- docs/security-findings.md. `video_reviewers` IS the missing condition: no assignment, no video.
--
-- ⚠️ `verdict` MOVES OFF `videos` AND ONTO THE ASSIGNMENT. On `videos` it is one field for the
-- whole video, so the second reviewer's answer overwrites the first's — with one reviewer that was
-- a latent bug, with two it is data loss on the exact signal the tool exists to carry. The clearing
-- rule that replaces it lives in `src/lib/clearance.ts`: a video is cleared to post only when EVERY
-- assigned reviewer has approved. One `changes_needed` means not cleared, however many approvals
-- sit beside it, and a later approval does not overwrite an earlier objection.
--
-- ⚠️ `videos.verdict` IS NOT DROPPED HERE, ON PURPOSE. This migration only ADDS: it creates the
-- table and copies the value across. The drop, and the revoke of `update (verdict)` that goes with
-- it, are a SEPARATE migration to be applied after the copy has been read back — same sequencing as
-- the reviewer-token column, and for the same reason: a bad backfill must not be able to take the
-- only copy of the data with it. Until then the column is stale and nothing reads or writes it.
--
-- Notes are untouched. They are already keyed `(video_id, reviewer_id, video_version)`, so no
-- reviewer has ever seen another's, and that stays true — it is what stops one reviewer anchoring
-- on another's opinion.

create table if not exists review.video_reviewers (
  video_id    uuid not null references review.videos (id)    on delete cascade,
  reviewer_id uuid not null references review.reviewers (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  -- The per-reviewer outcome. Null = they have not finished. Same two values as the old column.
  verdict     text check (verdict is null or verdict in ('approved', 'changes_needed')),
  primary key (video_id, reviewer_id)
);

-- The PK serves the admin's per-video read; the reviewer's own list starts from reviewer_id.
create index if not exists video_reviewers_reviewer_idx
  on review.video_reviewers (reviewer_id);

-- ⚠️ THE BACKFILL REFUSES TO GUESS. With one reviewer, "who gave this verdict" has one answer and
-- a cross join is exact. With two it does not, and copying one verdict onto both assignments would
-- FABRICATE AN APPROVAL by a person who never gave one — the worst thing this table could contain.
-- So it raises instead. If you are reading this because it raised: write the assignments by hand,
-- attributing each existing verdict to the reviewer who actually left the notes on that video.
do $$
declare n_reviewers int; n_videos int;
begin
  if exists (select 1 from review.video_reviewers) then return; end if;

  select count(*) into n_reviewers from review.reviewers;
  select count(*) into n_videos    from review.videos;
  if n_videos = 0 then return; end if;

  if n_reviewers <> 1 then
    raise exception
      'refusing to backfill assignments: % reviewers, % videos. A verdict on review.videos does not '
      'record WHO gave it, so this is only unambiguous with exactly one reviewer. Write the rows by '
      'hand.', n_reviewers, n_videos;
  end if;

  insert into review.video_reviewers (video_id, reviewer_id, verdict)
  select v.id, r.id, v.verdict
  from review.videos v cross join review.reviewers r;
end $$;

alter table review.video_reviewers enable row level security;

-- Same shape as everything else here: the web tier may SELECT, and may move exactly one column.
-- It cannot INSERT — assignment is a SQL statement Rafi runs, like adding a video — and it cannot
-- DELETE, so a route bug cannot unassign a reviewer and take their verdict with it.
grant select on review.video_reviewers to service_role;
grant update (verdict) on review.video_reviewers to service_role;

notify pgrst, 'reload schema';
