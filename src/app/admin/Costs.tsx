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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Date(today)

  const total = rows.reduce((s, r) => s + Number(r.monthly_cost ?? 0), 0)

  async function add() {
    if (!form.tool.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      const { subscription } = await res.json()
      setRows((xs) => [...xs, subscription])
      setForm(BLANK)
      setAdding(false)
    } catch {
      setError('That did not save. Check the numbers and try again.')
    } finally {
      setBusy(false)
    }
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
                  <td>{r.tool}</td>
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

      {adding ? (
        <div className="addrow" data-testid="cost-form">
          {(['tool', 'plan', 'renewal_date', 'monthly_cost', 'credits_remaining'] as const).map((k) => (
            <input
              key={k}
              type={k === 'renewal_date' ? 'date' : k.includes('cost') || k.includes('credits') ? 'number' : 'text'}
              placeholder={k.replace(/_/g, ' ')}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              data-testid={`cost-${k}`}
            />
          ))}
          <button onClick={add} disabled={busy || !form.tool.trim()} data-testid="cost-save">
            Save
          </button>
          <button className="ghost" onClick={() => setAdding(false)}>
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
