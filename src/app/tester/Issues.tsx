'use client'

import { useState } from 'react'
import type { Issue } from '@/lib/adminDb'

const STATUS_LABEL: Record<Issue['status'], string> = {
  open: 'Open',
  ready_for_retest: 'Ready for retest',
  resolved: 'Resolved',
}
const AGE_BANDS = ['3-5', '6-8', '9-11', '12-14', '15-16', '17-18', 'any']

const BLANK = { description: '', area: '', type: '', chapter: '', all_chapters: false, age_band: '' }

/**
 * Filing an issue, and reading the ones you filed.
 *
 * ⚠️ THE DATE FIELD IS GONE ON PURPOSE. The sheet had testers typing it, in two different formats,
 * with one row missing it entirely. `created_at` is set on submit.
 *
 * ⚠️ SO IS THE HOURS FIELD. `Working Record` was empty from the day it was made — filing an issue
 * opens and extends a session by itself.
 */
export default function Issues({
  initial,
  canTriage,
  names = {},
  vocabulary = { areas: [], types: [] },
}: {
  initial: Issue[]
  canTriage: boolean
  /**
   * ⚠️ SUGGESTIONS, NOT A WHITELIST. `<datalist>` shows what people have already typed and still
   * accepts anything — which is the whole ask: make the existing value the EASY choice, not the
   * only one. A `<select>` here would be a restriction, and the first person with a genuinely new
   * area would be stuck or would put it in the description where nothing can group it.
   *
   * ⚠️ AND NOTHING REWRITES WHAT WAS TYPED. `measurrement` stays `measurrement` if somebody types
   * it past the suggestion; silently correcting a person's data teaches them the tool edits what
   * they wrote, which is a worse property than a typo. The list is how it stops happening, not a
   * cleanup that runs after it does.
   */
  vocabulary?: { areas: string[]; types: string[] }
  /** user_id → name, for the triager. A tester only ever sees their own issues, so they would be
   *  reading their own name back on every row. */
  names?: Record<string, string>
}) {
  const [items, setItems] = useState(initial)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | Issue['status']>('all')

  async function submit() {
    if (!form.description.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tester/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, age_band: form.age_band || null }),
      })
      if (!res.ok) throw new Error()
      const { issue } = await res.json()
      setItems((xs) => [issue, ...xs])
      setForm(BLANK)
    } catch {
      setError('That did not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(issue: Issue, status: Issue['status']) {
    setItems((xs) => xs.map((x) => (x.id === issue.id ? { ...x, status } : x)))
    const res = await fetch('/api/tester/issue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: issue.id, status }),
    })
    if (!res.ok) setItems((xs) => xs.map((x) => (x.id === issue.id ? { ...x, status: issue.status } : x)))
  }

  const shown = filter === 'all' ? items : items.filter((i) => i.status === filter)

  return (
    <>
      <section data-testid="issue-form">
        <h2>File an issue</h2>
        <textarea
          rows={4}
          value={form.description}
          maxLength={4000}
          placeholder="What happened, and what would be better?"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          data-testid="issue-description"
        />
        <div className="addrow">
          <input
            type="text"
            list="area-options"
            autoComplete="off"
            placeholder={vocabulary.areas.length ? 'area — pick or type' : 'area (e.g. Nest game)'}
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            data-testid="issue-area"
          />
          <datalist id="area-options" data-testid="area-options">
            {vocabulary.areas.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <input
            type="text"
            list="type-options"
            autoComplete="off"
            placeholder={vocabulary.types.length ? 'type — pick or type' : 'type (e.g. wording)'}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            data-testid="issue-type"
          />
          <datalist id="type-options" data-testid="type-options">
            {vocabulary.types.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <input
            type="text"
            placeholder="chapter"
            value={form.chapter}
            disabled={form.all_chapters}
            onChange={(e) => setForm({ ...form, chapter: e.target.value })}
            data-testid="issue-chapter"
          />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.all_chapters}
              onChange={(e) => setForm({ ...form, all_chapters: e.target.checked, chapter: '' })}
              data-testid="issue-all-chapters"
            />
            all chapters
          </label>
          <select
            value={form.age_band}
            onChange={(e) => setForm({ ...form, age_band: e.target.value })}
            data-testid="issue-age"
          >
            <option value="">age band…</option>
            {AGE_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button onClick={submit} disabled={busy || !form.description.trim()} data-testid="issue-submit">
            {busy ? 'Filing…' : 'File it'}
          </button>
        </div>
        {error && (
          <p className="small" style={{ color: '#ff9d9d' }} data-testid="issue-error">
            {error}
          </p>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>
          Issues <span className="muted small" data-testid="issue-count">({shown.length} of {items.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: 6, margin: '8px 0 12px', flexWrap: 'wrap' }}>
          {(['all', 'open', 'ready_for_retest', 'resolved'] as const).map((f) => (
            <button
              key={f}
              className="chip"
              onClick={() => setFilter(f)}
              style={filter === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              data-testid={`filter-${f}`}
            >
              {f === 'all' ? 'All' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        <ol className="issues" data-testid="issue-list">
          {shown.map((i) => (
            <li key={i.id} data-testid="issue-item" data-status={i.status}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {canTriage ? (
                  <select
                    className="chip"
                    value={i.status}
                    onChange={(e) => setStatus(i, e.target.value as Issue['status'])}
                    data-testid="issue-status"
                  >
                    {(Object.keys(STATUS_LABEL) as Issue['status'][]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="chip" data-testid="issue-status">
                    {STATUS_LABEL[i.status]}
                  </span>
                )}
                {i.area && <span className="area">{i.area}</span>}
                {i.type && <span className="area">type: {i.type}</span>}
                <span className="area">{i.all_chapters ? 'all chapters' : i.chapter ? `ch ${i.chapter}` : 'no chapter'}</span>
                {i.age_band && <span className="area">{i.age_band}</span>}
                {/* ⚠️ WHO FILED IT — carried over from the admin Issues tab when that page was
                    deleted as a duplicate of this one. It was the ONE thing that page had and this
                    one did not, and it is not decoration: triaging somebody else's issue without
                    knowing whose it is means you cannot go and ask them. `imported from the sheet`
                    is a real answer too — those rows have no reporter and never will. */}
                <span className="muted small" style={{ marginLeft: 'auto' }} data-testid="issue-reporter">
                  {canTriage && (i.reporter ? `${names[i.reporter] ?? 'a tester'} · ` : 'imported from the sheet · ')}
                  {i.created_at.slice(0, 10)}
                  {!canTriage && i.imported_from && ' · from the sheet'}
                </span>
              </div>
              <p style={{ margin: '6px 0 0' }}>{i.description}</p>
            </li>
          ))}
        </ol>
        {shown.length === 0 && <p className="muted small">Nothing here.</p>}
      </section>
    </>
  )
}
