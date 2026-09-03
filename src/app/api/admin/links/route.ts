import { NextResponse } from 'next/server'
import { createUser, insertProfile, newInviteLink, userEmail } from '@/lib/db'
import { requireRoleApi } from '@/lib/session'
import { hashToken, mintToken } from '@/lib/inviteToken'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['admin', 'tester', 'reviewer'])
/** A week to open your link. Long enough for a forward to sit in a WhatsApp thread over a weekend,
 *  short enough that a leaked list of links is not a permanent way in. */
const DAYS = 7
const MAX_EMAILS = 200

/**
 * Makes the links the admin sends to the tester head.
 *
 * Two shapes, one route:
 *   • `{ emails: [...], role }` — the bulk case. One Supabase Auth user per address, WITH NO
 *     PASSWORD, plus its role row, plus one link each. The reply is `email → /join/<token>` lines
 *     for the admin to copy in one block.
 *   • `{ user_id }` — one fresh link for somebody who already has an account, which is the whole
 *     of "I forgot my password" now that nothing is emailed.
 *
 * ⚠️ THE RAW TOKEN IS RETURNED AND NEVER STORED. This response is the only time it exists; the
 * table holds sha256 of it. An admin who loses the block presses the button again, which also
 * kills the link they lost (see `newInviteLink`).
 *
 * ⚠️ THE ROUTE RETURNS A PATH, NOT A URL. The client prefixes `location.origin`, so a link copied
 * from a preview deployment points at that deployment rather than at whatever origin the server
 * happened to think it was — the same reason `/api/auth/login` redirects relatively.
 *
 * ⚠️ ONE BAD ADDRESS DOES NOT LOSE THE OTHER FORTY. Each email is its own try/catch and its own
 * line in `skipped`, because the input is a list somebody pasted and it will contain a typo, a
 * duplicate, and someone who already has an account.
 */
export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as
    | { emails?: unknown; role?: unknown; user_id?: unknown }
    | null

  // The "one more link for a person who already exists" shape.
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (userId) {
    const token = mintToken()
    let email: string
    try {
      email = await userEmail(userId)
      await newInviteLink(userId, hashToken(token), DAYS)
    } catch {
      return NextResponse.json({ error: 'link' }, { status: 502 })
    }
    return NextResponse.json({ links: [{ email, path: `/join/${token}` }], skipped: [] })
  }

  const role = String(body?.role ?? '')
  const raw = Array.isArray(body?.emails) ? body.emails : []
  if (!ROLES.has(role) || raw.length === 0 || raw.length > MAX_EMAILS) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const links: { email: string; path: string }[] = []
  const skipped: { email: string; why: string }[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    const email = String(entry ?? '').trim().toLowerCase().slice(0, 254)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ email: email || String(entry ?? ''), why: 'not an email address' })
      continue
    }
    if (seen.has(email)) continue
    seen.add(email)

    let id: string
    try {
      // ⚠️ The auth user FIRST, then the role row — the same order the invite route used, and for
      // the same reason: the failure it leaves behind is a person with no role, who is told to ask
      // Rafi, rather than a role handed to a user id that does not exist.
      ;({ id } = await createUser(email, nameFrom(email)))
    } catch (e) {
      skipped.push({ email, why: e instanceof Error && e.message === 'exists' ? 'already has an account' : 'could not be added' })
      continue
    }
    try {
      await insertProfile({ user_id: id, role: role as 'admin' | 'tester' | 'reviewer', name: nameFrom(email) })
      const token = mintToken()
      await newInviteLink(id, hashToken(token), DAYS)
      links.push({ email, path: `/join/${token}` })
    } catch {
      skipped.push({ email, why: 'added, but the link failed — press again' })
    }
  }

  return NextResponse.json({ links, skipped })
}

/** ponytail: the name is the address's local part, tidied. The admin pastes EMAILS and nothing
 *  else — that was the ask — so this is the only name there is until somebody wants a field for it.
 *  Upgrade path: let the person type their real name on the join page and PATCH the profile there. */
function nameFrom(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return (local || email).slice(0, 120)
}
