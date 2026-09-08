'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * DELETE A CUT, FROM THE ROW IT IS ON.
 *
 * ⚠️ TWO PRESSES, AND THE SECOND ONE SAYS WHAT IS LOST. Not the browser's `confirm()` — that
 * cannot say "and three notes from two reviewers", which is the only part of this worth pausing
 * over. The video is replaceable; somebody else's timestamped feedback and their conclusion are
 * not, and they go by cascade without appearing anywhere in the request.
 *
 * ⚠️ A `<dialog>`, AND THE FIRST VERSION EXPANDED INSIDE THE TABLE CELL INSTEAD. That read better
 * in the abstract — the slug stays beside the button — and a screenshot at 1280px killed it: this
 * table is nine columns, the confirm made it a tenth's worth wider, and "Keep it" ended up off the
 * right edge. A cancel you have to scroll sideways to find, on the one control in this app that
 * destroys other people's work. The dialog names the slug itself, so nothing is lost by leaving
 * the row — and Escape cancels, which the inline version could not offer. Same element as the
 * player in Watch.tsx; no library either time.
 */
export default function DeleteVideo({
  id,
  slug,
  notes,
  reviewers,
}: {
  id: string
  slug: string
  notes: number
  reviewers: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/video', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { objectGone } = (await res.json()) as { objectGone: boolean }
      // ⚠️ SAID OUT LOUD, BECAUSE THE NEXT UPLOAD IS WHERE IT BITES. The row is gone either way, so
      // the list looks right; a leftover object keeps the storage path occupied and a re-upload
      // under the same title fails on a file the admin was told no longer existed.
      if (!objectGone) setError(`Removed from the list, but the file itself is still in storage. Re-uploading “${slug}” will fail until it is cleared.`)
      else dialog.current?.close()
      router.refresh()
    } catch {
      setError('Could not delete it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="ghost small"
        onClick={() => {
          setError(null)
          dialog.current?.showModal()
        }}
        aria-label={`Delete ${slug}`}
        data-testid="video-delete"
      >
        Delete
      </button>

      <dialog ref={dialog} className="confirmbox" aria-label={`Delete ${slug}?`} data-testid="video-delete-confirm">
        {/* The plain-English inventory. "Cascade" is not a word to put in front of somebody at the
            moment they are deciding. */}
        <p style={{ margin: '0 0 12px' }}>
          Delete <code>{slug}</code>
          {notes > 0 || reviewers > 0 ? (
            <>
              {' '}
              and {notes} note{notes === 1 ? '' : 's'} from {reviewers} reviewer{reviewers === 1 ? '' : 's'}?
            </>
          ) : (
            '? Nobody has reviewed it.'
          )}{' '}
          This cannot be undone.
        </p>
        <button className="ghost small" onClick={remove} disabled={busy} data-testid="video-delete-really">
          {busy ? 'Deleting…' : 'Yes, delete'}
        </button>{' '}
        <button
          className="ghost small"
          onClick={() => dialog.current?.close()}
          disabled={busy}
          data-testid="video-delete-cancel"
        >
          Keep it
        </button>
        {error && (
          <p className="small error" style={{ margin: '10px 0 0' }} data-testid="video-delete-error">
            {error}
          </p>
        )}
      </dialog>
    </>
  )
}
