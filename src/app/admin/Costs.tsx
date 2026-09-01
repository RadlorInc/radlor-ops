'use client'

import { useState } from 'react'
import type { Subscription } from '@/lib/adminDb'
import { freshness, renewalLabel, renewalState } from '@/lib/renewal'

const BLANK = { tool: '', plan: '', renewal_date: '', monthly_cost: '', credits_remaining: '' }

/**
 * The hand-edited costs table. It answers "what lapses next" and "what does this cost a month"
 * without any provider integration at all, which is most of the value and works for the providers
 * that expose nothing.
 *
 * ⚠️ EVERY NUMBER CARRIES WHEN IT WAS LAST TOUCHED, and typed numbers say so in those words. A
 * stale number presented as live is worse than one labelled "you typed this 6d ago".
 */
export default function Costs({ initial, today }: { initial: Subscription[]; today: string }) {
  const [rows, setRows] = useState(initial)
  const [form, setForm] = useState(BLANK)
  const [adding, setAdding] = useState(false)
  /** ⚠️ EDITING EXISTED IN THE API AND NOT IN THE UI, so the only way to change a credit balance
   *  was to re-add the tool — which hit the unique constraint and answered 500. The brief said
   *  "a table I edit by hand"; this is that half. */
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Date(today)

  const total = rows.reduce((s, r) => s + Number(r.monthly_cost ?? 0), 0)

  /** The server names the field and the reason; showing anything else here throws that away. */
  async function send(method: 'POST' | 'PATCH', body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/subscription', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        setError(data.message ?? 'That did not save.')
        return null
      }
      return data as Record<string, unknown>
    } catch {
      setError('Could not reach the server. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!form.tool.trim()) return
    const data = await send('POST', form)
    if (!data) return
    setRows((xs) => [...xs, data.subscription as Subscription])
    setForm(BLANK)
    setAdding(false)
  }

  async function saveEdit(row: Subscription) {
    const data = await send('PATCH', { id: row.id, ...form })
    if (!data) return
    setRows((xs) =>
      xs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              plan: form.plan || null,
              renewal_date: form.renewal_date || null,
              monthly_cost: form.monthly_cost === '' ? null : String(Number(form.monthly_cost.replace(/[,\s]/g, ''))),
              credits_remaining:
                form.credits_remaining === '' ? null : String(Number(form.credits_remaining.replace(/[,\s]/g, ''))),
              credits_source: 'manual',
              last_updated: new Date().toISOString(),
            }
          : r,
      ),
    )
    setEditing(null)
    setForm(BLANK)
  }

  function startEdit(r: Subscription) {
    setEditing(r.id)
    setAdding(false)
    setError(null)
    setForm({
      tool: r.tool,
      plan: r.plan ?? '',
      renewal_date: r.renewal_date ?? '',
      monthly_cost: r.monthly_cost ?? '',
      credits_remaining: r.credits_remaining ?? '',
    })
  }

  return (
    <section>
      <h2>
        Costs and renewals{' '}
        <span className="muted small" data-testid="monthly-total">
          (£/$ {total.toFixed(2)} a month across {rows.length})
        </span>
      </h2>

      {rows.length === 0 ? (
        <p className="muted small" data-testid="costs-empty">
          Nothing here yet. Add what you pay for — tool, plan, renewal date, monthly cost — and this
          answers what lapses next.
        </p>
      ) : (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Plan</th>
              <th>Renews</th>
              <th>Monthly</th>
              <th>Credits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const state = renewalState(r.renewal_date, now)
              return (
                <tr key={r.id} data-testid="cost-row" data-renewal={state}>
                  <td>
                    {r.tool}
                    <div>
                      <button className="linky small" onClick={() => startEdit(r)} data-testid="cost-edit">
                        edit
                      </button>
                    </div>
                  </td>
                  <td className="muted small">{r.plan ?? '—'}</td>
                  <td>
                    <span className={`pill pill-${state}`} data-testid="renewal-pill">
                      {renewalLabel(r.renewal_date, now)}
                    </span>
                    {r.renewal_date && <div className="muted small">{r.renewal_date}</div>}
                  </td>
                  <td>{r.monthly_cost === null ? '—' : Number(r.monthly_cost).toFixed(2)}</td>
                  <td>
                    {r.credits_remaining === null ? (
                      '—'
                    ) : (
                      <>
                        {Number(r.credits_remaining).toLocaleString()}
                        <div className="muted small" data-testid="credits-freshness">
                          {freshness(r.last_updated, r.credits_source, now)}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {adding || editing ? (
        <div className="addrow" data-testid="cost-form">
          {(['tool', 'plan', 'renewal_date', 'monthly_cost', 'credits_remaining'] as const).map((k) => (
            <input
              key={k}
              /* ⚠️ `text`, not `number`, for the money fields. A number input silently drops a
                 thousands separator in some browsers and refuses it in others, so the value the
                 server sees is not the value the person typed. The route parses commas itself. */
              type={k === 'renewal_date' ? 'date' : 'text'}
              inputMode={k.includes('cost') || k.includes('credits') ? 'decimal' : undefined}
              placeholder={k.replace(/_/g, ' ')}
              value={form[k]}
              disabled={editing !== null && k === 'tool'}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              data-testid={`cost-${k}`}
            />
          ))}
          <button
            onClick={() => (editing ? saveEdit(rows.find((r) => r.id === editing)!) : add())}
            disabled={busy || !form.tool.trim()}
            data-testid="cost-save"
          >
            Save
          </button>
          <button className="ghost" onClick={() => { setAdding(false); setEditing(null); setForm(BLANK); setError(null) }}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)} data-testid="cost-add">
          Add a subscription
        </button>
      )}
      {error && <p className="small" style={{ color: '#ff9d9d' }} data-testid="cost-error">{error}</p>}
    </section>
  )
}
