import { NextResponse } from 'next/server'

/**
 * Liveness, plus one configuration fact.
 *
 * ⚠️ BOOLEANS ONLY, NEVER VALUES. `auth_configured` says whether the two variables sign-in needs
 * are PRESENT, not what they are. It exists because the login route deliberately gives the same
 * `?error=1` for a wrong password and for a missing environment variable — that sameness is what
 * stops it being an account-enumeration oracle, and it also makes "did the env var get set?"
 * unanswerable from outside. This answers exactly that one question and nothing else.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      auth_configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
