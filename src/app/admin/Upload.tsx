'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Person = { user_id: string; name: string; role: string; can_approve: boolean }

/**
 * ADD A CUT AND SEND IT OUT FOR REVIEW.
 *
 * ⚠️ THREE STEPS, AND THE MIDDLE ONE DOES NOT TOUCH THIS APP. Ask the server for a row and a
 * one-shot upload URL; PUT the file straight to Supabase; tell the server it landed. A form that
 * posted the file here would die on a serverless body limit at about the third video.
 *
 * ⚠️ AND THE STEP IS ON SCREEN THE WHOLE TIME. A video upload is the one thing in this app that
 * takes long enough for a person to wonder whether it is working — a spinner with no words is how
 * somebody reloads the page half way and leaves a draft behind.
 */
export default function Upload({ people }: { people: Person[] }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Who will be asked. Set on the People tab, not here: the picker this form had for a day let the
   *  admin name a different person per cut, and the ask was the opposite — one person holds it. The
   *  route reads the same flag itself; this is the form saying so before the button is pressed. */
  const approvers = people.filter((p) => p.can_approve)

  async function send() {
    if (!file || !title.trim()) return
    setError(null)
    try {
      setStep('Making room for it…')
      const made = await fetch('/api/admin/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), filename: file.name }),
      })
      if (!made.ok) {
        const b = (await made.json().catch(() => ({}))) as { error?: string; slug?: string }
        throw new Error(
          b.error === 'slug_taken'
            ? `There is already a video called “${b.slug}”. Give this one a different title.`
            : b.error === 'bad_format'
              ? 'That file type will not play in a browser. Use .mp4, .webm, .mov or .m4v.'
              : b.error === 'no_approver'
                ? 'Nobody is set to approve cuts yet. Pick someone on the People tab first.'
                : 'Could not start the upload.',
        )
      }
      const { id, storage_path, uploadUrl } = (await made.json()) as {
        id: string
        storage_path: string
        uploadUrl: string
      }

      setStep(`Uploading ${file.name}…`)
      const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } })
      // ⚠️ A FAILED PUT IS NOT A FAILED FEATURE. The row is already there as a draft, so say what
      // actually happened rather than implying nothing was created.
      if (!put.ok) throw new Error('The file did not upload. The video is saved as a draft — try it again.')

      setStep('Checking it plays back…')
      const done = await fetch('/api/admin/video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, storage_path }),
      })
      if (!done.ok) throw new Error('It uploaded but could not be read back, so it is still a draft.')

      setTitle('')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setStep(null)
      router.refresh()
    } catch (e) {
      setStep(null)
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }

  const busy = step !== null
  const noApprover = approvers.length === 0

  return (
    <div className="card filecard" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: '0 0 4px' }}>Add a cut</h3>
      <p className="muted small" style={{ margin: '0 0 12px' }} data-testid="upload-approver">
        Everyone with a reviewer account can watch it and leave notes.{' '}
        {noApprover
          ? 'Nobody is set to approve cuts yet — pick someone on the People tab before sending one out.'
          : `${approvers.map((p) => p.name).join(' and ')} ${approvers.length === 1 ? 'approves' : 'approve'} or ${approvers.length === 1 ? 'rejects' : 'reject'} it.`}
      </p>

      <label className="field">
        <span className="fieldname">What is it called?</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          placeholder="e.g. Equals sign reel"
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          data-testid="upload-title"
        />
      </label>

      <label className="field" style={{ marginTop: 10 }}>
        <span className="fieldname">The file</span>
        <input
          ref={fileInput}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          data-testid="upload-file"
        />
      </label>

      <button
        className="send"
        style={{ marginTop: 14 }}
        onClick={send}
        disabled={busy || !file || !title.trim() || noApprover}
        data-testid="upload-send"
      >
        {busy ? 'Working…' : 'Send it out'}
      </button>

      {step && (
        <p className="muted small" data-testid="upload-step">
          {step}
        </p>
      )}
      {error && (
        <p className="small error" data-testid="upload-error">
          {error}
        </p>
      )}
    </div>
  )
}
