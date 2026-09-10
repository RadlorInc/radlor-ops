#!/usr/bin/env node
/**
 * WHAT `service_role` CAN ACTUALLY DO, ASKED THROUGH THE DOOR THE APP USES.
 *
 *   node --env-file=.env.local scripts/check-grants.mjs
 *
 * ⚠️ THIS CLASS HAS COST TWICE, IN OPPOSITE DIRECTIONS, AND BOTH TIMES THE SUITE WAS GREEN.
 *
 *   • 2026-08-31 — no GRANTs at all. 19/19 offline, while every route would have answered
 *     `42501 permission denied`.
 *   • 2026-09-09 — the upload form 500'd in production on its FIRST use: `insert` on
 *     `video_reviewers` had been revoked, deliberately, back when nothing in `src/` inserted
 *     there. 68/68 offline.
 *
 * Neither is a gap in coverage; both are invisible to `npm run test:e2e` BY CONSTRUCTION. PGlite
 * runs as one superuser with no role switching, so a grant is not something it can have an opinion
 * about. The only place this is answerable is the real project.
 *
 * ⚠️ IT ASKS BEHAVIOURALLY — REAL REQUESTS, REAL VERBS — RATHER THAN READING `has_table_privilege`.
 * Not a stylistic choice: PostgREST cannot run that function without an RPC installed for it, and
 * an RPC added so a checker can pass is a new thing to trust. Sending the request the app sends and
 * reading the status back needs nothing to exist and cannot disagree with production, which is the
 * same reason `check-signed-url-expiry.mjs` uploads a real object rather than reasoning about TTLs.
 *
 * ⚠️ AND THE FALSES ARE ASSERTED AS LOUDLY AS THE TRUES. A checker that only confirmed the
 * privileges we want would pass on a database where the web tier can delete every tester's issue —
 * and the 2026-09-02 finding was exactly that an absent grant looks like a denial and is not one.
 * An unexpected 2xx fails this run.
 *
 * ⚠️ IT WRITES, AND IT CLEANS UP AFTER ITSELF. One throwaway video row, deleted at the end in a
 * `finally`. Everything else is probed against that row, so nothing real is touched. If this script
 * is interrupted, look for a `zz-grant-check` video and delete it.
 */

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — run with `node --env-file=.env.local`')
  process.exit(2)
}

const H = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Accept-Profile': 'review',
  'Content-Profile': 'review',
}

/* ⚠️ THE BODY IS KEPT WHOLE AND TRUNCATED ONLY WHEN PRINTED. The first version sliced it to 200
 * characters here, which cut the insert's JSON response mid-string — `JSON.parse` threw, the run
 * died before the cleanup could learn the row's id, and it left a video behind in the project the
 * marketing site shares. Truncate at the edge you are printing to, never at the one you are still
 * reading from. */
async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, cache: 'no-store', headers: { ...H, ...init.headers } })
  return { status: res.status, body: await res.text() }
}

const SLUG = 'zz-grant-check'
let failures = 0
let videoId = null

/** `want` is 'allowed' or 'refused'. Anything else — a 500, a constraint error — is neither, and is
 *  reported as its own failure rather than being counted as a refusal. */
function judge(what, want, { status, body }) {
  const allowed = status >= 200 && status < 300
  const refused = status === 401 || status === 403
  const got = allowed ? 'allowed' : refused ? 'refused' : `neither (${status})`
  const ok = got === want
  if (!ok) failures += 1
  const mark = ok ? '✔' : '✗'
  console.log(`${mark} ${what.padEnd(52)} want ${want.padEnd(8)} got ${got}${ok ? '' : `  ${body.slice(0, 200)}`}`)
}

try {
  console.log('Probing as service_role, through PostgREST, against the live project.\n')

  /* ⚠️ CLEAR ANY LEFTOVER FIRST, BECAUSE A CRASH IS THE STATE THIS SCRIPT WILL ACTUALLY BE FOUND
   * IN. The slug is unique, so one interrupted run made every future run fail on a duplicate key —
   * a checker that breaks permanently the first time it dies is a checker nobody trusts twice. */
  await rest(`videos?slug=eq.${SLUG}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })

  const made = await rest('videos', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slug: SLUG, title: 'grant check', storage_path: `${SLUG}-v1.mp4`, sort_order: 999, version: 1, status: 'draft' }),
  })
  judge('videos: insert a row', 'allowed', made)
  if (made.status !== 201) {
    console.error('\nCannot probe further without a row of our own. Stopping.')
    process.exit(1)
  }
  /* ⚠️ THE ID IS RECOVERED BY SLUG IF THE RESPONSE CANNOT BE READ. The cleanup is only as good as
   * this line: without a fallback, one unexpected response shape leaves a row behind for ever. */
  videoId = JSON.parse(made.body || '[]')[0]?.id
  if (!videoId) videoId = JSON.parse((await rest(`videos?select=id&slug=eq.${SLUG}&limit=1`)).body)[0]?.id

  const someone = JSON.parse((await rest('profiles?select=user_id&limit=1')).body)[0].user_id

  judge('videos: read the list', 'allowed', await rest('videos?select=id&limit=1'))
  judge('videos: move `status`', 'allowed', await rest(`videos?id=eq.${videoId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'awaiting_review' }),
  }))
  // ⚠️ THE ONE THAT WOULD LET A ROUTE BUG POINT A VIDEO AT ANOTHER OBJECT.
  judge('videos: repoint `storage_path`', 'refused', await rest(`videos?id=eq.${videoId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ storage_path: 'somebody-elses.mp4' }),
  }))

  judge('video_reviewers: assign (video_id, reviewer_id)', 'allowed', await rest('video_reviewers', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ video_id: videoId, reviewer_id: someone }]),
  }))
  // ⚠️ THE ONE THAT MATTERS MOST. A fabricated assignment is survivable; a fabricated assignment
  // that ARRIVES APPROVED is a reviewer who never looked, on a cut about to be posted.
  judge('video_reviewers: assign WITH a verdict', 'refused', await rest('video_reviewers', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ video_id: videoId, reviewer_id: someone, verdict: 'approved' }]),
  }))
  judge('video_reviewers: unassign', 'refused', await rest(`video_reviewers?video_id=eq.${videoId}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))

  judge('notes: write one', 'allowed', await rest('notes', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ video_id: videoId, reviewer_id: someone, t_seconds: 0, body: 'grant check', video_version: 1 }),
  }))
  judge('notes: destroy one', 'refused', await rest(`notes?video_id=eq.${videoId}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))

  judge('issues: delete a tester’s issue', 'refused', await rest('issues?id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))
  judge('todos: delete one', 'refused', await rest('todos?id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))
  judge('profiles: delete an account', 'refused', await rest('profiles?user_id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))
  /* ⚠️ A NONEXISTENT ID ON PURPOSE. Postgres checks column privileges at plan time, so a PATCH
   * that matches zero rows still answers 42501 without the grant and 204 with it — which makes
   * the probe side-effect free on a table of real people. Two columns, two answers: the flag the
   * People button moves (20260909150000) and the role nothing signed in may ever change. */
  judge('profiles: move `can_approve`', 'allowed', await rest('profiles?user_id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ can_approve: true }),
  }))
  /* ⚠️ THIS ROW FLIPPED FROM `refused` TO `allowed` ON 2026-09-10, AND THAT IS A REAL LOSS BEING
   * RECORDED RATHER THAN HIDDEN. Until then the schema's stated property was "nothing signed in can
   * grant itself a role, which is the one write that would matter". The People tab now changes
   * roles, so `grant update (role)` exists (20260910110000) and this probe would go red on a
   * correct build if it still asserted the old answer. What replaces the grant is in
   * /api/admin/people: never your own row, never the owner's, and never the change that leaves
   * zero admins. Those are route rules, and no script here can see them — see the handoff. */
  judge('profiles: change `role`', 'allowed', await rest('profiles?user_id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'admin' }),
  }))
  /* ⚠️ AND THE TWO THAT DID NOT MOVE, ASKED IN THE SAME BREATH. A grant of one column is only
   * meaningful if the columns beside it are still refused; without these the row above reads as
   * "profiles became writable" and nobody would know the difference. `is_owner` is the one that
   * decides who can destroy an account, and NOTHING in the web tier may write it. */
  judge('profiles: change `is_owner`', 'refused', await rest('profiles?user_id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_owner: true }),
  }))
  judge('profiles: rename somebody', 'refused', await rest('profiles?user_id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: 'not their name' }),
  }))

  /* ── Source material (20260910100000) ─────────────────────────────────────────────────────── */
  const material = await rest('material', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ title: 'grant check', subject: 'science', kind: 'link', url: 'https://example.com/grant-check', ready: true }),
  })
  judge('material: insert a row', 'allowed', material)
  const materialId = JSON.parse(material.body || '[]')[0]?.id
  if (materialId) {
    judge('material: read the list', 'allowed', await rest('material?select=id&limit=1'))
    judge('material: flip `ready`', 'allowed', await rest(`material?id=eq.${materialId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ready: false }),
    }))
    /* ⚠️ THE ONE THAT WOULD LET A ROUTE BUG REPOINT AN ITEM SOMEBODY HAS ALREADY OPENED. Same
     * shape as `videos: repoint storage_path` above: the update grant names one column, so every
     * other column on this table is read-only to the web tier once the row exists. */
    judge('material: repoint `url`', 'refused', await rest(`material?id=eq.${materialId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ url: 'https://example.com/elsewhere' }),
    }))
    judge('material: delete a row', 'allowed', await rest(`material?id=eq.${materialId}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    }))
  }
  judge('invite_links: delete one', 'refused', await rest('invite_links?id=eq.00000000-0000-4000-8000-000000000000', {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))

  judge('videos: delete a row', 'allowed', await rest(`videos?id=eq.${videoId}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  }))
  videoId = null
} finally {
  // ⚠️ UNCONDITIONAL. A probe that leaves a video behind when it fails half way is a probe nobody
  // runs twice — and this one writes to the project the marketing site shares.
  if (videoId) {
    const gone = await rest(`videos?id=eq.${videoId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    console.log(gone.status === 204 ? '\n· cleaned up the probe row' : `\n⚠️  COULD NOT CLEAN UP — delete the '${SLUG}' video by hand (${gone.status})`)
  }
}

console.log(
  failures === 0
    ? '\nPASS — every privilege is what it is supposed to be, in both directions.'
    : `\nFAIL — ${failures} privilege(s) are not what this file says they should be.`,
)
process.exit(failures === 0 ? 0 : 1)
