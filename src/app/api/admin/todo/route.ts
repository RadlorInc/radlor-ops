import { NextResponse } from 'next/server'
import { insertTodo, listTodos, patchTodo } from '@/lib/adminDb'
import { requireRoleApi } from '@/lib/session'

/**
 * The four actions the sheet earned: add, edit, mark done, reorder. Nothing else — no assignment,
 * no due dates, no comments, no subtasks. The sheet had `Go-Live Task` and `Status` and nothing
 * more; a column it never had has not earned its place.
 *
 * ⚠️ THERE IS NO DELETE, AND THAT IS DELIBERATE. It is not in the four actions, the table has no
 * DELETE grant and no DELETE policy, so this route could not erase a line item even if it tried.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const task = typeof body.task === 'string' ? body.task.trim().slice(0, 300) : ''
  const area = typeof body.area === 'string' && body.area.trim() ? body.area.trim().slice(0, 40) : null
  if (!task) return NextResponse.json({ error: 'empty_task' }, { status: 400 })

  // New items go to the end. Ordering is explicit because row position was real ordering in the
  // sheet and would otherwise have been lost.
  const existing = await listTodos()
  const sort_order = existing.reduce((m, t) => Math.max(m, t.sort_order), -1) + 1
  const [todo] = await insertTodo({ task, area, sort_order })
  return NextResponse.json({ todo }, { status: 201 })
}

const STATUSES = new Set(['not_started', 'in_progress', 'done'])

export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'no_id' }, { status: 400 })

  const items = await listTodos()
  const me = items.find((t) => t.id === id)
  if (!me) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // --- reorder: swap sort_order with the neighbour, so the move is a fact about two rows ------
  if (body.move === 'up' || body.move === 'down') {
    const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order)
    const i = ordered.findIndex((t) => t.id === id)
    const j = body.move === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= ordered.length) return NextResponse.json({ ok: true, moved: false })
    const other = ordered[j]
    await patchTodo(me.id, { sort_order: other.sort_order })
    await patchTodo(other.id, { sort_order: me.sort_order })
    return NextResponse.json({ ok: true, moved: true })
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.task === 'string' && body.task.trim()) patch.task = body.task.trim().slice(0, 300)
  if (typeof body.status === 'string') {
    // Whitelisted, not forwarded. The CHECK constraint would catch a bad value, but a route that
    // passes through whatever it is handed relies on the database to be its input validation.
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: 'bad_status' }, { status: 400 })
    patch.status = body.status
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_do' }, { status: 400 })

  await patchTodo(id, patch)
  return NextResponse.json({ ok: true })
}
