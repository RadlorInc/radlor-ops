import { NextResponse } from 'next/server'
import { insertProfile, inviteUser } from '@/lib/db'
import { requireRoleApi } from '@/lib/session'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['admin', 'tester', 'reviewer'])

/**
 * Admin invites a person: Supabase creates the auth user and emails them a link; the role row is
 * written here, on the server, with the service key. The person confirms their address by
 * opening the link, which is also where they choose a password — see /auth/confirm.
 *
 * ⚠️ TWO WRITES, AND THE ORDER IS THE SAFE ONE. The auth user first, then the profile. If the
 * second fails the person exists with no role and login answers `norole` — visible, recoverable,
 * and honest. The other order would hand out a role to a user id that does not exist.
 */
export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { email?: unknown; name?: unknown; role?: unknown } | null
  const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 254)
  const name = String(body?.name ?? '').trim().slice(0, 120)
  const role = String(body?.role ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !ROLES.has(role)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  let id: string
  try {
    ;({ id } = await inviteUser(email, { name, role }))
  } catch (e) {
    if (e instanceof Error && e.message === 'exists') return NextResponse.json({ error: 'exists' }, { status: 409 })
    return NextResponse.json({ error: 'invite' }, { status: 502 })
  }
  try {
    await insertProfile({ user_id: id, role: role as 'admin' | 'tester' | 'reviewer', name })
  } catch {
    return NextResponse.json({ error: 'profile' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, user_id: id })
}
