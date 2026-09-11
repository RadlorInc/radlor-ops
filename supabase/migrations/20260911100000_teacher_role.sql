-- A FOURTH ROLE: `teacher`, and it opens exactly one thing — Source material. Rafi, 2026-09-11.
--
-- ⚠️ A ROLE, NOT A FLAG, AND THAT CHOICE IS THE OPPOSITE OF `can_approve` ON PURPOSE. An approver is
-- a reviewer with one extra power on a surface they already have, so it is a column on top of a
-- role. A teacher has a DIFFERENT SURFACE — they do not see cuts, reviews, to-dos or people at all —
-- and the thing in this schema that decides which surface you get is `role`. Roles gate the
-- surface; flags decide what you can do on it. (session.ts says the same thing about assignments.)
--
-- ⚠️ ADDING A ROLE IS WHERE NEGATIVE CHECKS COME TO COLLECT. The approver rules were written as
-- "not a tester", which is true of three roles and silently true of a fourth: a teacher would have
-- been offered *Make approver*, asked for verdicts, and 404'd on the page to give them. They are
-- rewritten in the same commit as POSITIVE lists — reviewer or admin — so the next role added is
-- refused by default instead of admitted by accident. Same for the login page, whose own copy of
-- the routing sent any role it did not recognise to /tester.
--
-- Nothing else here changes. No grant: a teacher reads and writes source material through
-- /api/material with the service key, behind `requireRoleApi('teacher', 'admin')`, exactly as an
-- admin already did. The one row a teacher reads AS THEMSELVES is their own profile, and
-- `profiles_read_own` already covers every authenticated user.
alter table review.profiles drop constraint profiles_role_check;
alter table review.profiles add constraint profiles_role_check
  check (role in ('admin', 'tester', 'reviewer', 'teacher'));

notify pgrst, 'reload schema';
