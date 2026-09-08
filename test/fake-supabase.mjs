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
/** ⚠️ Must match `VIDEO_BUCKET` in src/lib/storage.ts. A shim that primed the wrong bucket would
 *  404 every seeded video and the failure would read as "signing is broken". */
const VIDEO_BUCKET = 'review-videos'
/** The object store: what has actually been PUT (plus the seeded paths), by `bucket/path`. Empty
 *  for anything else, which is what makes "the file never arrived" a state this harness can be in. */
const uploaded = new Map()
const TABLES = new Set(['reviewers', 'videos', 'video_reviewers', 'notes', 'profiles', 'todos', 'issues', 'testing_sessions', 'invite_links'])
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
 * having no date. Caught by a renewal spec going `Expected: "soon", Received: "none"` — that spec
 * went with the costs tab, so nothing exercises this today. It stays because the coercion is right
 * for ANY `date` column, and the day one arrives is not the day to rediscover this.
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

/**
 * ⚠️ THE SEEDED PATHS GET THE FIXTURE BYTES; NOTHING ELSE GETS ANYTHING.
 *
 * The first version handed the fixture back for ANY path a signed URL was minted for, which made
 * "is this object actually there" a question the harness could not answer no to — and that is the
 * one question the publish step exists to ask. A test that POSTed a row and then published it
 * WITHOUT ever uploading a file passed: the shim cheerfully served a video for an object nobody
 * had created. Real storage 404s, so this one does too. Lenient in this direction is how a video
 * with no file reaches a reviewer.
 */
if (fixture) {
  const seeded = await db.query(`select storage_path from ${SCHEMA}.videos`)
  for (const r of seeded.rows) uploaded.set(`${VIDEO_BUCKET}/${r.storage_path}`, fixture)
}

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

/** The service key, spelled the same way `playwright.config.ts` hands it to the app. */
const SERVICE_KEY = 'fake-service-role-key-for-the-offline-harness'

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
  /* ⚠️ CORS, BECAUSE ONE REQUEST IN THIS APP IS MADE BY THE BROWSER RATHER THAN BY THE SERVER.
   * Everything else reaches Supabase from a route handler, where CORS does not exist; the upload
   * PUT goes straight from the page to storage, cross-origin. Real Supabase Storage answers with
   * permissive CORS headers, so a shim that did not was a harness-only failure that looked exactly
   * like a broken feature — the upload spec went red on a build where nothing was wrong. */
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
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

    // ---- Auth: the ADMIN API, which is the only way an account is made now ---------------
    // ⚠️ NO MAILER STAND-IN ANY MORE, because there is no mailer: `/auth/v1/invite`, `/recover`,
    // `/verify` and the `_outbox` are gone with the emailed-link design they served. An account is
    // created here with NO PASSWORD and reached through a link the admin copies out of the app.
    // ⚠️ SERVICE KEY OR 401 ON ALL THREE. Real GoTrue refuses the admin API to the anon key, and a
    // route that reached it with the wrong key must fail here too — otherwise the harness would
    // pass a build whose account creation is unauthenticated in production.
    const admin = url.pathname.match(/^\/auth\/v1\/admin\/users(?:\/([^/]+))?$/)
    if (admin) {
      if ((req.headers.authorization || '') !== `Bearer ${SERVICE_KEY}`) return json(res, 401, { message: 'service role required' })
      const id = admin[1]
      if (!id && req.method === 'POST') {
        const body = await readBody(req)
        const email = String(body.email || '').toLowerCase()
        if (!email) return json(res, 422, { msg: 'email required' })
        if (ACCOUNTS[email]) return json(res, 422, { msg: 'A user with this email address has already been registered' })
        const newId = globalThis.crypto.randomUUID()
        // ⚠️ `password: null` is the point of the whole design: the account exists and CANNOT be
        // signed into until somebody sets one through their link.
        ACCOUNTS[email] = { password: null, id: newId }
        await db.query('insert into auth.users (id, email) values ($1, $2)', [newId, email])
        return json(res, 200, { id: newId, email, user_metadata: body.user_metadata ?? {} })
      }
      const entry = id && Object.entries(ACCOUNTS).find(([, a]) => a.id === id)
      if (!entry) return json(res, 404, { message: 'no such user' })
      const [email, acct] = entry
      if (req.method === 'GET') return json(res, 200, { id, email })
      if (req.method === 'PUT') {
        const body = await readBody(req)
        if (typeof body.password !== 'string' || body.password.length < 6) return json(res, 422, { msg: 'Password should be at least 6 characters' })
        acct.password = body.password
        return json(res, 200, { id, email })
      }
    }

    /* ---- Storage: mint an UPLOAD url, and redeem it ---------------------------------
     *
     * ⚠️ UPLOADED BYTES ARE KEPT, AND THE SIGNED GET BELOW HANDS BACK THE RIGHT ONES. A shim that
     * accepted a PUT and returned 200 without storing anything would pass an upload test on a
     * build where the file went nowhere — which is the exact failure the publish step exists to
     * catch, reproduced inside the thing that is supposed to catch it. */
    let m = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/)
    if (m && req.method === 'POST') {
      const objPath = `/object/upload/sign/${m[1]}/${m[2]}`
      const exp = Math.floor(Date.now() / 1000) + 300
      return json(res, 200, { url: `${objPath}?token=${exp}.${sign(objPath, exp)}` })
    }
    if (m && req.method === 'PUT') {
      const objPath = `/object/upload/sign/${m[1]}/${m[2]}`
      const [exp, mac] = (url.searchParams.get('token') || '').split('.')
      if (!mac || mac !== sign(objPath, Number(exp))) return json(res, 400, { error: 'InvalidJWT' })
      const chunks = []
      for await (const c of req) chunks.push(c)
      uploaded.set(`${m[1]}/${m[2]}`, Buffer.concat(chunks))
      return json(res, 200, { Key: `${m[1]}/${m[2]}` })
    }

    // ---- Storage: mint a signed URL -------------------------------------------------
    m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
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
      // An object that was uploaded in this run wins: "can it be read back" has to be answered
      // about the bytes that were actually sent, not about the fixture sitting beside them.
      const body = uploaded.get(`${m[1]}/${m[2]}`)
      // Real storage answers 404 for an object that is not there. So does this.
      if (!body) return json(res, 404, { error: 'Object not found' })
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': body.length })
      return res.end(body)
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
        const body = await readBody(req)
        /* ⚠️ AN ARRAY IS A BULK INSERT, WHICH IS REAL POSTGREST AND NOT A CONVENIENCE. Assigning
         * two reviewers to one video is one POST carrying two rows; a shim that only understood a
         * single object would have turned that into `bad column 0` — an error about the harness,
         * thrown from inside the feature, with nothing wrong in the app. */
        const rowsIn = Array.isArray(body) ? body : [body]
        if (rowsIn.length === 0) return json(res, 201, [])
        const keys = Object.keys(rowsIn[0])
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        const values = rowsIn
          .map((_, n) => `(${keys.map((_, i) => `$${n * keys.length + i + 1}`).join(', ')})`)
          .join(', ')
        const r = await db.query(
          `insert into ${SCHEMA}.${table} (${keys.join(', ')}) values ${values} returning *`,
          rowsIn.flatMap((row) => keys.map((k) => row[k])),
        )
        // ⚠️ `return=minimal` GETS AN EMPTY 201, NOT `null`. Real PostgREST sends no body at all,
        // and `null` is valid JSON — so answering `null` here made `res.json()` succeed offline on
        // a call that throws in production. A lenient harness is how that ships.
        if (!(req.headers.prefer || '').includes('return=representation')) {
          res.writeHead(201, { 'Content-Length': 0 })
          return res.end()
        }
        return json(res, 201, r.rows)
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
