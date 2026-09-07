'use client'

import { useState } from 'react'
import type { Todo } from '@/lib/adminDb'

const LABEL: Record<Todo['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
}
const NEXT: Record<Todo['status'], Todo['status']> = {
  not_started: 'in_progress',
  in_progress: 'done',
  done: 'not_started',
}
const FILTERS = ['all', 'not_started', 'in_progress', 'done'] as const
type Filter = (typeof FILTERS)[number]

/**
 * Add, edit, mark done, reorder. Four actions, because those are the ones the sheet earned:
 * it had `Go-Live Task` and `Status` and nothing else, so there is no assignee, no due date, no
 * comment thread and no subtask here.
 */
export default function Todos({ initial }: { initial: Todo[] }) {
  const [items, setItems] = useState(initial)
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  async function call(method: 'POST' | 'PATCH', body: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/todo', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      return await res.json()
    } catch {
      setError('That did not save. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!task.trim()) return
    const r = await call('POST', { task })
    if (r?.todo) {
      setItems((xs) => [...xs, r.todo])
      setTask('')
    }
  }

  async function cycle(t: Todo) {
    const status = NEXT[t.status]
    // Optimistic, then reconciled by the reload the next visit does. The server is still the one
    // that decides — a failed call puts the error up rather than pretending.
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, status } : x)))
    const r = await call('PATCH', { id: t.id, status })
    if (!r) setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)))
  }

  async function move(t: Todo, dir: 'up' | 'down') {
    const r = await call('PATCH', { id: t.id, move: dir })
    if (!r?.moved) return
    setItems((xs) => {
      const s = [...xs].sort((a, b) => a.sort_order - b.sort_order)
      const i = s.findIndex((x) => x.id === t.id)
      const j = dir === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= s.length) return xs
      const so = s[i].sort_order
      s[i] = { ...s[i], sort_order: s[j].sort_order }
      s[j] = { ...s[j], sort_order: so }
      return s.sort((a, b) => a.sort_order - b.sort_order)
    })
  }

  async function save(t: Todo) {
    if (!draft.trim()) return setEditing(null)
    const r = await call('PATCH', { id: t.id, task: draft })
    if (r) setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, task: draft.trim() } : x)))
    setEditing(null)
  }

  const open = items.filter((t) => t.status !== 'done').length
  const shown = filter === 'all' ? items : items.filter((t) => t.status === filter)

  /** Done out of total, per area, biggest first. Items with no area are grouped as "No area" so
   *  the meters always add up to the list — a summary that silently drops rows is worse than none. */
  const areas = Object.values(
    items.reduce<Record<string, { name: string; done: number; total: number }>>((acc, t) => {
      const name = t.area?.trim() || 'No area'
      acc[name] ??= { name, done: 0, total: 0 }
      acc[name].total += 1
      if (t.status === 'done') acc[name].done += 1
      return acc
    }, {}),
  ).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return (
    <section style={{ marginTop: 36 }}>
      <h2 className="sr-only">To-do</h2>
      <p className="muted small" data-testid="todo-open-count">
        {open} open of {items.length}
      </p>

      {/**
        * ⚠️ SMALL MULTIPLES OF ONE METER, NOT A PIE AND NOT A STACKED BAR. Each area is its own
        * ratio against its own total — "3 of 5 done" — and ratios against different denominators
        * do not belong in one part-to-whole. One hue, because these are the same measurement seven
        * times, not seven different things.
        *
        * It lives inside this component rather than in a dashboard-wide KPI strip on the server,
        * and that is the whole reason it can be trusted: the list below mutates client-side as
        * items are added and advanced, so a summary rendered anywhere else would quietly disagree
        * with the list it is summarising the moment anybody clicked something.
        *
        * ⚠️ IT READS `items`, NEVER `shown`, AND THE FILTER MUST NOT REACH IT. "2 of 5 done" is a
        * fact about the work; recomputing it over the visible rows turns every filter into "3 of 3
        * done" and the meters into a picture of the filter rather than of the list. Filtering the
        * meters too is the obvious-looking change, which is why there is a test for it.
        */}
      {areas.length > 0 && (
        <div className="areameters" data-testid="area-progress">
          {areas.map((a) => (
            <div className="row2" key={a.name}>
              <span className="name" title={a.name}>{a.name}</span>
              <span className="meter" data-state={a.done === a.total ? 'cleared' : undefined}>
                <span className="track">
                  <span className="fill" style={{ width: `${(a.done / a.total) * 100}%` }} />
                </span>
              </span>
              <span className="count">
                {a.done}/{a.total}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          <span className="fieldname">Add something to the list</span>
          <input
            type="text"
            value={task}
            maxLength={300}
            placeholder="e.g. Register the domain"
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            data-testid="todo-new"
          />
        </label>
        <button onClick={add} disabled={busy || !task.trim()} data-testid="todo-add">
          Add
        </button>
      </div>
      {error && <p className="small error" data-testid="todo-error">{error}</p>}

      {/* ⚠️ THE SAME CHIP ROW AS THE TESTER'S ISSUE LIST, ON PURPOSE. Two lists in one product
          that filter by status should not have two ways of doing it — a person who learned the
          chips on /tester already knows this one. */}
      <div style={{ display: 'flex', gap: 6, margin: '0 0 12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className="chip"
            onClick={() => setFilter(f)}
            /* ⚠️ THE COLOUR IS NOT THE ONLY ANSWER TO "WHICH ONE IS ON". A screen reader gets
               nothing from a border, and neither does anyone in forced-colors. `aria-pressed` is
               the whole fix and these are already <button>s. */
            aria-pressed={filter === f}
            style={filter === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            data-testid={`todo-filter-${f}`}
          >
            {f === 'all' ? 'All' : LABEL[f]}
          </button>
        ))}
        <span className="muted small" data-testid="todo-shown-count">
          {shown.length} of {items.length}
        </span>
      </div>

      {/* ⚠️ THE ARROWS GO AWAY WHILE A FILTER IS ON, AND THAT IS THE FEATURE, NOT A GAP. Position
          is a property of the WHOLE list: "up" swaps with the row above in the full order, which
          under a filter is usually a row you cannot see. Left in, the button would either do
          nothing visible or move the item somewhere the screen cannot show — and its `disabled`
          rule (`i === 0`) would be lying too, because the first VISIBLE row is rarely the first
          row. A control that cannot mean what it looks like should not be on screen. */}
      {filter !== 'all' && (
        <p className="muted small" data-testid="todo-reorder-off">
          Reordering is off while filtered — an item&apos;s position belongs to the whole list.
        </p>
      )}

      <ol className="todos" data-testid="todo-list">
        {shown.map((t, i) => (
          <li key={t.id} data-testid="todo-item" data-status={t.status}>
            <button className="chip" onClick={() => cycle(t)} disabled={busy} data-testid="todo-status">
              {LABEL[t.status]}
            </button>
            {editing === t.id ? (
              <input
                type="text"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => save(t)}
                onKeyDown={(e) => e.key === 'Enter' && save(t)}
                data-testid="todo-edit"
                style={{ flex: 1 }}
              />
            ) : (
              <span
                className={t.status === 'done' ? 'strike' : undefined}
                onClick={() => {
                  setEditing(t.id)
                  setDraft(t.task)
                }}
                data-testid="todo-task"
              >
                {t.task}
              </span>
            )}
            {t.area && <span className="area">{t.area}</span>}
            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {filter === 'all' && (
                <>
              {/* ⚠️ `iconbtn`, NOT `chip`. As chips they inherited `li[data-status='done'] .chip`
                  and turned green on a finished row — a colour that means "done" painted onto a
                  control with nothing to do with status. And an icon-only button needs a name:
                  a screen reader otherwise announces these two as "up arrow" and "down arrow",
                  which says what they look like rather than what they do. */}
                  <button
                    className="iconbtn"
                    onClick={() => move(t, 'up')}
                    disabled={busy || i === 0}
                    aria-label={`Move “${t.task}” up`}
                    data-testid="todo-up"
                  >
                    ↑
                  </button>{' '}
                  <button
                    className="iconbtn"
                    onClick={() => move(t, 'down')}
                    disabled={busy || i === items.length - 1}
                    aria-label={`Move “${t.task}” down`}
                    data-testid="todo-down"
                  >
                ↓
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
