import 'server-only'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { SCHEMA } from './db'

/**
 * Account sessions for admin, tester and reviewer.
 *
 * ⚠️ REVIEWERS HAVE ACCOUNTS NOW. This docblock used to say they never would — "they are a token
 * in a URL, which is the whole reason an outside contractor needs no onboarding". The token path
 * still works and is still the only door anyone has actually walked through; it is removed once a
 * human has signed in the new way and said so.
 *
 * ⚠️ THE BROWSER STILL NEVER TALKS TO SUPABASE. The usual Supabase Auth setup runs a client in the
 * page with `NEXT_PUBLIC_SUPABASE_URL` and the anon key, which would put both into the bundle and
 * break a property this repo actively tests for (the canary grep over `.next/static`). Instead the
 * sign-in form posts to our own route, that route calls Supabase's token endpoint server-side, and
 * the tokens live in httpOnly cookies the page script cannot read. There are still zero
 * `NEXT_PUBLIC_` variables in this app.
 *
 * ⚠️ AND VALIDATION IS DONE BY SUPABASE, NOT BY US. `currentUser()` spends a round trip on
 * `/auth/v1/user` rather than verifying the JWT locally. Verifying locally would mean holding the
 * project's JWT secret — and that secret also signs `service_role` tokens, so an app holding it has
 * service_role in all but name. One HTTP call on a founder-only dashboard is a cheap way not to
 * hold that. It also means a revoked or expired session stops working immediately rather than
 * whenever our own clock says so.
 */

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY

export const AT_COOKIE = 'rvr_at'
export const RT_COOKIE = 'rvr_rt'

/**
 * ⚠️ ROLES GATE THE SURFACE; ASSIGNMENTS DECIDE WHAT IS ON IT. `admin` is a superset of
 * `reviewer` — an admin may open the reviewer surface and sees the videos assigned to THEM, which
 * for an admin with no assignments is an empty list. One person can be both without `role` ever
 * holding two values: Rafi is the admin AND the only reviewer, and he appears on `equals-reel`
 * because a `video_reviewers` row says so, not because of anything in his profile.
 */
export type Role = 'admin' | 'tester' | 'reviewer'
export type Profile = { user_id: string; role: Role; name: string }

function config(): { url: string; anon: string } {
  if (!URL_ || !ANON) throw new Error('auth env missing: set SUPABASE_URL and SUPABASE_ANON_KEY')
  return { url: URL_, anon: ANON }
}

/** The signed-in user, or null. Authoritative: Supabase decides, not us. */
export async function currentUser(): Promise<{ id: string; email: string; accessToken: string } | null> {
  const token = (await cookies()).get(AT_COOKIE)?.value
  if (!token) return null
  const { url, anon } = config()
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const u = (await res.json()) as { id?: string; email?: string }
  if (!u.id) return null
  return { id: u.id, email: u.email ?? '', accessToken: token }
}

/**
 * The signed-in user's profile row.
 *
 * ⚠️ READ AS THE USER, NOT AS `service_role`. This deliberately does NOT use the service key: it
 * sends the user's own access token, so the row comes back because the `profiles_read_own` policy
 * allowed it. Reading it with service_role would work identically whether the policies were
 * correct or absent — the app would be doing the authorising and RLS would be decoration.
 */
export async function currentProfile(): Promise<Profile | null> {
  const user = await currentUser()
  if (!user) return null
  const { url, anon } = config()
  const res = await fetch(
    `${url}/rest/v1/profiles?select=user_id,role,name&user_id=eq.${user.id}&limit=1`,
    {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${user.accessToken}`,
        'Accept-Profile': SCHEMA,
      },
      cache: 'no-store',
    },
  )
  if (!res.ok) return null
  const rows = (await res.json()) as Profile[]
  return rows[0] ?? null
}

/**
 * Gate a page.
 *
 * ⚠️ TWO DIFFERENT ANSWERS ON PURPOSE, and the difference is who is asking:
 *   • signed OUT           → the login page. Admins and testers are EXPECTED here; hiding the door
 *                            from someone who is supposed to walk through it is not security, it
 *                            is a support ticket.
 *   • signed in, wrong role → 404, exactly as if the route did not exist. A tester does not need to
 *                            learn that `/admin` is a real page they are not allowed into, and
 *                            neither does a reviewer.
 */
export async function requireRole(...allowed: Role[]): Promise<Profile> {
  const profile = await currentProfile()
  if (!profile) redirect('/login')
  if (!allowed.includes(profile.role)) notFound()
  return profile
}

/**
 * The same gate for ROUTE HANDLERS, and it must not behave like the page one.
 *
 * ⚠️ `requireRole()` REDIRECTS a signed-out caller to /login. That is right for a page and wrong
 * for an endpoint: a POST from a signed-out client would follow the redirect and come back **200
 * with a login page in the body**, which reads as success to anything checking a status code. It
 * did exactly that — a tester's write was rejected by RLS underneath, but the route answered 200.
 *
 * Returns the profile, or a 404 Response to return as-is. 404 not 403, for the same reason as
 * everywhere else here: nothing confirms the endpoint exists to someone who should not have it.
 */
export async function requireRoleApi(...allowed: Role[]): Promise<{ profile: Profile } | { deny: Response }> {
  const profile = await currentProfile()
  if (!profile || !allowed.includes(profile.role)) {
    return { deny: new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }) }
  }
  return { profile }
}
