import { NextResponse } from 'next/server'
import { insertSubscription, patchSubscription } from '@/lib/adminDb'
import { requireRoleApi } from '@/lib/session'

/**
 * The hand-edited costs table: tool, plan, renewal date, monthly cost, credits remaining.
 *
 * ⚠️ NO FIELD HERE CAN HOLD AN API KEY, and none ever should. If a provider's balance is ever
 * refreshed automatically, the key lives in the environment and only the NUMBER it returns is
 * written — with `credits_source: 'api'` so the page can say where it came from.
 */
export const dynamic = 'force-dynamic'

function clean(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const str = (k: string, max: number) => {
    const v = body[k]
    if (typeof v === 'string') out[k] = v.trim().slice(0, max) || null
  }
  str('tool', 80)
  str('plan', 80)
  if (typeof body.renewal_date === 'string') out.renewal_date = body.renewal_date.trim() || null
  for (const k of ['monthly_cost', 'credits_remaining']) {
    const v = body[k]
    if (v === '' || v === null) out[k] = null
    else if (v !== undefined) {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return { error: `bad_${k}` }
      out[k] = n
    }
  }
  // Anything typed by hand is `manual`, always. Only a provider call may claim `api`, and this
  // route is not one.
  out.credits_source = 'manual'
  return { out }
}

export async function POST(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { out, error } = clean(body)
  if (error) return NextResponse.json({ error }, { status: 400 })
  if (!out!.tool) return NextResponse.json({ error: 'no_tool' }, { status: 400 })
  const [sub] = await insertSubscription(out!)
  return NextResponse.json({ subscription: sub }, { status: 201 })
}

export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'no_id' }, { status: 400 })
  const { out, error } = clean(body)
  if (error) return NextResponse.json({ error }, { status: 400 })
  delete out!.tool // the unique key is not editable from here; add a new row instead
  await patchSubscription(id, out!)
  return NextResponse.json({ ok: true })
}
