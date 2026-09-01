/**
 * REHEARSAL for 20260902110000_reviewer_accounts.sql, against the LIVE pre-state, in PGlite.
 *
 * ⚠️ The harness cannot cover this migration the normal way: `test/seed.sql` runs AFTER all
 * migrations, so by the time it inserts anything the repoint has already happened on an empty
 * database and done nothing. A data migration that is only ever run against zero rows is untested,
 * and this one rewrites the author column of every note in production.
 *
 * So this rebuilds the OLD shape — migrations up to but NOT including the repoint — inserts the
 * exact rows the live project holds (ids, bodies, timestamps, read out of it beforehand), applies
 * the repoint, and reads every row back BY ROW: same id, same body, same timestamp, same author,
 * now expressed as a user_id. Then it re-runs it to prove it is idempotent, and runs the orphan
 * case to prove the guard raises instead of dropping somebody's work.
 *
 *   node scripts/rehearse-repoint.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG = join(ROOT, 'supabase', 'migrations')
const TARGET = '20260902110000_reviewer_accounts.sql'

/** Read out of the live project on 2026-09-02, before anything was applied. */
const LIVE = {
  reviewer: { id: '9005210c-82d5-4158-af1c-2713d66444ad', name: 'Rafi', email: 'kuwari84@gmail.com' },
  user: '0c313ddb-5a67-40f4-b4ac-44fe21e9fe83',
  video: '08b71503-4e6d-4856-9088-1262ac9884e0',
  notes: [
    { id: '00afb602-4f20-40bf-8883-859125cc82aa', t: 9,  body: 'well done',       created: '2026-08-31T18:14:53.590715+00:00' },
    { id: '768b9517-0a80-40c1-8338-30df1cfe0edf', t: 13, body: 'editing problem', created: '2026-08-31T18:15:07.443397+00:00' },
    { id: 'a24f9ce3-307d-450c-8541-0d5abb10f2e3', t: 0,  body: 'thansk',          created: '2026-08-31T18:44:21.441129+00:00' },
  ],
}

async function boot() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    do $$ begin
      create role anon; exception when duplicate_object then null; end $$;
    do $$ begin
      create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin
      create role service_role; exception when duplicate_object then null; end $$;
  `)
  const files = (await readdir(MIG)).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (f === TARGET) break
    if (f.includes('bucket')) continue
    await db.exec(await readFile(join(MIG, f), 'utf8'))
  }
  return db
}

async function seedOldShape(db) {
  await db.exec(`
    insert into auth.users (id, email) values ('${LIVE.user}', '${LIVE.reviewer.email}');
    insert into review.profiles (user_id, role, name) values ('${LIVE.user}', 'admin', 'Rafi');
    insert into review.reviewers (id, name, email, token)
      values ('${LIVE.reviewer.id}', '${LIVE.reviewer.name}', '${LIVE.reviewer.email}', 'tok_rehearsal_000000000000');
    insert into review.videos (id, slug, title, storage_path, version, status, verdict, sort_order)
      values ('${LIVE.video}', 'equals-reel', 'Equals sign reel', 'equals-reel-v1.mp4', 1, 'reviewed', 'approved', 0);
    insert into review.video_reviewers (video_id, reviewer_id, verdict)
      values ('${LIVE.video}', '${LIVE.reviewer.id}', 'approved');
  `)
  for (const n of LIVE.notes) {
    await db.exec(`insert into review.notes (id, video_id, reviewer_id, t_seconds, body, video_version, created_at)
      values ('${n.id}', '${LIVE.video}', '${LIVE.reviewer.id}', ${n.t}, '${n.body}', 1, '${n.created}');`)
  }
}

const target = await readFile(join(MIG, TARGET), 'utf8')

// ── 1. the real thing ────────────────────────────────────────────────────────────────────────
{
  const db = await boot()
  await seedOldShape(db)
  await db.exec(target)

  const notes = (await db.query(
    `select id::text, reviewer_id::text as reviewer, t_seconds, body, video_version, created_at
       from review.notes order by created_at`,
  )).rows
  assert.equal(notes.length, 3, 'a note went missing')
  for (const want of LIVE.notes) {
    const got = notes.find((n) => n.id === want.id)
    assert.ok(got, `note ${want.id} disappeared`)
    assert.equal(got.body, want.body, `note ${want.id} body changed`)
    assert.equal(got.t_seconds, want.t, `note ${want.id} timestamp changed`)
    assert.equal(got.video_version, 1)
    assert.equal(new Date(got.created_at).toISOString(), new Date(want.created).toISOString(),
      `note ${want.id} created_at changed`)
    assert.equal(got.reviewer, LIVE.user, `note ${want.id} has the wrong author`)
  }

  const a = (await db.query(`select reviewer_id::text as reviewer, verdict from review.video_reviewers`)).rows
  assert.equal(a.length, 1)
  assert.equal(a[0].reviewer, LIVE.user, 'the assignment has the wrong reviewer')
  assert.equal(a[0].verdict, 'approved', 'the assignment lost its verdict')

  const bridge = (await db.query(`select user_id::text as u from review.reviewers`)).rows
  assert.equal(bridge[0].u, LIVE.user, 'the token bridge does not point at the account')
  const tok = (await db.query(`select count(*)::int as n from review.reviewers where token is not null`)).rows
  assert.equal(tok[0].n, 1, 'the token column was removed — it must survive until Rafi confirms')

  const role = (await db.query(`select count(*)::int as n from pg_constraint
    where conname='profiles_role_check' and pg_get_constraintdef(oid) like '%reviewer%'`)).rows
  assert.equal(role[0].n, 1, "'reviewer' is not an allowed role")

  console.log('✔ repoint: 3 notes and 1 assignment moved to the account, bodies/timestamps/verdict intact')
  console.log('✔ the token column and its bridge survive — the old door still opens')
}

// ── 2. run it twice ──────────────────────────────────────────────────────────────────────────
{
  const db = await boot()
  await seedOldShape(db)
  await db.exec(target)
  let second = 'ok'
  try { await db.exec(target) } catch (e) { second = e.message }
  const n = (await db.query(`select count(*)::int as n from review.notes where reviewer_id::text = '${LIVE.user}'`)).rows
  assert.equal(n[0].n, 3, 'a second run lost notes')
  console.log(`✔ second run leaves the 3 notes on the account (second run said: ${second.split('\n')[0]})`)
}

// ── 3. the guard ─────────────────────────────────────────────────────────────────────────────
{
  const db = await boot()
  await seedOldShape(db)
  // A reviewer with work and NO account. The migration must refuse rather than orphan the note.
  await db.exec(`
    insert into review.reviewers (id, name, email, token)
      values ('11111111-1111-4111-8111-111111111111', 'No Account', 'nobody@example.com', 'tok_no_account_00000000000');
    insert into review.notes (video_id, reviewer_id, t_seconds, body, video_version)
      values ('${LIVE.video}', '11111111-1111-4111-8111-111111111111', 5, 'their only note', 1);
  `)
  let raised = null
  try { await db.exec(target) } catch (e) { raised = e.message }
  assert.ok(raised && /owns notes or assignments and has no account/.test(raised),
    `expected the orphan guard to raise, got: ${raised}`)
  const still = (await db.query(`select count(*)::int as n from review.notes where body = 'their only note'`)).rows
  assert.equal(still[0].n, 1, 'the orphan note was destroyed by a migration that was supposed to refuse')
  console.log('✔ a reviewer with work and no account raises, and their note is still there')
}

console.log('\nPASS — rehearsed against the live pre-state. Safe to apply.')
