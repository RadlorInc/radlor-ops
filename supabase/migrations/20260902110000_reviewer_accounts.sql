-- Reviewers become ACCOUNTS. `notes.reviewer_id` and `video_reviewers.reviewer_id` stop pointing at
-- `review.reviewers` and point at `review.profiles (user_id)` — the same identity every other
-- person in this tool already has.
--
-- ⚠️ THE TOKEN PATH IS NOT REMOVED HERE, AND MUST NOT BE. `reviewers.token` stays, and
-- `/r/<token>` keeps working, until Rafi has signed in as a reviewer and SAID it worked. Same
-- sequencing as the `?k=<ADMIN_TOKEN>` gate: build the new way in, confirm a human can use it,
-- THEN remove the old one. Deleting the only working door before anyone has opened the new one is
-- how you lock yourself out of your own tool, and there is no second channel to recover through.
-- `reviewers.user_id` is the bridge that lets both doors lead to the same person.
--
-- ⚠️ ONE PERSON CAN BE BOTH, AND THIS IS THE QUESTION SOMEONE WILL ASK. `review.reviewers` holds
-- exactly one row today: Rafi, kuwari84@gmail.com — which is ALREADY the admin account.
-- `profiles.role` holds ONE value, and it stays that way; no roles array is being added for a
-- single overlapping person. Instead:
--
--     ROLES GATE THE SURFACE. ASSIGNMENTS DECIDE WHAT IS ON IT.
--
-- `admin` is a superset of `reviewer` — the same way an admin can already open `/tester` — so an
-- admin may open the reviewer surface and sees exactly the videos ASSIGNED TO THEM. Rafi appears
-- as a reviewer on `equals-reel` because a `video_reviewers` row says so, not because of anything
-- in his role. An admin with no assignments opens the reviewer surface and sees an empty list,
-- which is correct and not a bug.
--
-- ⚠️ AND THAT IS WHY THE REPOINT IS SAFE FOR HIM SPECIFICALLY: his three notes and his one
-- assignment move onto the user_id he already signs in with, so the same human keeps the same
-- history under one identity instead of two.

alter table review.profiles drop constraint profiles_role_check;
alter table review.profiles add  constraint profiles_role_check
  check (role in ('admin', 'tester', 'reviewer'));

-- The bridge column. Nullable, because a reviewer row may exist before its account does — but see
-- the guard: it may not be null for anyone who OWNS anything.
alter table review.reviewers
  add column if not exists user_id uuid references review.profiles (user_id) on delete restrict;

do $$
declare
  n_notes_before  int;
  n_assign_before int;
  n_notes_after   int;
  n_assign_after  int;
  orphan          record;
begin
  select count(*) into n_notes_before  from review.notes;
  select count(*) into n_assign_before from review.video_reviewers;

  -- Match on email, normalised. Only where the auth user ALREADY has a profile row: pointing a
  -- note at a user_id with no profile would satisfy the FK and still be a note by nobody.
  update review.reviewers r
     set user_id = p.user_id
    from review.profiles p
    join auth.users u on u.id = p.user_id
   where lower(btrim(u.email)) = lower(btrim(r.email))
     and r.user_id is null;

  -- ⚠️ REFUSES TO ORPHAN ANYTHING. A reviewer who owns a note or an assignment and has no account
  -- cannot be repointed, and the alternative — dropping their rows, or pointing them at somebody
  -- else — is losing a real person's work quietly. Raise instead, and create the account first.
  for orphan in
    select r.id, r.email
      from review.reviewers r
     where r.user_id is null
       and (exists (select 1 from review.notes n           where n.reviewer_id = r.id)
         or exists (select 1 from review.video_reviewers a where a.reviewer_id = r.id))
  loop
    raise exception
      'reviewer % (%) owns notes or assignments and has no account to move them to. Create the '
      'Supabase Auth user and its review.profiles row first, then re-run. Nothing has been '
      'changed.', orphan.id, orphan.email;
  end loop;

  -- Repoint. The FKs are dropped and re-added around it because the values change table.
  alter table review.notes           drop constraint notes_reviewer_id_fkey;
  alter table review.video_reviewers drop constraint video_reviewers_reviewer_id_fkey;

  update review.notes n
     set reviewer_id = r.user_id
    from review.reviewers r
   where r.id = n.reviewer_id;

  update review.video_reviewers a
     set reviewer_id = r.user_id
    from review.reviewers r
   where r.id = a.reviewer_id;

  -- ⚠️ ASSERTED, NOT ASSUMED. An UPDATE ... FROM that matches nothing changes nothing and reports
  -- success, so "the migration ran" is not evidence a single row moved. Both counts must be
  -- unchanged and nothing may be left pointing at a reviewers.id.
  select count(*) into n_notes_after  from review.notes;
  select count(*) into n_assign_after from review.video_reviewers;
  if n_notes_after <> n_notes_before or n_assign_after <> n_assign_before then
    raise exception 'row count moved during repoint: notes %→%, assignments %→%',
      n_notes_before, n_notes_after, n_assign_before, n_assign_after;
  end if;

  if exists (select 1 from review.notes n
              where not exists (select 1 from review.profiles p where p.user_id = n.reviewer_id))
  then raise exception 'a note is not pointing at a profile after the repoint'; end if;

  if exists (select 1 from review.video_reviewers a
              where not exists (select 1 from review.profiles p where p.user_id = a.reviewer_id))
  then raise exception 'an assignment is not pointing at a profile after the repoint'; end if;

  alter table review.notes
    add constraint notes_reviewer_id_fkey
    foreign key (reviewer_id) references review.profiles (user_id) on delete cascade;
  alter table review.video_reviewers
    add constraint video_reviewers_reviewer_id_fkey
    foreign key (reviewer_id) references review.profiles (user_id) on delete cascade;
end $$;

-- The reviewer surface reads through the service key and is gated by `requireRole` in the page,
-- exactly as /admin's video and note reads already are. ⚠️ Stated plainly rather than implied:
-- authorization for the reviewer surface is APPLICATION-LEVEL — the role gate plus the assignment
-- filter in src/lib/db.ts — not RLS. `profiles` is the only table in this schema a signed-in user
-- reads as themselves. Writing reviewer policies is a separate, larger job; claiming it here would
-- be worse than not having it.
grant select on review.profiles to authenticated;

notify pgrst, 'reload schema';
