'use client'

import { useState } from 'react'
import type { Subscription } from '@/lib/adminDb'
import { freshness, renewalLabel, renewalState } from '@/lib/renewal'

/**
 * The categorical slots, in fixed order, for the spend share bar. Six hues stepped for this dark
 * surface. ⚠️ VALIDATED, NOT EYEBALLED — `dataviz/scripts/validate_palette.js` against
 * `--surface #171922`: lightness band, chroma floor, colour-blind separation (worst adjacent
 * ΔE 8.4 protan) and 3:1 contrast all pass. Do not add a seventh by picking one that looks
 * different; re-run the validator or let it fold into Other.
 */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'] as const
const OTHER = '#5a6076'

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

  /**
   * Where the money goes, as one bar.
   *
   * ⚠️ COLOUR FOLLOWS THE TOOL, NOT ITS RANK. The slot is taken from the row's position in the
   * table's own order, so adding a cheaper tool does not repaint the ones already there — a reader
   * who has learned "Higgsfield is the blue one" stays right. Sorting by size and colouring by
   * rank is the same bug as recolour-on-filter.
   *
   * ⚠️ Anything past the sixth tool folds into one "Other" segment rather than getting a seventh
   * generated hue. A generated hue is indistinguishable from an existing one under colour-blind
   * vision, and this palette is validated for exactly these six.
   */
  const paid = rows.filter((r) => Number(r.monthly_cost ?? 0) > 0)
  const shown = paid.slice(0, SERIES.length)
  const rest = paid.slice(SERIES.length)
  const restTotal = rest.reduce((s, r) => s + Number(r.monthly_cost ?? 0), 0)
  const segments = [
    ...shown.map((r, i) => ({ key: r.id, name: r.tool, value: Number(r.monthly_cost), color: SERIES[i] })),
    ...(rest.length ? [{ key: 'other', name: `Other (${rest.length})`, value: restTotal, color: OTHER }] : []),
  ]
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)

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
      <h2>Costs and renewals</h2>

      {/* The one number this dashboard leads with. */}
      {/* ⚠️ `monthly-total` stays on the WHOLE figure, not on the caption beside it. Its spec
          asserts the number AND the count are in one element, which is the property that matters:
          "49.00" next to a stale "across 2" is exactly the bug worth failing on. Splitting them
          into two testids would have let each half pass separately. */}
      <p className="hero" data-testid="monthly-total">
        <span className="figure">£/$ {total.toFixed(2)}</span>
        <span className="unit">a month across {rows.length}</span>
      </p>

      {segments.length > 1 && (
        <>
          {/* ⚠️ `title` is the hover layer, deliberately native rather than a custom tooltip: it
              works on keyboard focus, in forced-colors, and needs no state. The segment sizes are
              the reading; the legend under it is what names them. */}
          <div className="sharebar" role="img" aria-label={`Share of the monthly bill: ${segments.map((x) => `${x.name} ${pct(x.value).toFixed(0)}%`).join(', ')}`}>
            {segments.map((x) => (
              <span
                key={x.key}
                style={{ width: `${pct(x.value)}%`, background: x.color }}
                title={`${x.name} — ${x.value.toFixed(2)} (${pct(x.value).toFixed(0)}%)`}
              />
            ))}
          </div>
          <ul className="legend" data-testid="spend-legend">
            {segments.map((x) => (
              <li key={x.key}>
                <span className="swatch" style={{ background: x.color }} />
                {x.name} <span className="amount">{x.value.toFixed(2)} · {pct(x.value).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.length === 0 ? (
        <p className="muted small" data-testid="costs-empty">
          Nothing here yet. Add what you pay for — tool, plan, renewal date, monthly cost — and this
          answers what lapses next.
        </p>
      ) : (
        <div className="tablewrap" tabIndex={0} role="region" aria-label="Subscriptions and renewals">
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
        </div>
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
