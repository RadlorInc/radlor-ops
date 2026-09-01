import { NextResponse } from 'next/server'
import { insertIssue, patchIssue, touchSession } from '@/lib/adminDb'
import { requireRoleApi } from '@/lib/session'

/**
 * Filing an issue, and (admin only) moving its status.
 *
 * ⚠️ `reporter` IS TAKEN FROM THE SESSION, NEVER FROM THE BODY. The client cannot name who it is
 * filing as — and the `issues_insert_own` policy would refuse it anyway, which is the belt to this
 * braces.
 */
export const dynamic = 'force-dynamic'

const AGE_BANDS = new Set(['3-5', '6-8', '9-11', '12-14', '15-16', '17-18', 'any'])
const STATUSES = new Set(['open', 'ready_for_retest', 'resolved'])

export async function POST(req: Request) {
  const gate = await requireRoleApi('tester', 'admin')
  if ('deny' in gate) return gate.deny

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

  const description = str(b.description, 4000)
  if (!description) return NextResponse.json({ error: 'empty_description' }, { status: 400 })

  const age_band = typeof b.age_band === 'string' && AGE_BANDS.has(b.age_band) ? b.age_band : null
  const all_chapters = b.all_chapters === true
  // The constraint would catch this, but a route that lets the database be its input validation is
  // a route that reports a 400 as a 500.
  const chapter = all_chapters ? null : str(b.chapter, 40)

  const [issue] = await insertIssue({
    reporter: gate.profile.user_id,
    description,
    area: str(b.area, 60),
    type: str(b.type, 40),
    chapter,
    all_chapters,
    age_band,
  })

  // The Working Record, captured. Best-effort: a failure here must not lose the issue itself.
  await touchSession(gate.profile.user_id).catch(() => {})

  return NextResponse.json({ issue }, { status: 201 })
}

export async function PATCH(req: Request) {
  // ⚠️ ADMIN ONLY. A tester marking their own report resolved is how a retest queue stops meaning
  // anything — and `issues_admin_update` refuses it at the database too.
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id : ''
  const status = typeof b.status === 'string' && STATUSES.has(b.status) ? b.status : null
  if (!id) return NextResponse.json({ error: 'no_id' }, { status: 400 })
  if (!status) return NextResponse.json({ error: 'bad_status' }, { status: 400 })

  await patchIssue(id, { status })
  return NextResponse.json({ ok: true })
}
