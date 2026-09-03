import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../../api/_rateLimit'
import { setSessionCookies } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * The emailed link lands here: `/auth/confirm?token_hash=…&type=invite|recovery`.
 *
 * ⚠️ TOKEN HASH, NOT THE IMPLICIT FLOW. Supabase's default templates send the person to
 * Supabase's own /verify, which bounces back with the session in the URL FRAGMENT — invisible to a
 * server, and this app has no browser-side Supabase at all. So the email templates are changed
 * (dashboard, see handoff) to link straight here with `{{ .TokenHash }}`, and this route swaps
 * the hash for a session over the back channel. Opening the link IS the email confirmation.
 *
 * ⚠️ Never log `token_hash`. A failed verify redirects with a fixed word; the URL that carried the
 * hash appears in no error.
 */
const TYPES = new Set(['invite', 'recovery', 'email', 'magiclink', 'signup'])

function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

export async function GET(req: Request) {
  if (overLimit(callerKey(req, 'confirm'), 20, 60_000)) return seeOther('/login?error=rate')
  const q = new URL(req.url).searchParams
  const token_hash = q.get('token_hash') ?? ''
  const type = q.get('type') ?? ''
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!token_hash || !TYPES.has(type) || !url || !anon) return seeOther('/login?error=link')

  const res = await fetch(`${url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, token_hash }),
    cache: 'no-store',
  }).catch(() => null)
  if (!res || !res.ok) return seeOther('/login?error=link')

  const t = (await res.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number }
    | null
  if (!t?.access_token || !t.refresh_token) return seeOther('/login?error=link')

  // An invite and a reset both end at "choose a password"; anything else is signed in and sent
  // to /login, which forwards a signed-in person to their own home.
  const out = seeOther(type === 'invite' || type === 'recovery' ? '/set-password' : '/login')
  setSessionCookies(out, req, { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in })
  return out
}
