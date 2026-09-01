/**
 * OFFLINE STAND-IN FOR SUPABASE, FOR THE E2E RUN ONLY. Never imported by `src/`.
 *
 * Why it exists: so the suite runs offline, on any machine, with no project and no keys. (It was
 * written before the schema existed; it stays because a suite that needs a live database and a
 * secret is a suite nobody runs.) It serves the two Supabase APIs the app actually speaks:
 *
 *   1. PostgREST over a REAL Postgres — PGlite is Postgres compiled to WASM, and it runs
 *      `supabase/migrations/*.sql` verbatim. The CHECK constraints and unique indexes are therefore
 *      executed, not assumed. ⚠️ The `enable row level security` lines also execute — and do
 *      NOTHING here. See the blind spot below.
 *   2. Storage `object/sign` + the signed GET, with a real HMAC and a real `exp`, so an expired
 *      URL fails the way an expired Supabase URL fails.
 *
 * ⚠️ IT IS A STAND-IN, NOT A SIMULATOR. It implements the handful of query shapes `src/lib/db.ts`
 * sends and nothing else. A check that passes here has exercised THIS APP'S logic against real
 * SQL; it has not proven anything about Supabase's own PostgREST or Storage.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ DECLARED BLIND SPOT: THIS HARNESS CANNOT SEE AUTHORIZATION. AT ALL. BY CONSTRUCTION.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * PGlite runs every statement as ONE SUPERUSER with NO ROLE SWITCHING. There is no `anon`, no
 * `service_role`, no `set role`, no grant checking, no RLS enforcement — the roles created at
 * start-up exist only so the migration's GRANT/REVOKE statements parse.
 *
 * So the class is broader than any one gap: **anything whose behaviour depends on WHO IS ASKING is
 * invisible here, and always will be.** Grants, RLS, role membership, `BYPASSRLS`, column
 * privileges, default privileges, storage policies — all of it. Not "not covered yet". Not
 * coverable.
 *
 * It has already cost twice, in the same direction both times:
 *   1. RLS enforcement for `anon` — the migration's `enable row level security` RUNS here, and
 *      means nothing here.
 *   2. GRANTs (2026-08-31) — `review`'s tables were created owner-only, `service_role` could not
 *      SELECT them, and EVERY ROUTE WOULD HAVE RETURNED 42501. The suite was 19/19 green while the
 *      tool was completely dead. It was found by querying the live database, never by a test.
 *
 * ⚠️ SO DO NOT READ A GREEN SUITE AS COVERING PERMISSION. It covers BEHAVIOUR — token resolution,
 * the 404 shape, the rate limit, the admin gate, the note round-trip, the export format. Every one
 * of those is worth having and none of them is an authorization check.
 *
 * ⚠️ THE ONLY AUTHORIZATION COVERAGE THIS TOOL HAS IS THREE SCRIPTS RUN BY HAND AGAINST THE LIVE
 * PROJECT. They are not finishing touches; they are the entire coverage of this axis:
 *
 *     scripts/check-anon-locked-out.mjs     — anon is denied, with a service_role positive control
 *     scripts/check-signed-url-expiry.mjs   — a signed URL really dies when it expires
 *     scripts/check-blast-radius.mjs        — the documented exposure is still what the docs say
 *
 * Run them after any change to a grant, a policy, a role, the exposed schemas, or a key. A green
 * `npm run test:e2e` is not a substitute and cannot become one.
 */
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = Number(process.env.FAKE_SUPABASE_PORT || 54329)
const SECRET = 'fake-storage-secret'
const TABLES = new Set(['reviewers', 'videos', 'video_reviewers', 'notes', 'profiles', 'subscriptions', 'todos', 'issues', 'testing_sessions'])
/** These tables live in `review`, not `public` — the shared project's `public` belongs to the
 *  marketing site. The shim ENFORCES the profile header for the same reason real PostgREST does:
 *  without it the app would be asking for `public.reviewers`, which does not exist. If this were
 *  lenient, dropping the header from `src/lib/db.ts` would break nothing here and pass. */
const SCHEMA = 'review'
const IDENT = /^[a-z_][a-z0-9_]*$/

/**
 * ⚠️ PGlite PARSES `date` COLUMNS INTO JS `Date`; REAL PostgREST RETURNS `YYYY-MM-DD`.
 * Left alone, `JSON.stringify` turns the Date into a full ISO timestamp and the app — which builds
 * `${renewal}T00:00:00Z` to compare at UTC midnight — produces `NaN` and reports every renewal as
 * having no date. Caught by a renewal spec going `Expected: "soon", Received: "none"`.
 *
 * Fixed in the STAND-IN rather than by making the app accept both shapes: the app should speak to
 * one contract, and a harness that hands it a shape production never sends is a harness that hides
 * bugs in one direction and invents them in the other. 1082 is Postgres's `date` OID.
 */
const DATE_AS_TEXT = { parsers: { 1082: (v) => v } }

const db = new PGlite()
// Supabase ships these two roles; PGlite does not. The migration's REVOKEs name them, so they have
// to exist for the file to run unmodified — which is the point of running the real file.
await db.exec('create role anon; create role authenticated; create role service_role;')
/**
 * ⚠️ A STUB `auth` SCHEMA, SO THE PROFILES MIGRATION RUNS VERBATIM RATHER THAN BEING SKIPPED.
 * Two tiny objects — the `users` table its foreign key points at, and `auth.uid()`. That is enough
 * for the real DDL, the real FK and the real CHECK constraint to execute.
 *
 * It does NOT make RLS work. `auth.uid()` here reads a setting nobody sets, and PGlite has one
 * superuser who bypasses policies anyway. The declared blind spot above is unchanged: this makes
 * the SHAPE of the schema real, not its authorisation.
 */
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`)
// Every migration, in filename order — not one hardcoded path. The first version named the file
// directly and would have silently stopped covering anything added beside it; it broke loudly the
// day the file was renamed to match the applied version, which was the good outcome.
for (const f of (await readdir(join(ROOT, 'supabase/migrations'))).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = await readFile(join(ROOT, 'supabase/migrations', f), 'utf8')
  // ⚠️ PGlite has no `storage` schema — it is plain Postgres, not a Supabase project. A migration
  // that touches storage is SKIPPED, and skipping it is announced: a stand-in that quietly drops
  // statements is how "the tests pass" stops meaning anything.
  // ⚠️ SKIPPED AND ANNOUNCED, NEVER SILENTLY DROPPED. PGlite is plain Postgres, not a Supabase
  // project: it has no `storage` schema and no `auth` schema, so a migration referencing either
  // cannot run. Anything in a skipped file is verified LIVE or not at all — see the declared blind
  // spot above, of which this is the same class one level over.
  const missing = /\bstorage\./.test(sql) ? 'storage' : null
  if (missing) {
    console.log(`  skipped ${f} — touches the ${missing} schema, which PGlite does not have`)
    continue
  }
  await db.exec(sql)
}
await db.exec(await readFile(join(HERE, 'seed.sql'), 'utf8'))

const fixture = await readFile(join(HERE, 'fixture.webm')).catch(() => null)

/** `?select=a,b&col=eq.v&col2=is.null&order=a.asc,b.desc&limit=1` → SQL. */
function buildSelect(table, params) {
  const cols = (params.get('select') || '*')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  for (const c of cols) if (c !== '*' && !IDENT.test(c)) throw new Error(`bad column ${c}`)

  const where = []
  const args = []
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    if (!IDENT.test(k)) throw new Error(`bad filter ${k}`)
    if (v === 'is.null') where.push(`${k} is null`)
    else if (v.startsWith('eq.')) {
      args.push(v.slice(3))
      where.push(`${k}::text = $${args.length}`)
    } else if (v.startsWith('gte.')) {
      args.push(v.slice(4))
      where.push(`${k} >= $${args.length}::timestamptz`)
    } else if (v.startsWith('in.(') && v.endsWith(')')) {
      // `status=in.(awaiting_review,reviewed)` — the reviewer-visible filter.
      const vals = v.slice(4, -1).split(',').map((x) => x.trim()).filter(Boolean)
      if (!vals.length) throw new Error('empty in()')
      where.push(`${k}::text in (${vals.map((x) => { args.push(x); return `$${args.length}` }).join(', ')})`)
    } else throw new Error(`unsupported operator ${v}`)
  }

  let sql = `select ${cols.join(', ')} from ${SCHEMA}.${table}`
  if (where.length) sql += ` where ${where.join(' and ')}`
  const order = params.get('order')
  if (order) {
    const parts = order.split(',').map((o) => {
      const [col, dir] = o.split('.')
      if (!IDENT.test(col)) throw new Error(`bad order ${col}`)
      return `${col} ${dir === 'desc' ? 'desc' : 'asc'}`
    })
    sql += ` order by ${parts.join(', ')}`
  }
  const limit = params.get('limit')
  if (limit) sql += ` limit ${Number(limit) || 0}`
  return { sql, args }
}

function sign(path, exp) {
  return createHmac('sha256', SECRET).update(`${path}|${exp}`).digest('hex')
}

function json(res, status, body) {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}

/**
 * ⚠️ A STAND-IN FOR SUPABASE AUTH, AND IT AUTHENTICATES NOTHING REAL.
 * It exists so the offline suite can still reach `/admin` and `/tester` after the `?k=` gate was
 * removed — without it, ten checks including the export format and every verdict assertion would
 * have had no way in and would simply have been deleted. Passwords are a hardcoded map; the
 * "JWT" is base64 with no signature, because nothing here verifies one.
 *
 * What it DOES faithfully reproduce is EXPIRY, which is the point: `exp` is real and honoured, so
 * the proxy's refresh path can be driven deterministically instead of waiting an hour.
 */
const ACCOUNTS = {
  'admin@harness.test': { password: 'harness-admin-pw', id: '55555555-5555-4555-8555-555555555555' },
  'tester@harness.test': { password: 'harness-tester-pw', id: '66666666-6666-4666-8666-666666666666' },
  // The reviewer accounts. Dana holds assignments; Flood is the second reviewer on the split
  // videos, and is also the one the rate-limit spec floods through the token door.
  'dana@example.com': { password: 'harness-dana-pw', id: '77777777-7777-4777-8777-777777777777' },
  'flood@example.com': { password: 'harness-flood-pw', id: '88888888-8888-4888-8888-888888888888' },
}
/** Deliberately short so a test can watch a session expire without waiting. */
const ACCESS_TTL = Number(process.env.FAKE_ACCESS_TTL || 3600)
const refreshTokens = new Map()

/** ⚠️ `jti` is not decoration. Without it two tokens minted in the same SECOND are byte-identical,
 *  because `exp` has second resolution and nothing else varies — so a test asserting "the token
 *  changed after a refresh" cannot tell a successful refresh from no refresh at all. It failed
 *  exactly that way once. Real Supabase JWTs carry a signature that differs; this stands in for it. */
const mkAccess = (id, email) =>
  `x.${Buffer.from(
    JSON.stringify({ sub: id, email, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL, jti: Math.random().toString(36).slice(2) }),
  ).toString('base64url')}.y`
function readAccess(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString())
    if (!p.exp || p.exp * 1000 < Date.now()) return null
    return p
  } catch {
    return null
  }
}
function issue(id, email) {
  const refresh = `refresh-${id}-${Math.random().toString(36).slice(2)}`
  refreshTokens.set(refresh, { id, email })
  return { access_token: mkAccess(id, email), refresh_token: refresh, expires_in: ACCESS_TTL, token_type: 'bearer' }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  try {
    // Readiness only, for the Playwright webServer. Deliberately not a table request: those now
    // require a profile header and answer 404 without one, which the harness would read as "not
    // up yet" and wait out the full timeout.
    if (url.pathname === '/health') return json(res, 200, { ok: true })

    // ---- Auth --------------------------------------------------------------------------
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const body = await readBody(req)
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const who = refreshTokens.get(body.refresh_token)
        if (!who) return json(res, 400, { error: 'invalid_grant' })
        refreshTokens.delete(body.refresh_token) // single use, like the real thing
        return json(res, 200, issue(who.id, who.email))
      }
      const acct = ACCOUNTS[String(body.email || '').toLowerCase()]
      if (!acct || acct.password !== body.password) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      }
      return json(res, 200, issue(acct.id, String(body.email).toLowerCase()))
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const p = readAccess((req.headers.authorization || '').replace(/^Bearer /, ''))
      if (!p) return json(res, 401, { message: 'invalid or expired token' })
      return json(res, 200, { id: p.sub, email: p.email })
    }

    // ---- Storage: mint a signed URL -------------------------------------------------
    let m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
    if (m && req.method === 'POST') {
      const { expiresIn } = await readBody(req)
      const objPath = `/object/sign/${m[1]}/${m[2]}`
      const exp = Math.floor(Date.now() / 1000) + (Number(expiresIn) || 60)
      return json(res, 200, { signedURL: `${objPath}?token=${exp}.${sign(objPath, exp)}` })
    }
    // ---- Storage: redeem it ---------------------------------------------------------
    if (m && req.method === 'GET') {
      const objPath = `/object/sign/${m[1]}/${m[2]}`
      const [exp, mac] = (url.searchParams.get('token') || '').split('.')
      if (!mac || mac !== sign(objPath, Number(exp))) return json(res, 400, { error: 'InvalidJWT' })
      // The whole point of the check: an expired URL is dead even though it is otherwise valid.
      if (Number(exp) * 1000 < Date.now()) return json(res, 400, { error: 'jwt expired' })
      if (!fixture) return json(res, 404, { error: 'no fixture' })
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': fixture.length })
      return res.end(fixture)
    }

    // ---- PostgREST ------------------------------------------------------------------
    m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)
    if (m && TABLES.has(m[1])) {
      const table = m[1]
      // Real PostgREST answers PGRST106 when the requested profile is not an exposed schema, and
      // falls back to the DEFAULT profile (`public`) when no header is sent — where these tables
      // do not exist. Both come back as "not found" to the app; reproduce that rather than being
      // helpful, or the header stops being load-bearing.
      const profile = req.headers[req.method === 'GET' ? 'accept-profile' : 'content-profile']
      if (profile !== SCHEMA) {
        return json(res, 404, {
          code: 'PGRST106',
          message: `The schema must be one of the following: ${SCHEMA}`,
          got: profile ?? '(no profile header — PostgREST would use the default, `public`)',
        })
      }
      if (req.method === 'GET') {
        const { sql, args } = buildSelect(table, url.searchParams)
        const r = await db.query(sql, args, DATE_AS_TEXT)
        return json(res, 200, r.rows)
      }
      if (req.method === 'PATCH') {
        // Only what the app sends: a filtered UPDATE with `Prefer: return=minimal`. Real PostgREST
        // answers 204 with no body, and the app's `rest()` depends on that, so reproduce it.
        const row = await readBody(req)
        const keys = Object.keys(row)
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        const { sql, args } = buildSelect(table, url.searchParams)
        const whereSql = sql.includes(' where ') ? sql.slice(sql.indexOf(' where ')) : ''
        if (!whereSql) throw new Error('refusing an unfiltered PATCH')
        const sets = keys.map((k, i) => `${k} = $${args.length + i + 1}`).join(', ')
        await db.query(`update ${SCHEMA}.${table} set ${sets}${whereSql}`, [...args, ...keys.map((k) => row[k])])
        res.writeHead(204)
        return res.end()
      }
      if (req.method === 'POST') {
        const row = await readBody(req)
        const keys = Object.keys(row)
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        const r = await db.query(
          `insert into ${SCHEMA}.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
          keys.map((k) => row[k]),
        )
        const wants = (req.headers.prefer || '').includes('return=representation')
        return json(res, 201, wants ? r.rows : null)
      }
    }
    json(res, 404, { error: 'no route', path: url.pathname })
  } catch (e) {
    // PostgREST answers a constraint violation with 4xx and the reason in the body; so does this.
    json(res, 400, { message: String(e && e.message ? e.message : e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake supabase on http://127.0.0.1:${PORT}  (fixture: ${fixture ? 'yes' : 'MISSING'})`)
})
