import { NextResponse } from 'next/server'
import { callerKey, overLimit } from '../../_rateLimit'
import { HOME, currentProfile, currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

/** Sets the signed-in person's password — the second half of an invite or a reset. */
export async function POST(req: Request) {
  if (overLimit(callerKey(req, 'password'), 10, 60_000)) return seeOther('/set-password?error=rate')
  const user = await currentUser()
  if (!user) return seeOther('/login?error=link')

  const form = await req.formData().catch(() => null)
  const password = String(form?.get('password') ?? '')
  const confirm = String(form?.get('confirm') ?? '')
  if (password.length < 8) return seeOther('/set-password?error=short')
  if (password !== confirm) return seeOther('/set-password?error=match')

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return seeOther('/set-password?error=1')
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: anon, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    cache: 'no-store',
  }).catch(() => null)
  if (!res || !res.ok) return seeOther('/set-password?error=1')

  const profile = await currentProfile()
  return seeOther(profile ? HOME[profile.role] : '/login?error=norole')
}
