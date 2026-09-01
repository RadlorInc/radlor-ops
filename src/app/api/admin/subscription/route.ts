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

/**
 * ⚠️ EVERY REJECTION NAMES ITS FIELD AND ITS REASON. The first version answered every failure with
 * "That did not save. Check the numbers and try again." — a message that cannot distinguish its own
 * causes, which is the exact defect this codebase has spent the week eliminating everywhere else.
 * It hid at least two unrelated things: a duplicate tool name, and a number typed with a comma.
 *
 * ⚠️ AND THE BOUND WAS NEVER THE PROBLEM. `credits_remaining` is `numeric(14,2)` — a trillion — and
 * there is no smallint anywhere in this schema. `19973` was always a legal value. Do not "widen"
 * these columns; the failure was the message.
 */
const LIMITS = { monthly_cost: 99_999_999, credits_remaining: 999_999_999_999 } as const

/** People type `19,973` and `1 250`. A form that refuses a thousands separator is refusing the way
 *  humans write numbers, and then blaming them for it. */
function parseNumber(raw: unknown): number | null | 'bad' {
  if (raw === '' || raw === null || raw === undefined) return null
  const cleaned = String(raw).replace(/[,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 'bad'
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 'bad'
}

function clean(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const str = (k: string, max: number) => {
    const v = body[k]
    if (typeof v === 'string') out[k] = v.trim().slice(0, max) || null
  }
  str('tool', 80)
  str('plan', 80)
  if (typeof body.renewal_date === 'string') out.renewal_date = body.renewal_date.trim() || null

  const LABEL = { monthly_cost: 'Monthly cost', credits_remaining: 'Credits remaining' } as const
  for (const k of ['monthly_cost', 'credits_remaining'] as const) {
    if (!(k in body)) continue
    const n = parseNumber(body[k])
    if (n === 'bad') return { message: `${LABEL[k]} must be a number — digits, and a decimal point if you need one.` }
    if (n !== null && n < 0) return { message: `${LABEL[k]} cannot be negative.` }
    if (n !== null && n > LIMITS[k]) return { message: `${LABEL[k]} must be under ${LIMITS[k].toLocaleString()}.` }
    out[k] = n
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
  const { out, message } = clean(body)
  if (message) return NextResponse.json({ message }, { status: 400 })
  if (!out!.tool) return NextResponse.json({ message: 'Give the tool a name.' }, { status: 400 })

  try {
    const [sub] = await insertSubscription(out!)
    return NextResponse.json({ subscription: sub }, { status: 201 })
  } catch (e) {
    /**
     * ⚠️ THE UNIQUE VIOLATION IS THE ONE THAT ACTUALLY BIT. `tool` is unique, so adding a tool that
     * already exists threw an unhandled error and answered **500 with an empty body** — and because
     * there was no EDIT control on the table, re-adding was the only way anyone could try to update
     * a credit balance. Two defects producing one baffling message. The edit control now exists;
     * this says so rather than failing blankly.
     */
    const detail = e instanceof Error ? e.message : ''
    if (/23505|duplicate key/i.test(detail)) {
      return NextResponse.json(
        { message: `There is already a row for “${out!.tool}”. Edit that one instead of adding it again.` },
        { status: 409 },
      )
    }
    throw e
  }
}

export async function PATCH(req: Request) {
  const gate = await requireRoleApi('admin')
  if ('deny' in gate) return gate.deny
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'no_id' }, { status: 400 })
  const { out, message } = clean(body)
  if (message) return NextResponse.json({ message }, { status: 400 })
  delete out!.tool // the unique key is not editable from here; add a new row instead
  await patchSubscription(id, out!)
  return NextResponse.json({ ok: true })
}
