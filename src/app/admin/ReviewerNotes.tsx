import { formatT } from '@/lib/review'
import type { Note, Video } from '@/lib/db'

/**
 * WHAT THE REVIEWERS ACTUALLY WROTE, ON THE PAGE THE ADMIN IS ALREADY LOOKING AT.
 *
 * ⚠️ THIS EXISTS BECAUSE THE DASHBOARD COULD COUNT NOTES AND NOT SHOW THEM. The table has had an
 * *Unread notes* column since the beginning, and the only way to READ one was `/admin/export` —
 * a plain-text page behind a small grey link above the table. Rafi, 2026-09-10: *"as an admin the
 * notes the reviewer left for changes, I can't see them at all."* Three real notes were sitting in
 * the database at the time. A number that tells you something is waiting, with no way to read it
 * from there, is worse than no number: it is the tool saying "there is feedback" and then keeping
 * it. The export stays — it is for pasting into a chat — but it is no longer the only door.
 *
 * ⚠️ IT IS SERVER-RENDERED FROM ROWS THE PAGE ALREADY HAS, and adds no query. `/admin` fetches
 * `allNotes()` for the two counts either way; this only renders them.
 *
 * ⚠️ NATIVE `<details>`, NO CLIENT COMPONENT. The two other "more about this row" controls in this
 * tab are dialogs (Watch, DeleteVideo) because they need a fetch and a focus trap. Reading text
 * needs neither, and a disclosure that works with JavaScript broken is one less thing to own.
 * Open by default when something is unread, closed when it has all been dealt with — the default
 * is the answer to "is there anything here for me", which is the question the count used to fail.
 */
type NoteRow = Note & { reviewer_id: string }

export default function ReviewerNotes({
  videos,
  notes,
  reviewerName,
}: {
  videos: Video[]
  notes: NoteRow[]
  reviewerName: Map<string, string>
}) {
  // video id → version → notes. Same shape as the export builds, for the same reason: a note
  // belongs to the cut it was written against, not to the cut as it stands now.
  const byVideo = new Map<string, Map<number, NoteRow[]>>()
  for (const n of notes) {
    const versions = byVideo.get(n.video_id) ?? new Map<number, NoteRow[]>()
    versions.set(n.video_version, [...(versions.get(n.video_version) ?? []), n])
    byVideo.set(n.video_id, versions)
  }

  const withNotes = videos.filter((v) => byVideo.has(v.id))

  return (
    <section style={{ marginTop: 28 }} data-testid="reviewer-notes">
      <h3 style={{ margin: '0 0 4px' }}>What the reviewers said</h3>
      <p className="help">
        Every note anyone left, newest cut first as the table orders them. A cut with nothing
        outstanding starts closed.
      </p>

      {withNotes.length === 0 && <p className="muted small">No notes yet.</p>}

      {withNotes.map((v) => {
        const versions = byVideo.get(v.id)!
        const all = [...versions.values()].flat()
        const open = all.filter((n) => !n.resolved_at).length
        const done = all.length - open
        return (
          <details className="group" key={v.id} open={open > 0} data-testid="video-notes" data-slug={v.slug}>
            <summary>
              {v.title} <code>{v.slug}</code>{' '}
              <span className="muted small">
                {open} open{done > 0 ? `, ${done} done` : ''}
              </span>
            </summary>

            {[...versions.keys()]
              .sort((a, b) => b - a)
              .map((version) => (
                <div key={version} data-version={version}>
                  {/* ⚠️ THE VERSION IS NAMED WHENEVER IT COULD MISLEAD — an older cut's notes, or
                      more than one round on screen at once. Silently listing a v1 note under a
                      video now at v2 is the exact confusion `notes.video_version` was added to
                      prevent, one layer down. On the common case (one round, current version) it
                      prints nothing, because a label that is always there stops being read. */}
                  {(versions.size > 1 || version !== v.version) && (
                    <p className="muted small" style={{ margin: '10px 0 0' }}>
                      v{version}
                      {version !== v.version && ' — an earlier cut'}
                    </p>
                  )}
                  <ol className="todos">
                    {[...versions.get(version)!]
                      .sort((a, b) => a.t_seconds - b.t_seconds || a.created_at.localeCompare(b.created_at))
                      .map((n) => (
                        <li key={n.id} data-testid="admin-note">
                          <span className="chip">{formatT(n.t_seconds)}</span>
                          {/* Struck through once it has been acted on, the same signal the export
                              sends with `~~`. `resolved_at` is set by hand in SQL today. */}
                          <span className={n.resolved_at ? 'strike' : undefined} data-testid="note-body">
                            {n.body}
                          </span>
                          {/* ⚠️ WHO WROTE IT, ALWAYS. Every reviewer can leave notes on every cut
                              since 2026-09-09, so an unattributed list is a pile of opinions with
                              no way to ask anybody about one. */}
                          <span className="muted small" style={{ marginLeft: 'auto', paddingLeft: 10 }}>
                            {reviewerName.get(n.reviewer_id) ?? 'unknown reviewer'}
                          </span>
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
          </details>
        )
      })}
    </section>
  )
}
