'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useSyncExternalStore } from 'react'

type Person = {
  user_id: string
  name: string
  role: string
  /** `waiting` = a link is out and unopened · `expired` = it ran out · `null` = joined, or made
   *  by hand with no link at all. Computed on the server in `page.tsx`, where the link table is
   *  readable — the browser has no way to see it and must not be given one. */
  join?: 'waiting' | 'expired' | null
  expiresInDays?: number
}
type Made = { email: string; path: string }
type Skipped = { email: string; why: string }
const ROLE_LABEL: Record<string, string> = { admin: 'Admin', tester: 'Tester', reviewer: 'Reviewer' }

/** Days, in words. "expires in 0 days" is what a bare number gives you on the last day, which is
 *  both wrong-sounding and the day it matters most. */
function expiry(days?: number): string {
  if (days === undefined) return 'link expires soon'
  if (days <= 1) return 'link expires today'
  if (days === 2) return 'link expires tomorrow'
  // ⚠️ NO `- 1` HERE. It was there to undo the `Math.ceil` on the server and undid one day too
  // many: a link made a second ago has 6.99 days left, ceil is 7, and the row said "6 days".
  // Under-reporting an expiry is the direction that hurts — somebody plans around the wrong day.
  return `link expires in ${days} days`
}

/**
 * ⚠️ THE LINKS LIVE HERE BECAUSE THEY CANNOT BE FETCHED AGAIN. The table holds sha256 of each
 * token and nothing else, so this response is the only copy that will ever exist. That made two
 * ordinary things destructive:
 *
 *   • `router.refresh()`, which this component calls to update the list below, REMOUNTS it and
 *     empties its state. Three links vanished between the fetch resolving and the list redrawing —
 *     with the accounts already created, so pressing the button again did nothing but supersede
 *     links nobody had seen.
 *   • an accidental reload, or a click on another tab, did the same thing more slowly.
 *
 * `sessionStorage` survives both: it is per-tab, dies with the tab, and never leaves this origin.
 * Yes, that is a bearer credential in browser storage — for the admin who is looking at it on
 * screen anyway, in a page with a strict CSP and no third-party script. *Done — hide these* wipes
 * it, and the honest alternative was losing people's links to a re-render.
 */
const STORE = 'radlor-ops:last-links'

/**
 * ⚠️ `useSyncExternalStore`, NOT `useState` + `useEffect`. Restoring in an effect is a setState in
 * an effect, which the React Compiler's lint rejects — and it is right to: the value exists before
 * the first paint, so reading it as an external store renders it once instead of rendering empty
 * and then correcting. It also gets the hydration case for free — the server snapshot is `'[]'`,
 * so the markup matches and the real value arrives on the client's first read.
 */
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
/** The RAW string, because `getSnapshot` must return something stable across calls — parsing here
 *  would hand React a new array every time and spin. The parse happens in a `useMemo` below. */
function readStore(): string {
  try {
    return sessionStorage.getItem(STORE) ?? '[]'
  } catch {
    return '[]' // private mode, or storage disabled: showing nothing is correct
  }
}
function writeStore(links: Made[] | null) {
  try {
    if (links) sessionStorage.setItem(STORE, JSON.stringify(links))
    else sessionStorage.removeItem(STORE)
  } catch {}
  for (const fn of listeners) fn()
}

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
  const madeJson = useSyncExternalStore(subscribe, readStore, () => '[]')
  const made = useMemo<Made[]>(() => {
    try {
      return JSON.parse(madeJson) as Made[]
    } catch {
      return []
    }
  }, [madeJson])
  const [skipped, setSkipped] = useState<Skipped[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function forget() {
    setCopied(null)
    writeStore(null)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(
      () => setCopied(key),
      () => setCopied(null),
    )
  }

  // ⚠️ The origin comes from the BROWSER, not from the server: a link copied out of a preview
  // deployment then points at that deployment instead of at whatever host the server guessed.
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const block = made.map((l) => `${l.email}  ${origin}${l.path}`).join('\n')

  async function post(body: unknown) {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const res = await fetch('/api/admin/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('That did not work. Try again.')
      const out = (await res.json()) as { links: Made[]; skipped: Skipped[] }
      writeStore(out.links)
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
            One line per person — send each of them their own. Every link works once and stops working
            in seven days. ⚠️ This is the only time they can be read: only their fingerprint is stored,
            so nothing can show them to you again. Lost one? <em>New link</em> beside that person makes
            a fresh one and kills the old.
          </p>
          <ol className="todos linklist" data-testid="links-out">
            {made.map((l) => (
              <li key={l.path} data-testid="link-row">
                <span className="linkwho">{l.email}</span>
                <code className="linkurl">
                  {origin}
                  {l.path}
                </code>
                <button className="linky" data-testid="copy-one" onClick={() => copy(`${origin}${l.path}`, l.path)}>
                  {copied === l.path ? 'Copied' : 'Copy'}
                </button>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button onClick={() => copy(block, 'all')} data-testid="copy-links">
              {copied === 'all' ? 'Copied' : made.length === 1 ? 'Copy the line' : 'Copy all lines'}
            </button>
            <button className="linky" onClick={forget} data-testid="links-done">
              Done — hide these
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
            {/* ⚠️ THE LIST IS "ACCOUNTS MADE", NOT "PEOPLE WHO JOINED" — the row appears the moment
                the link is made, days before anybody opens it. Without this chip a rollout of
                twenty looks identical whether nineteen are stuck or none are. */}
            {p.join === 'waiting' && (
              <span className="chip waiting" data-testid="person-join">
                Not joined yet · {expiry(p.expiresInDays)}
              </span>
            )}
            {p.join === 'expired' && (
              <span className="chip waiting" data-testid="person-join">
                Link expired · make a new one
              </span>
            )}
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
