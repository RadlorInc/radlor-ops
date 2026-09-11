import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireRoleApi } from '@/lib/session'
import { listProfiles } from '@/lib/adminDb'
import { TAGS, deleteUser, setApprover, setRole, type Role } from '@/lib/db'

/**
 * THE PEOPLE TAB'S WRITES. `PATCH` changes what somebody is; `DELETE` removes them entirely.
 *
 * ⚠️ TWO DIFFERENT BARS, AND THE DIFFERENCE IS WHETHER IT CAN BE UNDONE. Any admin may change a
 * role — they can already mint a brand-new admin from the paste box, so withholding the smaller
 * power while granting the larger one would be theatre. Removing a person destroys their notes and
 * their verdicts by cascade and cannot be undone by anybody, so it is the OWNER's alone
 * (`profiles.is_owner`, a column no route can write — see 20260910110000). Rafi, 2026-09-10.
 *
 * ⚠️ "NEVER YOUR OWN ROW" IS ALSO WHAT KEEPS AN ADMIN IN EXISTENCE, and that is worth spelling out
 * because the obvious guard — "refuse the change that leaves zero admins" — was written here first
 * and then deleted as UNREACHABLE. The caller is always an admin (`requireRoleApi('admin')`) and
 * may never target their own row, so any admin being demoted or removed is a SECOND admin: the
 * count is at least two before the write and at least one after it, always. A guard that cannot
 * fire is worse than no guard, because it reads as the protection and is never exercised by
 * anything. The invariant is real; the code enforcing it is the not-yourself rule, one screen down.
 *
 * There is no recovery inside the product if that ever stops holding: /admin would answer 404 to
 * every account that exists, and the way back is a SQL statement somebody has to know to run.
 */
export const dynamic = 'force-dynamic'

const ROLES = new Set(['admin', 'tester', 'reviewer', 'teacher'])
/** ⚠️ WHO CAN OPEN /review, AND SO WHO CAN BE ASKED FOR A VERDICT. Named positively: see below. */
const CAN_REVIEW = new Set(['reviewer', 'admin'])

export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const body = (await req.json().catch(() => null)) as
    | { user_id?: unknown; can_approve?: unknown; role?: unknown }
    | null
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!userId) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  // Read as the admin, through RLS, before anything is written with the service key.
  const people = await listProfiles()
  const target = people.find((p) => p.user_id === userId)
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ── who approves ────────────────────────────────────────────────────────────────────────────
  if (typeof body?.can_approve === 'boolean') {
    // A decision parked on somebody with no reviewer surface is a decision nobody can make.
    // ⚠️ A POSITIVE LIST. This read `target.role === 'tester'` until 2026-09-11 — which a teacher
    // passes. Naming who MAY means the next role added is refused until somebody decides otherwise.
    if (!CAN_REVIEW.has(target.role)) return NextResponse.json({ error: 'not_a_reviewer' }, { status: 400 })
    await setApprover(userId, body.can_approve)
    revalidateTag(TAGS.reviewers, { expire: 0 })
    return NextResponse.json({ ok: true })
  }

  // ── what they are ───────────────────────────────────────────────────────────────────────────
  if (typeof body?.role === 'string') {
    const role = body.role
    if (!ROLES.has(role)) return NextResponse.json({ error: 'bad_role' }, { status: 400 })
    if (role === target.role) return NextResponse.json({ ok: true, changed: false })

    /**
     * ⚠️ NOT YOUR OWN. An admin demoting themselves is one click from being unable to undo it, and
     * the click is next to five others. Somebody else can always do it for them, which is both the
     * check and the paper trail.
     */
    if (userId === gate.profile.user_id) return NextResponse.json({ error: 'not_yourself' }, { status: 400 })
    // The owner holds the only control that can destroy people. Demoting them out of /admin would
    // strand that control behind a door its holder cannot open.
    if (target.is_owner) return NextResponse.json({ error: 'owner' }, { status: 400 })

    await setRole(userId, role as Role)
    /**
     * ⚠️ AN APPROVER WHO IS NOW A TESTER WOULD BE ASKED FOR VERDICTS THEY CANNOT GIVE. `can_approve`
     * is a property of a person who can open /review; demotion to tester takes that away, so the
     * flag has to come off in the same act. Leaving it would put every new cut in front of somebody
     * whose surface 404s, and nothing would ever clear.
     */
    if (!CAN_REVIEW.has(role) && target.can_approve) await setApprover(userId, false)
    revalidateTag(TAGS.reviewers, { expire: 0 })
    return NextResponse.json({ ok: true, changed: true })
  }

  return NextResponse.json({ error: 'invalid' }, { status: 400 })
}

/**
 * REMOVE A PERSON. The owner's button, and it takes their work with them.
 *
 * ⚠️ THE OWNER CHECK IS HERE, NOT ONLY IN THE INTERFACE. People.tsx renders no Remove control for
 * anybody else, which is the dashboard being tidy — this is the rule. An admin who is not the
 * owner gets the same 404 the route gives a stranger: nothing confirms that a control they cannot
 * use exists.
 */
export async function DELETE(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const people = await listProfiles()
  const me = people.find((p) => p.user_id === gate.profile.user_id)
  if (!me?.is_owner) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { user_id?: unknown } | null
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  const target = people.find((p) => p.user_id === userId)
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // The owner cannot remove themselves, and no owner can remove another. The account that holds
  // this button is the one account the product must not be able to destroy.
  if (target.is_owner) return NextResponse.json({ error: 'owner' }, { status: 400 })
  // No "last admin" check, for the reason at the top: the caller is an admin and is not the target,
  // so an admin always remains. See the header before adding one back.

  await deleteUser(userId)
  // Their notes and verdicts went with them by cascade, so both of those lists are now wrong.
  revalidateTag(TAGS.reviewers, { expire: 0 })
  revalidateTag(TAGS.notes, { expire: 0 })
  revalidateTag(TAGS.assignments, { expire: 0 })
  return NextResponse.json({ ok: true })
}
