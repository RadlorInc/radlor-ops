'use client'

import { useRef, useState } from 'react'

/**
 * WATCH A CLEARED CUT, FROM THE DASHBOARD.
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
 * ⚠️ AND THE BUTTON ONLY EXISTS ON CLEARED ROWS, but that is the dashboard being tidy, not the
 * control. The route decides; this component would get a 404 for anything else, which is what the
 * error line below says out loud rather than leaving a dead player.
 */
export default function Watch({ slug, title }: { slug: string; title: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

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
   *  the old one may well have expired while the dialog sat open. */
  function close() {
    dialog.current?.close()
    setSrc(null)
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
      <dialog ref={dialog} className="watchbox" onClose={() => setSrc(null)} aria-label={`${title} — player`}>
        {src && (
          <video
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
        <button className="ghost small" onClick={close} data-testid="admin-watch-close">
          Close
        </button>
      </dialog>
    </>
  )
}
