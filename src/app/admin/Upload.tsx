'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Person = { user_id: string; name: string; role: string }

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
  const [chosen, setChosen] = useState<string[]>([])
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** ⚠️ REVIEWERS AND ADMINS, NEVER TESTERS. A tester has no reviewer surface, so assigning one
   *  puts a video in a queue that person cannot open — the interface would be promising something
   *  the role gate refuses. Admins are here because the one reviewer in production is also one. */
  const assignable = people.filter((p) => p.role === 'reviewer' || p.role === 'admin')

  function toggle(id: string) {
    setChosen((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))
  }

  async function send() {
    if (!file || !title.trim()) return
    setError(null)
    try {
      setStep('Making room for it…')
      const made = await fetch('/api/admin/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), filename: file.name, reviewers: chosen }),
      })
      if (!made.ok) {
        const b = (await made.json().catch(() => ({}))) as { error?: string; slug?: string }
        throw new Error(
          b.error === 'slug_taken'
            ? `There is already a video called “${b.slug}”. Give this one a different title.`
            : b.error === 'bad_format'
              ? 'That file type will not play in a browser. Use .mp4, .webm, .mov or .m4v.'
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
      setChosen([])
      if (fileInput.current) fileInput.current.value = ''
      setStep(null)
      router.refresh()
    } catch (e) {
      setStep(null)
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }

  const busy = step !== null

  return (
    <div className="card filecard" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: '0 0 4px' }}>Add a cut</h3>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        It goes out to whoever you tick. Nobody ticked means nobody sees it — it waits as a draft.
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

      <div className="field" style={{ marginTop: 10 }}>
        <span className="fieldname">Who should review it?</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {assignable.map((p) => (
            <button
              key={p.user_id}
              className="chip"
              onClick={() => toggle(p.user_id)}
              disabled={busy}
              aria-pressed={chosen.includes(p.user_id)}
              style={chosen.includes(p.user_id) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              data-testid={`upload-reviewer-${p.user_id}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <button
        className="send"
        style={{ marginTop: 14 }}
        onClick={send}
        disabled={busy || !file || !title.trim()}
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
