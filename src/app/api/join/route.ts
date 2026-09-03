import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../_rateLimit'
import { setUserPassword, spendInviteLink, usableInviteLink, userEmail } from '@/lib/db'
import { hashToken } from '@/lib/inviteToken'
import { setSessionCookies } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * ⚠️ TWENTY A MINUTE PER IP, NOT TEN. A room of testers opening their links on one office wifi is
 * the NORMAL case here, and the thing this limit is actually for — guessing a 24-byte token — is
 * hopeless at any rate a human network reaches.
 */
const LIMIT = 20
const WINDOW_MS = 60_000
const MIN_PASSWORD = 8

function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

/**
 * The second half of a link: set the password, spend the link, sign them in.
 *
 * ⚠️ THE LINK IS RE-CHECKED HERE, NOT TRUSTED FROM THE PAGE. The page's 404 is a rendering
 * decision; this is the one that matters, and a POST straight at this route never passed through
 * it.
 *
 * ⚠️ AND IT IS SPENT AFTER THE PASSWORD LANDS, NOT BEFORE. The other order loses the account to
 * everybody if the auth call fails: the link is dead, no password was set, and there is no way in
 * at all. This order's failure is a link that still works, which is the recoverable one.
 *
 * ⚠️ THE REDIRECT IS `/login`, AND THAT IS NOT A SHRUG. They arrive there holding fresh session
 * cookies, and the login page already sends a signed-in person to the surface their role is for.
 * Working out the destination a second time here would be a second copy of a rule that has been
 * wrong twice already (see the login route's note about the two-valued ternary).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const token = String(form?.get('token') ?? '').slice(0, 200)
  const password = String(form?.get('password') ?? '')
  const confirm = String(form?.get('confirm') ?? '')
  const back = `/join/${encodeURIComponent(token)}`

  if (overLimit(callerKey(req, 'join'), LIMIT, WINDOW_MS)) return seeOther(`${back}?error=rate`)

  const link = token ? await usableInviteLink(hashToken(token)) : null
  if (!link) return seeOther('/login?error=link')

  if (password.length < MIN_PASSWORD) return seeOther(`${back}?error=short`)
  if (password !== confirm) return seeOther(`${back}?error=match`)

  try {
    await setUserPassword(link.user_id, password)
  } catch {
    return seeOther(`${back}?error=1`)
  }
  await spendInviteLink(link.id)

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return seeOther('/login?done=password')

  // Sign them in with what they just chose, through the same password grant the login form uses —
  // so a password this route cannot sign in with is a password the login form cannot either.
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: await userEmail(link.user_id).catch(() => ''), password }),
    cache: 'no-store',
  }).catch(() => null)

  if (!res?.ok) return seeOther('/login?done=password')
  const t = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!t.access_token || !t.refresh_token) return seeOther('/login?done=password')

  const out = seeOther('/login')
  setSessionCookies(out, req, { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in })
  return out
}
