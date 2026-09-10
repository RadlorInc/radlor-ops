'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatT } from '@/lib/review'

/**
 * WATCH A CUT FROM THE DASHBOARD — AND LEAVE FEEDBACK ON IT WITHOUT GOING ANYWHERE.
 *
 * ⚠️ THE URL IS FETCHED ON CLICK, NEVER RENDERED INTO THE PAGE. Same rule as the reviewer's
 * player: what `/api/video-url` returns is a bearer credential for the object and it dies in
 * minutes, so a table that server-rendered one per row would put a live credential for every
 * cleared video into one HTML document — including the rows nobody opened.
 *
 * ⚠️ A DIALOG, NOT A PLAYER IN THE CELL. The first version rendered the video inside the table
 * cell and it worked; a screenshot is what said no. A 9:16 cut in a 160px column is a 284px-tall
 * row, and the extra width pushed the eighth column off a 1280px screen — a table you now have to
 * scroll sideways to read the unread-note count that was visible before. `<dialog>` is native:
 * Escape closes it, focus is trapped, the backdrop is the browser's, and it costs no library.
 *
 * ⚠️ THE NOTE COMPOSER IS HERE BECAUSE THE PLAYER IS HERE, AND A NOTE IS A TIMESTAMP. Rafi,
 * 2026-09-10: the admin should be able to send feedback on marketing material too. They always
 * could — `/review` accepts an admin and `/api/notes` never asked for an assignment — but only
 * from the *My reviews* tab, which means leaving the page where the cuts and everybody else's
 * notes are. Every note in this tool is anchored to a second, so the place to write one is beside
 * a video you can scrub; a plain comment box on the row would have been a different, weaker thing
 * wearing the same word.
 *
 * ⚠️ AND IT IS THE SAME ROUTE THE REVIEWERS USE, DELIBERATELY. No admin-only note path, no second
 * table: the note lands attributed to whoever wrote it and shows up in *What the reviewers said*
 * beside theirs. Which also means the ordinary rule still applies — if this admin is an approver on
 * this cut AND had already given a verdict, writing a note clears it, exactly as it would for a
 * reviewer. The route says so in its answer and the panel repeats it rather than letting a verdict
 * vanish quietly.
 */
export default function Watch({ slug, title }: { slug: string; title: string }) {
  const router = useRouter()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  /** The second the note is anchored to, captured when the composer opens. `null` = closed. */
  const [draftAt, setDraftAt] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  /** What just happened, in words. Kept after the composer closes so the admin sees it landed. */
  const [saved, setSaved] = useState<string | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)

  async function open() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/video-url?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) throw new Error(String(res.status))
      const { url } = (await res.json()) as { url: string }
      setSrc(url)
      dialog.current?.showModal()
    } catch {
      setError('Could not open it. The link may have expired — try again.')
    } finally {
      setLoading(false)
    }
  }

  /** ⚠️ THE `src` GOES WITH THE DIALOG. Leaving it set would keep a live signed URL in the DOM
   *  after the admin has finished watching, and the next click should mint a fresh one anyway —
   *  the old one may well have expired while the dialog sat open. The composer is cleared with it,
   *  so reopening never shows a half-written note about a moment nobody is looking at. */
  function close() {
    dialog.current?.close()
    setSrc(null)
    setDraftAt(null)
    setBody('')
    setSaved(null)
    setNoteError(null)
  }

  const startNote = useCallback(() => {
    const v = video.current
    // Pause first: the admin is about to look away from the frame they are describing.
    v?.pause()
    setDraftAt(Math.round(v?.currentTime ?? 0))
    setSaved(null)
    setNoteError(null)
    setTimeout(() => bodyRef.current?.focus(), 0)
  }, [])

  async function saveNote() {
    if (draftAt === null || !body.trim() || saving) return
    setSaving(true)
    setNoteError(null)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, t_seconds: draftAt, body }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(
          d.error === 'rate_limited'
            ? 'Slow down a moment — too many notes at once. Try again in a minute.'
            : 'Could not save that note. Try again.',
        )
      }
      const { reopened } = (await res.json()) as { reopened: boolean }
      setSaved(
        reopened
          ? `Saved at ${formatT(draftAt)} — and because you had already given a verdict on this cut, that verdict is cleared.`
          : `Saved at ${formatT(draftAt)}.`,
      )
      setBody('')
      setDraftAt(null)
      // The note belongs in "What the reviewers said" under the table. ⚠️ If that list does not
      // redraw, the note is still saved — the sentence above is what says so. See the handoff on
      // `router.refresh()`.
      router.refresh()
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Could not save that note.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button className="ghost small" onClick={open} disabled={loading} data-testid="admin-watch">
        {loading ? 'Opening…' : 'Watch'}
      </button>
      {error && (
        <div className="muted small" data-testid="admin-watch-error">
          {error}
        </div>
      )}
      <dialog ref={dialog} className="watchbox" onClose={close} aria-label={`${title} — player`}>
        {src && (
          <video
            ref={video}
            src={src}
            controls
            playsInline
            preload="metadata"
            // Same deterrent as the reviewer's player — not protection, see PR_BODY.md.
            controlsList="nodownload"
            disablePictureInPicture
            data-testid="admin-player"
          />
        )}

        {draftAt === null ? (
          <button className="ghost small" onClick={startNote} disabled={!src} data-testid="admin-add-note">
            Add a note
          </button>
        ) : (
          <div>
            <label className="field">
              <span className="fieldname">
                Your note at <strong data-testid="admin-draft-time">{formatT(draftAt)}</strong>
              </span>
              <textarea
                ref={bodyRef}
                rows={3}
                value={body}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What did you notice here?"
                data-testid="admin-note-body"
              />
            </label>
            <button onClick={saveNote} disabled={saving || !body.trim()} data-testid="admin-save-note">
              {saving ? 'Saving…' : 'Save note'}
            </button>
            <button
              className="ghost small"
              onClick={() => {
                setDraftAt(null)
                setBody('')
                setNoteError(null)
              }}
              disabled={saving}
              data-testid="admin-cancel-note"
            >
              Cancel
            </button>
          </div>
        )}

        {saved && (
          <p className="small" style={{ margin: '10px 0 0' }} data-testid="admin-note-saved">
            {saved}
          </p>
        )}
        {noteError && (
          <p className="small error" style={{ margin: '10px 0 0' }} data-testid="admin-note-error">
            {noteError}
          </p>
        )}

        <button className="ghost small" onClick={close} data-testid="admin-watch-close">
          Close
        </button>
      </dialog>
    </>
  )
}
