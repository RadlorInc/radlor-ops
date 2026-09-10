'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type MaterialItem = {
  id: string
  title: string
  kind: 'link' | 'file'
  url: string | null
  filename: string | null
  ready: boolean
  addedBy: string
  created_at: string
}

/**
 * SOURCE MATERIAL — what a cut gets made FROM. A link, or a file of any kind at all.
 *
 * ⚠️ IT IS NOT THE *Marketing material* TAB AND THE TWO MUST NOT BLUR. That one holds finished
 * cuts: versions, assigned approvers, verdicts, a clearing rule, a reviewer waiting. This one holds
 * raw input and has none of that — nothing here is reviewed, cleared or assigned, and nothing here
 * is ever shown to a reviewer.
 *
 * ⚠️ NO FORMAT WHITELIST, DELIBERATELY. The upload form for cuts refuses anything a browser cannot
 * play, because a reviewer has to press play on it. Nobody presses play on a font file or a
 * competitor's PDF. The ask was "kuch bhi", and a whitelist would be a guess about what somebody
 * needs next week.
 */
export default function Material({ initial }: { initial: MaterialItem[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<'link' | 'file'>('link')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Which row is asking "really?". One at a time, so the second press is always deliberate. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const busy = step !== null
  const ready = title.trim() !== '' && (kind === 'link' ? url.trim() !== '' : file !== null)

  async function add() {
    if (!ready || busy) return
    setError(null)
    try {
      setStep(kind === 'link' ? 'Saving…' : 'Making room for it…')
      const made = await fetch('/api/admin/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'link'
            ? { title: title.trim(), kind, url: url.trim() }
            : { title: title.trim(), kind, filename: file!.name },
        ),
      })
      if (!made.ok) {
        const b = (await made.json().catch(() => ({}))) as { error?: string }
        throw new Error(
          b.error === 'bad_url'
            ? 'That does not look like a web address. It needs to start with http:// or https://.'
            : 'Could not save that.',
        )
      }

      if (kind === 'file') {
        const { id, uploadUrl } = (await made.json()) as { id: string; uploadUrl: string }
        setStep(`Uploading ${file!.name}…`)
        // ⚠️ STRAIGHT TO SUPABASE, NEVER THROUGH THIS APP. A serverless request body caps at a few
        // megabytes; source material is exactly the kind of thing that is forty.
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          body: file!,
          headers: { 'Content-Type': file!.type || 'application/octet-stream' },
        })
        if (!put.ok) throw new Error('The file did not upload. Remove the half-made item below and try again.')

        setStep('Checking it comes back…')
        const done = await fetch('/api/admin/material', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!done.ok) throw new Error('It uploaded but could not be read back. Remove it below and try again.')
      }

      setTitle('')
      setUrl('')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setStep(null)
      router.refresh()
    } catch (e) {
      setStep(null)
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }

  async function remove(id: string) {
    setError(null)
    setStep('Removing…')
    try {
      const res = await fetch('/api/admin/material', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('Could not remove it.')
      const { objectGone } = (await res.json()) as { objectGone: boolean }
      // ⚠️ SAID OUT LOUD. The row is gone either way, so the list looks right; a leftover object is
      // still stored and still paid for, and only this sentence will ever mention it.
      if (!objectGone) setError('Removed from the list, but the file itself is still in storage.')
      setConfirming(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove it.')
    } finally {
      setStep(null)
    }
  }

  return (
    <section>
      <h2 className="sr-only">Source material</h2>

      <div className="card filecard" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px' }}>Add something</h3>
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          Anything a cut gets made from — a reference video, a link, a PDF, a deck, a font. Nobody is
          asked to review what goes in here.
        </p>

        <div className="fields">
          <label className="field">
            <span className="fieldname">What is it?</span>
            <input
              type="text"
              value={title}
              maxLength={200}
              placeholder="e.g. Competitor hook teardown"
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              data-testid="material-title"
            />
          </label>

          <label className="field">
            <span className="fieldname">A link, or a file?</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'link' | 'file')}
              disabled={busy}
              data-testid="material-kind"
            >
              <option value="link">A link — somewhere on the web</option>
              <option value="file">A file — upload it</option>
            </select>
          </label>
        </div>

        {kind === 'link' ? (
          <label className="field" style={{ marginTop: 10 }}>
            <span className="fieldname">The address</span>
            <input
              type="url"
              value={url}
              maxLength={2000}
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              data-testid="material-url"
            />
          </label>
        ) : (
          <label className="field" style={{ marginTop: 10 }}>
            <span className="fieldname">The file</span>
            {/* No `accept`: any format at all, which is the point of the tab. */}
            <input
              ref={fileInput}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              data-testid="material-file"
            />
          </label>
        )}

        <button className="send" style={{ marginTop: 14 }} onClick={add} disabled={busy || !ready} data-testid="material-add">
          {busy ? 'Working…' : 'Add it'}
        </button>
        {step && (
          <p className="muted small" data-testid="material-step">
            {step}
          </p>
        )}
        {error && (
          <p className="small error" data-testid="material-error">
            {error}
          </p>
        )}
      </div>

      <h3 style={{ margin: '0 0 4px' }}>Everything in here</h3>
      {initial.length === 0 ? (
        <p className="muted small" data-testid="material-empty">
          Nothing yet. The first link or file goes above.
        </p>
      ) : (
        <ol className="todos" data-testid="material-list">
          {initial.map((m) => (
            <li key={m.id} data-testid="material-item" data-kind={m.kind} data-ready={m.ready ? 'yes' : 'no'}>
              <span className="chip">{m.kind === 'link' ? 'Link' : 'File'}</span>
              <span>{m.title}</span>

              {/* ⚠️ AN UNFINISHED UPLOAD SAYS SO INSTEAD OF OFFERING ITSELF. The row is written
                  before the bytes are sent, so this is the state a died-half-way upload leaves —
                  visible and removable, rather than an item that 404s on the first click. */}
              {m.kind === 'file' && !m.ready ? (
                <span className="chip waiting" data-testid="material-unfinished">
                  Upload did not finish
                </span>
              ) : m.kind === 'link' ? (
                /* ⚠️ `noreferrer`. The destination is somewhere an admin pasted from; it does not
                   get to learn which page of this tool the click came from. */
                <a className="linky" href={m.url!} target="_blank" rel="noreferrer" data-testid="material-open">
                  Open
                </a>
              ) : (
                /* A plain link to a route that mints the signed URL at the moment of the click, so
                   nothing signed is ever rendered into this page. */
                <a
                  className="linky"
                  href={`/api/admin/material?id=${encodeURIComponent(m.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="material-open"
                >
                  Open
                </a>
              )}

              <span className="muted small" style={{ marginLeft: 'auto', paddingLeft: 10 }}>
                {m.filename ? `${m.filename} · ` : ''}
                {m.addedBy}
              </span>

              {confirming === m.id ? (
                <>
                  <button className="linky" onClick={() => remove(m.id)} disabled={busy} data-testid="material-remove-really">
                    Yes, remove
                  </button>
                  <button className="linky" onClick={() => setConfirming(null)} disabled={busy} data-testid="material-remove-cancel">
                    Keep it
                  </button>
                </>
              ) : (
                <button className="linky" onClick={() => setConfirming(m.id)} disabled={busy} data-testid="material-remove">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
