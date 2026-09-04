'use client'

import { useState } from 'react'

/**
 * WATCH A CLEARED CUT, FROM THE DASHBOARD.
 *
 * ⚠️ THE URL IS FETCHED ON CLICK, NEVER RENDERED INTO THE PAGE. Same rule as the reviewer's
 * player: what `/api/video-url` returns is a bearer credential for the object and it dies in
 * minutes, so a table that server-rendered one per row would put a live credential for every
 * cleared video into one HTML document — including the rows nobody opened.
 *
 * ⚠️ AND THE BUTTON ONLY EXISTS ON CLEARED ROWS, but that is the dashboard being tidy, not the
 * control. The route decides; this component would get a 404 for anything else, which is what the
 * error line below says out loud rather than leaving a dead player.
 */
export default function Watch({ slug }: { slug: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/video-url?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) throw new Error(String(res.status))
      const { url } = (await res.json()) as { url: string }
      setSrc(url)
    } catch {
      setError('Could not open it. The link may have expired — try again.')
    } finally {
      setLoading(false)
    }
  }

  if (src) {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        // Same deterrent as the reviewer's player — not protection, see PR_BODY.md.
        controlsList="nodownload"
        disablePictureInPicture
        data-testid="admin-player"
        style={{ width: 160, aspectRatio: '9 / 16', borderRadius: 8, background: '#000' }}
      />
    )
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
    </>
  )
}
