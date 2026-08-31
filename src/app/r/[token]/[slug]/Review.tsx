'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QUESTIONS, formatT } from '@/lib/review'

type NoteView = { id: string; t_seconds: number; body: string }

/** Four anchors the watermark cycles through. Corners AND centre, so cropping the frame cannot
 *  remove it — after ~20 seconds it lands somewhere the crop kept. */
const ANCHORS = [
  { top: '8%', left: '6%' },
  { top: '46%', right: '6%' },
  { bottom: '10%', left: '10%' },
  { top: '24%', left: '32%' },
] as const

export default function Review(props: {
  token: string
  slug: string
  title: string
  version: number
  status: 'draft' | 'awaiting_review' | 'reviewed' | 'revising'
  reviewerName: string
  reviewerEmail: string
  initialNotes: NoteView[]
}) {
  const { token, slug, title, version, reviewerName, reviewerEmail } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const [src, setSrc] = useState<string | null>(null)
  const [srcError, setSrcError] = useState<string | null>(null)
  const [notes, setNotes] = useState<NoteView[]>(props.initialNotes)
  const [draftAt, setDraftAt] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anchor, setAnchor] = useState(0)
  /** `reviewed` once they press Done; back to `awaiting_review` if they then add another note. */
  const [status, setStatus] = useState(props.status)
  /** True only for the note that reopened it, so the page can say what just happened. */
  const [reopened, setReopened] = useState(false)
  const [finishing, setFinishing] = useState(false)

  // The bucket is private and the URL expires in minutes, so it is fetched per page load rather
  // than rendered into the HTML — there is no permanent link to leak.
  useEffect(() => {
    let live = true
    fetch(`/api/video-url?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`video url ${r.status}`)
        return (await r.json()) as { url: string }
      })
      .then((d) => live && setSrc(d.url))
      .catch(() => live && setSrcError('Could not load the video. Reload the page — the link may have expired.'))
    return () => {
      live = false
    }
  }, [token, slug])

  useEffect(() => {
    const id = setInterval(() => setAnchor((a) => (a + 1) % ANCHORS.length), 20_000)
    return () => clearInterval(id)
  }, [])

  const startNote = useCallback(() => {
    const v = videoRef.current
    // Pause first: the reviewer is about to look away from the frame they are describing.
    v?.pause()
    setDraftAt(Math.round(v?.currentTime ?? 0))
    setError(null)
    // Focus after the composer has rendered.
    setTimeout(() => bodyRef.current?.focus(), 0)
  }, [])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
  }, [])

  async function save() {
    if (draftAt === null || !body.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slug, t_seconds: draftAt, body }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(
          d.error === 'rate_limited'
            ? 'Slow down a moment — too many notes at once. Try again in a minute.'
            : 'Could not save that note. Try again.',
        )
      }
      const { note, reopened: didReopen } = (await res.json()) as { note: NoteView; reopened: boolean }
      setNotes((ns) => [...ns, note].sort((a, b) => a.t_seconds - b.t_seconds))
      if (didReopen) {
        setStatus('awaiting_review')
        setReopened(true)
      }
      setBody('')
      setDraftAt(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that note.')
    } finally {
      setSaving(false)
    }
  }

  async function finish() {
    if (finishing) return
    setFinishing(true)
    setError(null)
    try {
      const res = await fetch('/api/review-done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slug }),
      })
      if (!res.ok) throw new Error('could not save that')
      setStatus('reviewed')
      setReopened(false)
    } catch {
      setError('Could not mark this finished. Try again.')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <main className="wrap">
      <h1>{title}</h1>
      <p className="muted small">
        {slug} · v{version} · <a href={`/r/${encodeURIComponent(token)}`}>all videos</a>
      </p>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="player">
          <div className="frame">
            {src ? (
              <video
                ref={videoRef}
                src={src}
                controls
                playsInline
                preload="metadata"
                // Removes the one-click "Download" from the player's own menu. A deterrent against
                // casual forwarding, not a control — see PR_BODY.md.
                controlsList="nodownload"
                disablePictureInPicture
                data-testid="player"
              />
            ) : (
              <div
                style={{ aspectRatio: '9 / 16', display: 'grid', placeItems: 'center', background: '#000', borderRadius: 10 }}
                className="muted small"
              >
                {srcError ?? 'Loading video…'}
              </div>
            )}

            {/* Deterrent, not protection — see PR_BODY.md. It survives a screen recording and a
                crop; it does not survive the network tab, and it is not meant to. */}
            <div
              aria-hidden
              data-testid="watermark"
              style={{
                position: 'absolute',
                ...ANCHORS[anchor],
                pointerEvents: 'none',
                opacity: 0.22,
                fontSize: 12,
                lineHeight: 1.3,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,.8)',
                transition: 'all .6s ease',
                userSelect: 'none',
              }}
            >
              {reviewerName}
              <br />
              {reviewerEmail}
            </div>
          </div>
        </div>

        <div className="side">
          <button onClick={startNote} data-testid="add-note">
            Add note
          </button>

          {draftAt !== null && (
            <div style={{ marginTop: 12 }}>
              <p className="small muted" style={{ margin: '0 0 6px' }}>
                Note at <strong data-testid="draft-time">{formatT(draftAt)}</strong>
              </p>
              <textarea
                ref={bodyRef}
                rows={3}
                value={body}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                data-testid="note-body"
                placeholder="What happened here?"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={save} disabled={saving || !body.trim()} data-testid="save-note">
                  {saving ? 'Saving…' : 'Save note'}
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setDraftAt(null)
                    setBody('')
                    setError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p className="small" style={{ color: '#ff9d9d' }} data-testid="note-error">
                  {error}
                </p>
              )}
            </div>
          )}

          {status === 'reviewed' ? (
            <p className="done" data-testid="done-confirmation">
              Thanks — you’ve marked this one finished. Your notes are below, and you can still add
              another if you think of something; that puts it back as still being reviewed.
            </p>
          ) : (
            reopened && (
              <p className="done" data-testid="reopened-notice">
                You added a note after finishing, so this is back on Rafi’s list as still being
                reviewed. Press <strong>Done reviewing</strong> again when you’re ready.
              </p>
            )
          )}

          <ol className="notes" data-testid="note-list">
            {notes.map((n) => (
              <li key={n.id}>
                <button className="t" onClick={() => seek(n.t_seconds)} title="Jump to this moment">
                  {formatT(n.t_seconds)}
                </button>
                {n.body}
              </li>
            ))}
          </ol>
          {notes.length === 0 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              No notes yet.
            </p>
          )}

          {status !== 'reviewed' && (
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <button className="ghost" onClick={finish} disabled={finishing} data-testid="done-reviewing">
                {finishing ? 'Saving…' : 'Done reviewing'}
              </button>
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                Tells Rafi you’ve finished with this cut. You can still add notes afterwards.
              </p>
            </div>
          )}
        </div>
      </div>

      <details className="questions" style={{ marginTop: 28 }}>
        <summary>The seven questions</summary>
        <ol>
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </details>
    </main>
  )
}
