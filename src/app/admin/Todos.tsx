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

  return (
    <section style={{ marginTop: 36 }}>
      <h2>
        To-do <span className="muted small" data-testid="todo-open-count">({open} open of {items.length})</span>
      </h2>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px' }}>
        <input
          type="text"
          value={task}
          maxLength={300}
          placeholder="Add an item"
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          data-testid="todo-new"
          style={{ flex: 1 }}
        />
        <button onClick={add} disabled={busy || !task.trim()} data-testid="todo-add">
          Add
        </button>
      </div>
      {error && <p className="small" style={{ color: '#ff9d9d' }} data-testid="todo-error">{error}</p>}

      <ol className="todos" data-testid="todo-list">
        {items.map((t, i) => (
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
              <button className="chip" onClick={() => move(t, 'up')} disabled={busy || i === 0} data-testid="todo-up">
                ↑
              </button>{' '}
              <button
                className="chip"
                onClick={() => move(t, 'down')}
                disabled={busy || i === items.length - 1}
                data-testid="todo-down"
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
