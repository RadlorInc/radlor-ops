-- The reviewer's JUDGEMENT, kept separate from where the video sits in the flow.
--
-- ⚠️ `status` AND `verdict` ARE NOT THE SAME AXIS AND MUST NOT BE COLLAPSED. `status` is position
-- — draft, awaiting_review, reviewed, revising. `verdict` is what the reviewer concluded — nothing
-- yet, approved, or changes needed. A video can be `reviewed` with either verdict, and "reviewed"
-- alone never told Rafi whether it was cleared to post.
alter table review.videos
  add column if not exists verdict text
  check (verdict is null or verdict in ('approved', 'changes_needed'));

-- ⚠️ STILL COLUMN-LEVEL. The web tier may move `status` and `verdict` and nothing else — not
-- `storage_path`, not `slug`, not `version`. A bug in a route handler cannot repoint a reviewer's
-- link at a different file.
grant update (status, verdict) on review.videos to service_role;

notify pgrst, 'reload schema';
