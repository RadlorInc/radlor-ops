import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../../_rateLimit'

export const dynamic = 'force-dynamic'

function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

/**
 * "Forgot your password?" ⚠️ ONE ANSWER FOR EVERY ADDRESS. Known or unknown, malformed or
 * rate-limited by Supabase, the person sees the same "if that address has an account, a link is
 * on its way" — a different answer for "unknown" is a way to enumerate who has an account. The
 * limiter is the only thing that says anything different, and it says it to a flood, not a person.
 */
export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'forgot'), 5, 60_000)) return seeOther('/forgot?error=rate')
  const form = await req.formData().catch(() => null)
  const email = String(form?.get('email') ?? '').trim().toLowerCase().slice(0, 254)
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (email && url && anon) {
    await fetch(`${url}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    }).catch(() => null)
  }
  return seeOther('/forgot?sent=1')
}
