'use client'

import { useState } from 'react'
import type { Issue } from '@/lib/adminDb'

const LABEL: Record<Issue['status'], string> = {
  open: 'Open',
  ready_for_retest: 'Ready for retest',
  resolved: 'Resolved',
}
/** ⚠️ ORDER MATTERS AND IS NOT ALPHABETICAL. `Open` and `Ready for retest` are the two that need
 *  something from Rafi; `Ready for retest` in particular means somebody has to go and look, which is
 *  the whole point of the status, so it does not get buried under the resolved pile. */
const ORDER: Issue['status'][] = ['open', 'ready_for_retest', 'resolved']

export default function AdminIssues({
  initial,
  names,
}: {
  initial: Issue[]
  names: Record<string, string>
}) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function setStatus(issue: Issue, status: Issue['status']) {
    setBusy(true)
    setItems((xs) => xs.map((x) => (x.id === issue.id ? { ...x, status } : x)))
    const res = await fetch('/api/tester/issue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: issue.id, status }),
    })
    if (!res.ok) setItems((xs) => xs.map((x) => (x.id === issue.id ? { ...x, status: issue.status } : x)))
    setBusy(false)
  }

  const open = items.filter((i) => i.status !== 'resolved').length

  return (
    <section style={{ marginTop: 36 }}>
      <h2>
        Tester issues{' '}
        <span className="muted small" data-testid="issues-count">
          ({open} needing something of {items.length})
        </span>
      </h2>

      {ORDER.map((status) => {
        const group = items.filter((i) => i.status === status)
        if (group.length === 0) return null
        return (
          <details
            key={status}
            // Resolved starts collapsed; the two that need action start open.
            open={status !== 'resolved'}
            className="group"
            data-testid={`issue-group-${status}`}
          >
            <summary>
              {LABEL[status]} <span className="muted small">({group.length})</span>
            </summary>
            <ol className="issues">
              {group.map((i) => (
                <li key={i.id} data-testid="admin-issue" data-status={i.status}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="chip"
                      value={i.status}
                      disabled={busy}
                      onChange={(e) => setStatus(i, e.target.value as Issue['status'])}
                      data-testid="admin-issue-status"
                    >
                      {ORDER.map((s) => (
                        <option key={s} value={s}>
                          {LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <span className="area">
                      {i.all_chapters ? 'all chapters' : i.chapter ? `ch ${i.chapter}` : 'no chapter'}
                    </span>
                    {i.area && <span className="area">{i.area}</span>}
                    {i.type && <span className="area">type: {i.type}</span>}
                    {i.age_band && <span className="area">{i.age_band}</span>}
                    <span className="muted small" style={{ marginLeft: 'auto' }} data-testid="issue-reporter">
                      {/* ⚠️ NULL IS THE FACT, NOT A GAP TO FILL. The 13 imported rows predate
                          accounts; a placeholder name would be inventing an author. */}
                      {i.reporter ? (names[i.reporter] ?? 'a tester') : 'imported from the sheet'} ·{' '}
                      {i.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0' }}>{i.description}</p>
                </li>
              ))}
            </ol>
          </details>
        )
      })}
      {items.length === 0 && <p className="muted small">No issues filed yet.</p>}
    </section>
  )
}
