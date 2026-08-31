import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, ADMIN_PARAM, tokenValid } from '@/lib/admin'

const AT_COOKIE = 'rvr_at'
const RT_COOKIE = 'rvr_rt'

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * 1. REFRESH AN EXPIRING SESSION. A server component cannot set cookies, so the only place a new
 *    access token can be stored is here. Without it a signed-in admin is thrown back to the login
 *    form every hour.
 *
 * 2. TAKE THE LEGACY ADMIN TOKEN OUT OF THE URL after exactly one request — unchanged, and still
 *    load-bearing until real accounts have replaced it.
 *
 * ⚠️ THIS IS NOT THE AUTHORISATION CHECK. It refreshes a token; it never decides who may see a
 * page. That decision is `requireRole()` in the page itself, against a token Supabase validated.
 * A proxy that both refreshes and authorises is a proxy where one early `return` silently opens a
 * route.
 */
export async function proxy(req: NextRequest) {
  // --- 2. legacy ?k= exchange -------------------------------------------------------------
  const supplied = req.nextUrl.searchParams.get(ADMIN_PARAM)
  if (supplied !== null) {
    const url = req.nextUrl.clone()
    url.searchParams.delete(ADMIN_PARAM)
    const res = NextResponse.redirect(url, 302)
    if (tokenValid(supplied)) {
      res.cookies.set(ADMIN_COOKIE, supplied, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/admin',
        secure: req.nextUrl.protocol === 'https:',
        maxAge: ADMIN_COOKIE_MAX_AGE,
      })
    }
    return res
  }

  // --- 1. refresh -------------------------------------------------------------------------
  const access = req.cookies.get(AT_COOKIE)?.value
  const refresh = req.cookies.get(RT_COOKIE)?.value
  if (!refresh || (access && !expiringSoon(access))) return NextResponse.next()

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.next()

  const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: 'no-store',
  }).catch(() => null)

  // A failed refresh is NOT a redirect to login from here. The page's own `requireRole()` decides
  // that, with a validated answer; guessing at it in the proxy is how a transient network blip
  // logs someone out.
  if (!r || !r.ok) return NextResponse.next()

  const t = (await r.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number }
    | null
  if (!t?.access_token || !t.refresh_token) return NextResponse.next()

  // Hand the NEW token to this same request, so the page below renders signed-in rather than
  // waiting for the next navigation.
  const headers = new Headers(req.headers)
  const jar = req.cookies
  jar.set(AT_COOKIE, t.access_token)
  headers.set('cookie', jar.toString())

  const res = NextResponse.next({ request: { headers } })
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: req.nextUrl.protocol === 'https:',
  }
  res.cookies.set(AT_COOKIE, t.access_token, { ...opts, maxAge: t.expires_in ?? 3600 })
  res.cookies.set(RT_COOKIE, t.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 30 })
  return res
}

/**
 * Reads `exp` out of the JWT payload WITHOUT verifying the signature — deliberately, and safely,
 * because nothing is authorised on the result. It only answers "is it worth spending a refresh
 * call". A forged token that claims a distant expiry simply skips the refresh and then fails the
 * real check in `currentUser()`, which asks Supabase.
 */
function expiringSoon(jwt: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()) as { exp?: number }
    if (!payload.exp) return true
    return payload.exp * 1000 - Date.now() < 60_000
  } catch {
    return true
  }
}

export const config = { matcher: ['/admin', '/admin/:path*', '/tester', '/tester/:path*'] }
