import { NextResponse } from 'next/server'
import { AT_COOKIE, RT_COOKIE } from '@/lib/session'

/** Clears the session cookies. POST only: a GET would let any page log you out with an <img>. */
export const dynamic = 'force-dynamic'

export async function POST() {
  // Relative Location, for the same reason as the login route: `req.url`'s host is not necessarily
  // the host the browser is on, and a cross-host redirect drops the cookies being cleared.
  const out = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  for (const name of [AT_COOKIE, RT_COOKIE]) out.cookies.set(name, '', { path: '/', maxAge: 0 })
  return out
}
