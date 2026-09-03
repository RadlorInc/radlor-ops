'use client'

import { useState } from 'react'

type Person = { user_id: string; name: string; role: string }
const ROLE_LABEL: Record<string, string> = { admin: 'Admin', tester: 'Tester', reviewer: 'Reviewer' }
const BLANK = { name: '', email: '', role: 'reviewer' }

/**
 * Who has access, and the form that gives it. Sending an invite is the ONLY way an account gets
 * made now: the person receives an email, opens the link, and chooses a password. Nothing to
 * hand over, nothing to type on their behalf.
 */
export default function People({ initial }: { initial: Person[] }) {
  const [people, setPeople] = useState(initial)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function invite() {
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.status === 409) throw new Error('That email already has an account.')
      if (!res.ok) throw new Error('That did not send. Try again.')
      const { user_id } = (await res.json()) as { user_id: string }
      setPeople((xs) => [...xs, { user_id, name: form.name.trim(), role: form.role }].sort((a, b) => a.name.localeCompare(b.name)))
      setSent(form.email.trim())
      setForm(BLANK)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="sr-only">People</h2>
      <div className="card filecard">
        <h2>Invite someone</h2>
        <p className="help">
          They get an email with a link. Opening it confirms their address and lets them choose a password —
          you never have to send one.
        </p>
        <div className="fields">
          <label className="field">
            <span className="fieldname">Their name</span>
            <input type="text" value={form.name} maxLength={120} placeholder="e.g. Dana" onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="invite-name" />
          </label>
          <label className="field">
            <span className="fieldname">Their email</span>
            <input type="email" value={form.email} placeholder="e.g. dana@example.com" onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="invite-email" />
          </label>
          <label className="field">
            <span className="fieldname">What they do</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="invite-role">
              <option value="reviewer">Reviewer — watches videos and leaves notes</option>
              <option value="tester">Tester — tries the app and files problems</option>
              <option value="admin">Admin — sees everything</option>
            </select>
          </label>
        </div>
        <div className="actions">
          <button onClick={invite} disabled={busy || !form.name.trim() || !form.email.trim()} data-testid="invite-send">
            {busy ? 'Sending…' : 'Send the invite'}
          </button>
          {sent && (
            <span className="small" data-testid="invite-sent">
              Invite sent to <strong>{sent}</strong>. It can take a minute to arrive.
            </span>
          )}
          {error && (
            <span className="small error" data-testid="invite-error">
              {error}
            </span>
          )}
        </div>
      </div>

      <h2 style={{ marginTop: 28 }}>Who has access</h2>
      <ol className="todos" data-testid="people-list">
        {people.map((p) => (
          <li key={p.user_id} data-testid="person">
            <span className="chip" data-testid="person-role">{ROLE_LABEL[p.role] ?? p.role}</span>
            <span>{p.name}</span>
          </li>
        ))}
      </ol>
      {people.length === 0 && <p className="muted small">Nobody yet. Send the first invite above.</p>}
    </section>
  )
}
