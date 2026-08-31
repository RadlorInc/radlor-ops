import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../../_rateLimit'
import { AT_COOKIE, RT_COOKIE } from '@/lib/session'

/**
 * Email + password sign-in, server-side.
 *
 * ⚠️ FORM-ENCODED AND 303, NOT JSON. The form works with JavaScript off, and — more to the point —
 * the password never passes through page script. It goes from the browser's own form submission to
 * this route to Supabase's token endpoint, and what comes back lands in httpOnly cookies.
 *
 * ⚠️ ONE ANSWER FOR EVERY FAILURE. Wrong password, unknown email, disabled user: all
 * `?error=1`. Anything more specific is an account-enumeration oracle, and self-signup is off, so
 * knowing which addresses exist is knowing who works here.
 */
export const dynamic = 'force-dynamic'

/** Password guessing is the attack this route exists to be slow about. Ten a minute per IP. */
const LIMIT = 10
const WINDOW_MS = 60_000

export async function POST(req: Request) {
  const back = new URL('/login', req.url)

  if (overLimit(callerKey(req, 'login'), LIMIT, WINDOW_MS)) {
    back.searchParams.set('error', 'rate')
    return NextResponse.redirect(back, 303)
  }

  const form = await req.formData().catch(() => null)
  const email = String(form?.get('email') ?? '').trim().slice(0, 254)
  const password = String(form?.get('password') ?? '')
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY

  if (!email || !password || !url || !anon) {
    back.searchParams.set('error', '1')
    return NextResponse.redirect(back, 303)
  }

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  if (!res.ok) {
    // ⚠️ The body is NOT read into the redirect. Supabase's message distinguishes "invalid login
    // credentials" from other states, and passing that through would rebuild the oracle this route
    // just avoided.
    back.searchParams.set('error', '1')
    return NextResponse.redirect(back, 303)
  }

  const { access_token, refresh_token, expires_in } = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!access_token || !refresh_token) {
    back.searchParams.set('error', '1')
    return NextResponse.redirect(back, 303)
  }

  // Land on /admin; a tester without admin gets 404 there and can go to /tester. Kept simple
  // deliberately: a `next` parameter taken from the URL is an open-redirect waiting to happen.
  const out = NextResponse.redirect(new URL('/admin', req.url), 303)
  const secure = new URL(req.url).protocol === 'https:'
  const opts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure }
  out.cookies.set(AT_COOKIE, access_token, { ...opts, maxAge: expires_in ?? 3600 })
  // The refresh token outlives the access token; that is what stops an hourly re-login.
  out.cookies.set(RT_COOKIE, refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 30 })
  return out
}
