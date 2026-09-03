'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Person = { user_id: string; name: string; role: string }
type Made = { email: string; path: string }
type Skipped = { email: string; why: string }
const ROLE_LABEL: Record<string, string> = { admin: 'Admin', tester: 'Tester', reviewer: 'Reviewer' }

/**
 * Who has access, and how they get it: paste the addresses, send the links.
 *
 * ⚠️ NOTHING IS EMAILED FROM HERE, AND NO PASSWORD IS EVER TYPED BY THE ADMIN. The server makes an
 * account per address with no password, and one single-use link each. The admin copies the block
 * below and sends it to the tester head, who forwards each person their own line; opening it is
 * where they choose their password.
 *
 * ⚠️ THE LINKS ARE SHOWN ONCE AND CANNOT BE SHOWN AGAIN — only their hash is stored. Copy the
 * block before leaving the page. Losing it costs nothing: *New link* below makes a fresh one, and
 * making one kills the one that was lost.
 */
export default function People({ initial }: { initial: Person[] }) {
  const router = useRouter()
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState('tester')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<Made[]>([])
  const [skipped, setSkipped] = useState<Skipped[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ⚠️ The origin comes from the BROWSER, not from the server: a link copied out of a preview
  // deployment then points at that deployment instead of at whatever host the server guessed.
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const block = made.map((l) => `${l.email}  ${origin}${l.path}`).join('\n')

  async function post(body: unknown) {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch('/api/admin/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('That did not work. Try again.')
      const out = (await res.json()) as { links: Made[]; skipped: Skipped[] }
      setMade(out.links)
      setSkipped(out.skipped)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const parsed = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="sr-only">People</h2>
      <div className="card filecard">
        <h2>Add people by email</h2>
        <p className="help">
          Paste their email addresses — one per line. You get a link for each one back. Send the whole
          block to whoever is organising them; each person opens their own link and picks their own
          password. You never send anybody a password.
        </p>
        <div className="fields">
          <label className="field">
            <span className="fieldname">Their email addresses</span>
            <textarea
              value={emails}
              rows={5}
              placeholder={'dana@example.com\nsam@example.com'}
              onChange={(e) => setEmails(e.target.value)}
              data-testid="bulk-emails"
            />
          </label>
          <label className="field">
            <span className="fieldname">What they do</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} data-testid="bulk-role">
              <option value="tester">Tester — tries the app and files problems</option>
              <option value="reviewer">Reviewer — watches videos and leaves notes</option>
              <option value="admin">Admin — sees everything</option>
            </select>
          </label>
        </div>
        <div className="actions">
          <button onClick={() => post({ emails: parsed, role })} disabled={busy || parsed.length === 0} data-testid="bulk-make">
            {busy ? 'Making links…' : parsed.length === 1 ? 'Make 1 link' : `Make ${parsed.length || ''} links`}
          </button>
          {error && (
            <span className="small error" data-testid="links-error">
              {error}
            </span>
          )}
        </div>
      </div>

      {made.length > 0 && (
        <div className="card filecard" style={{ marginTop: 16 }}>
          <h2>Send these</h2>
          <p className="help">
            One line per person. Each link works once and stops working in seven days. This is the only
            time they can be read — copy them now.
          </p>
          <textarea readOnly rows={Math.min(made.length + 1, 12)} value={block} data-testid="links-out" style={{ width: '100%', fontFamily: 'monospace' }} />
          <div className="actions">
            <button
              onClick={() => navigator.clipboard.writeText(block).then(() => setCopied(true), () => setCopied(false))}
              data-testid="copy-links"
            >
              {copied ? 'Copied' : 'Copy all'}
            </button>
          </div>
        </div>
      )}

      {skipped.length > 0 && (
        <ul className="todos" data-testid="links-skipped" style={{ marginTop: 12 }}>
          {skipped.map((s, i) => (
            <li key={i}>
              <span className="chip">Skipped</span>
              <span>
                {s.email} — {s.why}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 28 }}>Who has access</h2>
      <ol className="todos" data-testid="people-list">
        {initial.map((p) => (
          <li key={p.user_id} data-testid="person">
            <span className="chip" data-testid="person-role">{ROLE_LABEL[p.role] ?? p.role}</span>
            <span>{p.name}</span>
            {/* Forgot their password? There is no email to send, so the answer is a new link — and
                making it kills any older one they were still holding. */}
            <button className="linky" onClick={() => post({ user_id: p.user_id })} disabled={busy} data-testid="person-newlink">
              New link
            </button>
          </li>
        ))}
      </ol>
      {initial.length === 0 && <p className="muted small">Nobody yet. Paste the first addresses above.</p>}
    </section>
  )
}
