import { NextResponse } from 'next/server'
import { AT_COOKIE, RT_COOKIE } from '@/lib/session'

/** Clears the session cookies. POST only: a GET would let any page log you out with an <img>. */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const out = NextResponse.redirect(new URL('/login', req.url), 303)
  for (const name of [AT_COOKIE, RT_COOKIE]) out.cookies.set(name, '', { path: '/', maxAge: 0 })
  return out
}
