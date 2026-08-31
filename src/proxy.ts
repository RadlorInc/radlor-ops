import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, ADMIN_PARAM, tokenValid } from '@/lib/admin'

/**
 * Takes the admin token out of the URL after exactly one request.
 *
 * You paste `/admin?k=<ADMIN_TOKEN>` once. This swaps it for an httpOnly cookie and 302s to the
 * same path with the parameter gone, so every subsequent request — and every entry in the browser
 * history, the referrer header and Vercel's request log — carries no secret.
 *
 * A WRONG token is redirected too, without a cookie. Otherwise the URL that keeps the parameter is
 * exactly the one that got it wrong, which is a signal worth not sending.
 */
export function proxy(req: NextRequest) {
  const supplied = req.nextUrl.searchParams.get(ADMIN_PARAM)
  if (supplied === null) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.searchParams.delete(ADMIN_PARAM)
  const res = NextResponse.redirect(url, 302)

  if (tokenValid(supplied)) {
    res.cookies.set(ADMIN_COOKIE, supplied, {
      httpOnly: true,
      sameSite: 'lax',
      // Scoped to /admin, so it is never sent on a reviewer's `/r/<token>` request.
      path: '/admin',
      // ⚠️ Not a bare `NODE_ENV === 'production'`: the E2E harness runs a PRODUCTION build over
      // plain http on 127.0.0.1, and a Secure cookie there is a coin-flip on browser policy. Key
      // it off the actual scheme instead, which is https everywhere it matters.
      secure: req.nextUrl.protocol === 'https:',
      maxAge: ADMIN_COOKIE_MAX_AGE,
    })
  }
  return res
}

export const config = { matcher: ['/admin', '/admin/:path*'] }
