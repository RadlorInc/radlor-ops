-- Fixed ids and tokens so the E2E specs can address rows without a seeding round-trip.
-- Test data only: this file is never applied to a real project. Schema-qualified because the tool
-- lives in `review`, not `public` — see the migration.

insert into review.reviewers (id, name, email, token) values
  ('11111111-1111-4111-8111-111111111111', 'Dana Reviewer', 'dana@example.com',
   'tok_valid_9f2c4a7b1d8e3506ac91'),
  ('22222222-2222-4222-8222-222222222222', 'Gone Reviewer', 'gone@example.com',
   'tok_revoked_5b1e8c0a4d7f2396be40'),
  -- Its own reviewer so tripping the per-token limit cannot lock the other specs out.
  ('33333333-3333-4333-8333-333333333333', 'Flood Reviewer', 'flood@example.com',
   'tok_flood_7c3a9e5f2b6d418093af');

update review.reviewers set revoked_at = now() where id = '22222222-2222-4222-8222-222222222222';

insert into review.videos (id, slug, title, storage_path, version, status, verdict, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'equals-reel-final', 'Equals sign reel (final cut)',
   'equals-reel-final-v1.webm', 1, 'awaiting_review', null, 0),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'hook-test-b', 'Hook test B', 'hook-test-b-v2.webm',
   2, 'awaiting_review', null, 1),
  -- Not awaiting review: must 404 for the reviewer, must still show on /admin.
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'quiet-draft', 'Quiet draft', 'quiet-draft-v1.webm',
   1, 'draft', null, 2),
  -- Already judged, and STILL has an open note. "Approved · N open notes" is a real state and
  -- /admin must surface it rather than let it pass silently.
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cta-cut', 'CTA cut', 'cta-cut-v1.webm',
   1, 'reviewed', 'approved', 3);

-- A v1 note on a video that is now at v2. This is the case the `video_version` column exists for:
-- without it this line would export under the v2 heading.
insert into review.notes (video_id, reviewer_id, t_seconds, body, video_version, resolved_at) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
   7, 'good to go, but the caption needs the hashtag trimmed', 1, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
   11, 'v1: the logo lands too late', 1, now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
   4, 'v2: better, but the text is still small on a phone', 2, null);
