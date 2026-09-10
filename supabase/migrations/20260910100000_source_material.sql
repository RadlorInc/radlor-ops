-- SOURCE MATERIAL: the stuff a cut is MADE from, as opposed to the cuts themselves.
--
-- Rafi, 2026-09-10: a tab where the admin uploads the material related to making content — "woh
-- kuch bhi ho sakhta hai video, link, pdf kuch bhi". So the table refuses to care what it is: one
-- row is either a LINK (a URL somebody found) or a FILE (bytes in a bucket), and nothing here
-- inspects or whitelists the format. `review.videos` is the opposite — four extensions, because a
-- reviewer has to be able to play it in a browser. Nobody has to play this.
--
-- ⚠️ IT IS NOT `review.videos` WITH A FLAG. A video in that table is a cut with a version, a
-- status, assigned reviewers, notes and a clearing rule; a source item has none of those and never
-- will. Sharing the table would mean every reviewer query growing a "and not material" clause,
-- which is the condition that gets forgotten once and shows an unreleased brand deck to an outside
-- reviewer.
--
-- ⚠️ THE BUCKET IS IN ITS OWN MIGRATION FILE ON PURPOSE (20260910100100). The offline harness
-- SKIPS ANY MIGRATION MENTIONING THE OBJECT-STORE SCHEMA, because PGlite has no such schema — so
-- one line about a bucket in this file would silently take the whole table with it and every
-- offline test would fail on a missing relation. Same split as 20260831165802 / 20260831165817.
--
-- ⚠️ AND FOR THE SAME REASON THIS FILE MUST NOT NAME THAT SCHEMA EVEN IN A COMMENT. The harness
-- matches on the text, not on the parse.

create table if not exists review.material (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 200),
  -- Exactly two shapes, enforced here rather than by convention in a route.
  kind         text not null check (kind in ('link', 'file')),
  -- A link's destination. Never a path; never signed; opened as-is by whoever clicks it.
  url          text check (url is null or length(url) between 4 and 2000),
  -- A file's object name in the private bucket. `[a-z0-9.-]` only — an object whose name stepped
  -- outside that set once wrote an 82 KB row and was afterwards unreachable through every read
  -- path there is (docs/security-findings.md #4). The route derives it; the client never sends it.
  storage_path text check (storage_path is null or storage_path ~ '^[a-z0-9][a-z0-9.-]{0,199}$'),
  -- The name the file arrived with, kept only so the list can say what it is. Display, never a path.
  filename     text check (filename is null or length(filename) between 1 and 260),
  /**
   * ⚠️ FALSE UNTIL THE BYTES HAVE BEEN READ BACK, and that is the whole reason this column exists.
   * A write to this project's object store has returned success for an object that could not
   * afterwards be read, listed, signed OR deleted (finding #4). The row is written before the
   * upload so a half-finished attempt leaves something the admin can see and remove; `ready` is
   * what stops it being offered as if it were there. A link is ready the moment it is saved —
   * there is nothing to verify.
   */
  ready        boolean not null default false,
  -- ⚠️ `set null`, NOT `cascade`. Removing somebody must not take the library down with them: the
  -- material outlives whoever happened to paste it in. Contrast `notes.reviewer_id`, which DOES
  -- cascade, because a note with no author is not feedback, it is an anonymous accusation.
  added_by     uuid references review.profiles (user_id) on delete set null,
  created_at   timestamptz not null default now(),
  -- One shape or the other, never both, never neither. Without this a row can be a link with no
  -- destination and a file with no bytes at the same time, and every reader has to guess.
  constraint material_is_one_thing check (
    (kind = 'link' and url is not null and storage_path is null) or
    (kind = 'file' and storage_path is not null and url is null)
  )
);

create index if not exists material_created_idx on review.material (created_at desc);

alter table review.material enable row level security;
-- No policies, like every other table here: only `service_role` reaches it, and every read is done
-- server-side behind `requireRole('admin')`.

-- ⚠️ `select` AND `insert` ARRIVE ALREADY GRANTED by the default privileges 20260831165900 set on
-- this schema, so writing them changes nothing — they are written anyway because the grants a
-- migration does NOT write are invisible in the diff and read exactly like a denial (2026-09-02).
-- The two below are the ones that genuinely do not exist by default:
grant select, insert on review.material to service_role;
-- Column-level: the web tier may flip `ready` after it has read the bytes back, and may never
-- rewrite `url`, `storage_path` or `title` — so no bug in any route can repoint an item at a
-- different object or a different destination after somebody has looked at it.
grant update (ready) on review.material to service_role;
-- A wrong upload has to be removable without opening Supabase, which is the whole point of the tab.
grant delete on review.material to service_role;

notify pgrst, 'reload schema';
