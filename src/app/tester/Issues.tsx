'use client'

import { useState } from 'react'
import type { Issue } from '@/lib/adminDb'

const STATUS_LABEL: Record<Issue['status'], string> = {
  open: 'Open',
  ready_for_retest: 'Fixed, check again',
  resolved: 'Resolved',
}
const AGE_BANDS = ['3-5', '6-8', '9-11', '12-14', '15-16', '17-18', 'any']
/**
 * The kinds of problem a tester can pick from. A FIXED list, by Rafi's call on 2026-09-03: the
 * field used to suggest whatever anybody had typed before, and read cold that looked like a
 * half-built dropdown — "pick one, or type your own" with nothing obvious to pick. A tester should
 * see the things that actually go wrong in a children's app and tap one; "Other…" opens a box for
 * the case the list did not think of, so the list is a menu and never a cage.
 */
const TYPES = [
  'Wording',
  'Wrong answer marked',
  'Too hard for the age',
  'Too easy for the age',
  'Sound or voice',
  'Pictures or layout',
  'Button does not work',
  'Slow or freezes',
  'App crashed',
  'Progress not saved',
  'Something missing',
]

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
}: {
  initial: Issue[]
  canTriage: boolean
  /** user_id → name, for the triager. A tester only ever sees their own issues, so they would be
   *  reading their own name back on every row. */
  names?: Record<string, string>
}) {
  const [items, setItems] = useState(initial)
  const [form, setForm] = useState(BLANK)
  const [typeOther, setTypeOther] = useState('')
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
        body: JSON.stringify({
          ...form,
          type: form.type === 'other' ? typeOther.trim() : form.type,
          age_band: form.age_band || null,
        }),
      })
      if (!res.ok) throw new Error()
      const { issue } = await res.json()
      setItems((xs) => [issue, ...xs])
      setForm(BLANK)
      setTypeOther('')
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
      <section className="card filecard" data-testid="issue-form">
        <h2>Tell us what you found</h2>
        <p className="muted small" style={{ margin: '0 0 14px' }}>
          Plain words are perfect. Say what happened and what would be better.
        </p>
        <label className="field">
          <span className="fieldname">What&apos;s your observation/feedback</span>
          <textarea
            rows={4}
            value={form.description}
            maxLength={4000}
            placeholder="e.g. The turtles are too close together to read the numbers"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="issue-description"
          />
        </label>
        <div className="fields">
          {/* ⚠️ NO SUGGESTION LIST ON `area`, AND THAT IS A DECISION, NOT AN OVERSIGHT. It had one
              for a day. Rafi's call on 2026-09-03: an area is whatever part of the app the person
              was looking at, and offering a list makes the listed answers feel like the allowed
              ones — people reach for the nearest option instead of naming what they actually saw.
              The cost is accepted: `measurement` and `Measurement` will both exist and grouping by
              area will be approximate. Do not put it back citing convergence; that trade was made
              with the split in front of him. */}
          <label className="field">
            <span className="fieldname">Where in the app?</span>
            <input
              type="text"
              placeholder="e.g. Nest game"
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              data-testid="issue-area"
            />
          </label>
          <label className="field">
            <span className="fieldname">What kind of problem?</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              data-testid="issue-type"
            >
              <option value="">choose…</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          {form.type === 'other' && (
            <label className="field">
              <span className="fieldname">What kind, in your words?</span>
              <input
                type="text"
                autoFocus
                placeholder="e.g. the timer runs too fast"
                value={typeOther}
                onChange={(e) => setTypeOther(e.target.value)}
                data-testid="issue-type-other"
              />
            </label>
          )}
          {/**
            * ⚠️ THE MECHANISM WAS ALWAYS RIGHT; THE WORDING WAS THE BUG. Ticking has always cleared
            * and disabled the chapter box, and the route has always forced `chapter` to null — both
            * checked. Rafi still filed "the app is lagging" against `ch 1`, which is the definition
            * of an all-chapters issue, because the control was an unlabelled box with the words
            * "all chapters" floating beside it. Read cold that is a SCOPE FILTER, not a question
            * about this issue, and it invites you to leave it alone and name a chapter.
            *
            * So: a group that reads as one question, a label that says what ticking MEANS rather
            * than what it selects, and the disabled field saying why it is disabled instead of
            * going quietly grey.
            */}
          <div className="field wide">
            <span className="fieldname">Which chapter?</span>
          <span className="scope" data-testid="issue-scope">
            <input
              type="text"
              aria-label="Chapter this happened in"
              /* ⚠️ NOT the label's own words again. The first version put "not about one chapter"
                 in here AND on the checkbox beside it — the same sentence twice, six inches apart,
                 which is the repetition this app has already been told off for. The disabled field
                 says it is out of play; the checkbox says why. */
              placeholder={form.all_chapters ? 'chapter not needed' : 'e.g. 1'}
              value={form.chapter}
              disabled={form.all_chapters}
              onChange={(e) => setForm({ ...form, chapter: e.target.value })}
              data-testid="issue-chapter"
            />
            <label className="check">
              <input
                type="checkbox"
                checked={form.all_chapters}
                onChange={(e) => setForm({ ...form, all_chapters: e.target.checked, chapter: '' })}
                data-testid="issue-all-chapters"
              />
              <span>
                Not about one chapter
                {/* ⚠️ EXAMPLES, NOT A DEFINITION, AND UNDER THE BOX, NOT UNDER THE FORM. "Happens
                    everywhere" is the rule and nobody applies a rule to their own case in the
                    moment; "lagging" is the one that was actually got wrong, so it is named first.
                    The first version put this in a paragraph below the whole row, four controls
                    away from the checkbox it explains, and the checkbox still read as a bare box. */}
                <small className="muted" data-testid="scope-hint">
                  tick this when it happens all over the app — lagging, sound, saving, a word used
                  the same way everywhere. Name a chapter only when it happens in that one.
                </small>
              </span>
            </label>
          </span>
          </div>
          <label className="field">
            <span className="fieldname">Age Group</span>
            <select
              value={form.age_band}
              onChange={(e) => setForm({ ...form, age_band: e.target.value })}
              data-testid="issue-age"
            >
              <option value="">choose…</option>
              {AGE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b === 'any' ? 'any age' : b.replace('-', '–')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="send" onClick={submit} disabled={busy || !form.description.trim()} data-testid="issue-submit">
          {busy ? 'Sending…' : 'Send it in'}
        </button>
        {error && (
          <p className="small error" data-testid="issue-error">
            {error}
          </p>
        )}
      </section>

      <section className="issuelist" style={{ marginTop: 32 }}>
        <h2>
          {canTriage ? 'Everything found so far' : 'Issues/Feedback reported by you'}{' '}
          <span className="muted small" data-testid="issue-count">({shown.length} of {items.length})</span>
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
              <p className="what">{i.description}</p>
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
                {i.type && <span className="area">{i.type}</span>}
                <span className="area">{i.all_chapters ? 'all chapters' : i.chapter ? `chapter ${i.chapter}` : 'no chapter'}</span>
                {i.age_band && <span className="area">age {i.age_band === 'any' ? 'any' : i.age_band.replace('-', '–')}</span>}
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
            </li>
          ))}
        </ol>
        {shown.length === 0 && <p className="muted small">Nothing here yet.</p>}
      </section>
    </>
  )
}
