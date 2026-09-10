-- SOURCE MATERIAL IS DIVIDED IN TWO: science and maths. Rafi, 2026-09-10.
--
-- ⚠️ `not null` WITH NO DEFAULT, AND THE MISSING DEFAULT IS THE POINT. A default of `'science'`
-- would make a route that forgot to send the column succeed quietly and file everything under one
-- subject — a wrong answer that looks exactly like a right one, discovered weeks later by somebody
-- wondering why maths is empty. With no default the same bug is `23502 null value in column
-- "subject"`, on the first attempt, in front of the person who introduced it.
--
-- Safe as a straight `not null` because the table holds ZERO rows: it was created this afternoon
-- and nothing has been uploaded yet, which was checked before this was written rather than assumed.
-- ⚠️ If you are reading this while porting the change to a database that DOES have rows, this
-- statement will fail — and it should. Decide what those rows are, backfill them by hand, and only
-- then add the constraint. Do not reach for a default to make the error go away.
--
-- ⚠️ NO `grant update (subject)`, so an item's subject is fixed when it is created — the same rule
-- as `url` and `storage_path` next to it, where the reason is that nothing may repoint an item
-- somebody has already opened. Here the reason is weaker and worth naming honestly: it simply was
-- not asked for. The cost is that a mis-filed LINK is re-added in ten seconds and a mis-filed FILE
-- has to be uploaded again. If that starts happening, the fix is this grant plus a control on the
-- row, not a general update grant on the table.
alter table review.material
  add column subject text not null
    check (subject in ('science', 'maths'));

-- The list is read one subject at a time, newest first, which is the same shape as the index that
-- is already there for the ungrouped read.
create index if not exists material_subject_created_idx
  on review.material (subject, created_at desc);

notify pgrst, 'reload schema';
