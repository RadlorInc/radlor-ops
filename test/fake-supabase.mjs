/**
 * OFFLINE STAND-IN FOR SUPABASE, FOR THE E2E RUN ONLY. Never imported by `src/`.
 *
 * Why it exists: the founder is doing the Supabase click-through themselves (deliberately — see
 * SETUP.md), so there is no project to point at while the checks are being written. This serves
 * the two Supabase APIs the app actually speaks:
 *
 *   1. PostgREST over a REAL Postgres — PGlite is Postgres compiled to WASM, and it runs
 *      `supabase/migrations/*.sql` verbatim. The CHECK constraints, the unique indexes and the
 *      `enable row level security` in that file are therefore executed, not assumed.
 *   2. Storage `object/sign` + the signed GET, with a real HMAC and a real `exp`, so an expired
 *      URL fails the way an expired Supabase URL fails.
 *
 * ⚠️ IT IS A STAND-IN, NOT A SIMULATOR. It implements the handful of query shapes `src/lib/db.ts`
 * sends and nothing else. A check that passes here has exercised THIS APP'S logic against real
 * SQL; it has not proven anything about Supabase's own PostgREST or Storage. Anything that turns
 * on Supabase's behaviour (the RLS denial for `anon`, the real signed-URL expiry) has to be
 * verified against the real project — `scripts/verify-live.mjs` does that.
 */
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = Number(process.env.FAKE_SUPABASE_PORT || 54329)
const SECRET = 'fake-storage-secret'
const TABLES = new Set(['reviewers', 'videos', 'notes'])
const IDENT = /^[a-z_][a-z0-9_]*$/

const db = new PGlite()
// Supabase ships these two roles; PGlite does not. The migration's REVOKEs name them, so they have
// to exist for the file to run unmodified — which is the point of running the real file.
await db.exec('create role anon; create role authenticated;')
await db.exec(await readFile(join(ROOT, 'supabase/migrations/20260831120000_init_video_reviewer.sql'), 'utf8'))
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
    } else throw new Error(`unsupported operator ${v}`)
  }

  let sql = `select ${cols.join(', ')} from ${table}`
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  try {
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
      if (req.method === 'GET') {
        const { sql, args } = buildSelect(table, url.searchParams)
        const r = await db.query(sql, args)
        return json(res, 200, r.rows)
      }
      if (req.method === 'POST') {
        const row = await readBody(req)
        const keys = Object.keys(row)
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        const r = await db.query(
          `insert into ${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
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
