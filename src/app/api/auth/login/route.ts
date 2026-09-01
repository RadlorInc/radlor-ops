import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../../_rateLimit'
import { SCHEMA } from '@/lib/db'
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

/**
 * ⚠️ RELATIVE `Location`, NOT `NextResponse.redirect(new URL(..., req.url))`.
 * `req.url`'s host is whatever the server resolved, which is NOT always the host the browser used:
 * on a local production build it came back as `localhost` for a request made to `127.0.0.1`. Those
 * are different origins for cookies, so the session was set on one host and the redirect sent the
 * browser to the other — sign-in failed silently, and looked like broken auth rather than a broken
 * redirect. A relative Location is resolved by the browser against the origin it actually used, so
 * the mismatch cannot happen.
 */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

/** Password guessing is the attack this route exists to be slow about. Ten a minute per IP. */
const LIMIT = 10
const WINDOW_MS = 60_000

export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'login'), LIMIT, WINDOW_MS)) return seeOther('/login?error=rate')

  const form = await req.formData().catch(() => null)
  const email = String(form?.get('email') ?? '').trim().slice(0, 254)
  const password = String(form?.get('password') ?? '')
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY

  if (!email || !password || !url || !anon) return seeOther('/login?error=1')

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  // ⚠️ The body is NOT read into the redirect. Supabase's message distinguishes "invalid login
  // credentials" from other states, and passing that through would rebuild the oracle this route
  // just avoided.
  if (!res.ok) return seeOther('/login?error=1')

  const { access_token, refresh_token, expires_in } = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!access_token || !refresh_token) return seeOther('/login?error=1')

  /**
   * ⚠️ LAND THEM WHERE THEY BELONG. The first version sent everyone to /admin, so a tester's very
   * first act after signing in was a 404 on their own tool — correct gating, terrible product.
   * The destination comes from the profile, read with the user's OWN token so the row arrives via
   * the `profiles_read_own` policy rather than by the app deciding.
   *
   * Deliberately NOT a `next` parameter from the URL: that is an open redirect waiting to happen,
   * and there are exactly two destinations.
   */
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${access_token}` },
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

  /**
   * ⚠️ FILTERED BY `user_id`, NOT LEFT TO RLS ALONE. The first version asked for
   * `profiles?select=role&limit=1` and trusted the policy to make that mean "my row". It does, in
   * production — but a query whose correctness depends entirely on a policy elsewhere returns
   * SOMEBODY'S role the moment that policy widens, and it returned the admin's the moment it met
   * an environment with no RLS at all. The filter and the policy now have to agree; either alone
   * gives the right answer.
   */
  const me = who?.id
    ? await fetch(`${url}/rest/v1/profiles?select=role&user_id=eq.${who.id}&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${access_token}`, 'Accept-Profile': SCHEMA },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    : []
  /**
   * ⚠️ AN EXPLICIT MAP, AND THE DEFAULT IS NOT `/admin`. This was
   * `role === 'tester' ? '/tester' : '/admin'` — a ternary whose else-branch quietly meant
   * "everyone who is not a tester is an admin". Adding the `reviewer` role made that false, and a
   * reviewer's very first act after signing in was a 404 on `/admin`: the identical failure the
   * comment above records being fixed for testers, brought back by a role the expression could not
   * see. A two-valued ternary over a set that later grew is one of the quieter ways this happens.
   *
   * Unknown role lands on the login form with an error rather than on somebody else's dashboard.
   * They are authenticated and can do nothing until a human fixes their profile row, and saying so
   * is better than a 404 that looks like a broken deploy.
   */
  const HOME: Record<string, string> = { admin: '/admin', tester: '/tester', reviewer: '/review' }
  const home = HOME[me?.[0]?.role as string] ?? '/login?error=norole'

  const out = seeOther(home)
  const secure = req.headers.get('x-forwarded-proto') === 'https' || new URL(req.url).protocol === 'https:'
  const opts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure }
  out.cookies.set(AT_COOKIE, access_token, { ...opts, maxAge: expires_in ?? 3600 })
  // The refresh token outlives the access token; that is what stops an hourly re-login.
  out.cookies.set(RT_COOKIE, refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 30 })
  return out
}
