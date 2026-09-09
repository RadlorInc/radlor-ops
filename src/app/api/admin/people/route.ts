import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireRoleApi } from '@/lib/session'
import { listProfiles } from '@/lib/adminDb'
import { TAGS, setApprover } from '@/lib/db'

/**
 * WHO APPROVES OR REJECTS. `PATCH { user_id, can_approve }`, admin only. Any number of people may
 * hold it; each new cut is sent to all of them and clears only when all have approved.
 *
 * ⚠️ REVIEWERS AND ADMINS ONLY. A tester cannot open /review, so flagging one would put the
 * decision on somebody who cannot reach the page — the same reason the old upload picker never
 * listed testers. The target is read back through the admin's own session (RLS decides what they
 * can see) before anything is written with the service key.
 *
 * ⚠️ THIS DOES NOT TOUCH CUTS ALREADY OUT. The flag says who is named on the NEXT upload; the
 * `video_reviewers` row says who answers on a cut that exists. See the migration.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as { user_id?: unknown; can_approve?: unknown } | null
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!userId || typeof body?.can_approve !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const target = (await listProfiles()).find((p) => p.user_id === userId)
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (target.role === 'tester') return NextResponse.json({ error: 'not_a_reviewer' }, { status: 400 })

  await setApprover(userId, body.can_approve)
  // The upload form and the People list read the flag through `listProfiles` (uncached, as the
  // user); the admin's reviewer-name map reads `profiles` through the `reviewers` tag.
  revalidateTag(TAGS.reviewers, { expire: 0 })
  return NextResponse.json({ ok: true })
}
