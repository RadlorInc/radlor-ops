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
   1, 'reviewed', 'approved', 3),
  -- ⚠️ REVIEWABLE, AND NOT DANA'S. Without this the assignment filter cannot be told apart from
  -- the status filter that preceded it: every other reviewable video here is assigned to Dana, so
  -- "she gets a 404" would be explained just as well by `status`. This one is `awaiting_review`
  -- and belongs to somebody else, which makes the assignment the ONLY thing that can 404 it.
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'flood-only', 'Flood only', 'flood-only-v1.webm',
   1, 'awaiting_review', null, 4),
  -- Two reviewers who disagree. `status` is `reviewed` because both have answered; being answered
  -- and being cleared are different questions, and this row is the one that keeps them different.
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'split-cut', 'Split cut', 'split-cut-v1.webm',
   1, 'reviewed', null, 5),
  -- ⚠️ A SECOND SPLIT VIDEO, SO THE FIRST STAYS A FIXTURE. The spec that proves one reviewer
  -- cannot overwrite another has to WRITE verdicts, and a spec that mutates the row a later spec
  -- reads makes that later spec pass or fail on test order rather than on the code. Caught exactly
  -- that way: the /admin disagreement assertion went red because the overwrite spec had already
  -- cleared Dana's verdict on `split-cut`.
  ('99999999-9999-4999-8999-999999999999', 'overwrite-cut', 'Overwrite cut', 'overwrite-cut-v1.webm',
   1, 'reviewed', null, 6);

-- ⚠️ ASSIGNMENTS, AND THE MULTI-REVIEWER CASES THE TABLE EXISTS FOR. Without rows here every
-- reviewer page is empty and every /admin row reads "nobody assigned" — which is correct, and is
-- the whole change: no assignment, no video.
--
-- `hook-test-b` is the one that matters: TWO reviewers, one approved and one asking for changes.
-- A suite where every video has exactly one reviewer cannot tell the new rule from the old one —
-- "cleared when everybody approved" and "cleared when the verdict column says approved" agree on
-- every 1:1 row, so a 1:1-only fixture would pass against the code this change replaced.
insert into review.video_reviewers (video_id, reviewer_id, verdict) values
  -- Dana and the flood reviewer both, nothing decided. (The rate-limit spec posts notes here as
  -- the flood reviewer; before it was assigned, every one of those posts was a 404 — which is the
  -- assignment filter working, and is how this fixture earned its comment.)
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', null),
  -- Dana alone — the verdict spec drives this one end to end, so nothing may be pre-decided.
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', null),
  -- Approved by everyone assigned, and still carrying an open note.
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'approved'),
  -- Assigned to somebody who is not Dana. See the video row above.
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '33333333-3333-4333-8333-333333333333', null),
  -- ⚠️ THE DISAGREEMENT, AND THE ONLY FIXTURE THAT CAN TELL THE NEW RULE FROM THE OLD ONE.
  -- "cleared when every assigned reviewer approved" and "cleared when the verdict column says
  -- approved" agree on every 1:1 row, so a suite where each video has one reviewer would pass
  -- against the code this change replaced.
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'approved'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '33333333-3333-4333-8333-333333333333', 'changes_needed'),
  -- The overwrite spec's own copy of the same shape. See the video row above.
  ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'approved'),
  ('99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333', 'changes_needed');
-- `quiet-draft` is deliberately UNASSIGNED: zero assignments must not read as "everybody approved",
-- which is what `[].every()` would say.

-- A v1 note on a video that is now at v2. This is the case the `video_version` column exists for:
-- without it this line would export under the v2 heading.
insert into review.notes (video_id, reviewer_id, t_seconds, body, video_version, resolved_at) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
   7, 'good to go, but the caption needs the hashtag trimmed', 1, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
   11, 'v1: the logo lands too late', 1, now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
   4, 'v2: better, but the text is still small on a phone', 2, null),
  -- ⚠️ THE EXPORT SKIPS A VIDEO WITH NO NOTES ENTIRELY, so without this line `split-cut` has no
  -- heading and every assertion about what its heading says is unreachable — green against an
  -- export that would happily print CLEARED over the objection. Same shape as the phone spec:
  -- the assertion has to be made at a state that exists.
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111',
   9, 'the transition at the end is abrupt', 1, null);

-- Harness accounts. The stub `auth.users` rows exist so the profiles FK is real; the passwords
-- live in `test/fake-supabase.mjs`, which is the only thing that checks them.
insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555555', 'admin@harness.test'),
  ('66666666-6666-4666-8666-666666666666', 'tester@harness.test');

insert into review.profiles (user_id, role, name) values
  ('55555555-5555-4555-8555-555555555555', 'admin',  'Harness Admin'),
  ('66666666-6666-4666-8666-666666666666', 'tester', 'Harness Tester');

-- A couple of subscriptions so the renewal states have something to render. Dates are RELATIVE to
-- the day the harness starts, so the "soon" row is always soon and the spec never rots.
insert into review.subscriptions (tool, plan, renewal_date, monthly_cost, credits_remaining, credits_source, sort_order) values
  ('Higgsfield', 'Creator', current_date + 3,  29.00, 1250, 'manual', 0),
  ('Vercel',     'Pro',     current_date + 60, 20.00, null,  'manual', 1),
  ('Supabase',   'Free',    null,              0.00,  null,  'manual', 2);

-- Two to-dos, one already done, so the open/total count means something.
insert into review.todos (task, status, area, sort_order) values
  ('Design Logo', 'in_progress', null, 0),
  ('Stripe Setup', 'not_started', null, 1),
  ('organise Events', 'not_started', 'Marketing', 2),
  ('Pick a domain', 'done', null, 3);

-- Two issues so the tester list and the filters have something to act on. One belongs to the
-- harness tester, one is an imported row with no reporter — the shape the real import produced.
insert into review.issues (reporter, imported_from, description, area, type, chapter, all_chapters, age_band, status) values
  ('66666666-6666-4666-8666-666666666666', null, 'The turtles are too close together to read the numbers', 'Smallest first game', null, '1', false, '3-5', 'open'),
  (null, 'Chapter_Testing_tester2', 'Any "shall" should be changed to "should".', null, 'Titles', null, true, '3-5', 'ready_for_retest'),
  -- ⚠️ A RESOLVED ONE, so the admin dashboard's three status groups all EXIST. Without it the
  -- resolved group never rendered, and an assertion guarded by `if (group.count())` silently
  -- skipped — a conditional assertion that can vanish is the same family as one that filters on the
  -- property it is testing.
  (null, 'Chapter_Testing_tester2', 'The star award pop up says "Amazing!" twice.', 'Chapter ending star award pop up', null, '1', false, '3-5', 'resolved');
