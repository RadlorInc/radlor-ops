import { allNotes, allVideos } from '@/lib/db'
import { requireRole } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function Admin() {
  const me = await requireRole('admin')

  const [videos, notes] = await Promise.all([allVideos(), allNotes()])

  // Unread = not yet acted on. `resolved_at` is the only thing that clears it.
  const unread = new Map<string, number>()
  for (const n of notes) {
    if (n.resolved_at) continue
    unread.set(n.video_id, (unread.get(n.video_id) ?? 0) + 1)
  }

  const approvedWithOpenNotes = videos.filter((v) => v.verdict === 'approved' && (unread.get(v.id) ?? 0) > 0)

  return (
    <main className="wrap">
      <h1>Videos</h1>
      <p className="muted small">
        {me.name} · <a href="/tester">Chapter testing</a> ·{' '}
        <span data-testid="signout-inline">
          <form method="post" action="/api/auth/logout" style={{ display: 'inline' }}>
            <button className="linky" type="submit" data-testid="sign-out">
              Sign out
            </button>
          </form>
        </span>
      </p>
      <p className="muted small">
        <a href="/admin/export">Open notes as markdown →</a> ·{' '}
        <a href="/admin/export?all=1">including resolved</a>
      </p>
      <table style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Title</th>
            <th>Status</th>
            <th>Version</th>
            <th>Verdict</th>
            <th>Unread notes</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id} data-testid="admin-row">
              <td>
                <code>{v.slug}</code>
              </td>
              <td>{v.title}</td>
              <td>{v.status}</td>
              <td>v{v.version}</td>
              <td data-testid="verdict-cell">
                {v.verdict === 'approved' ? 'approved' : v.verdict === 'changes_needed' ? 'changes needed' : '—'}
              </td>
              <td>{unread.get(v.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* ⚠️ APPROVED WITH OPEN NOTES IS A REAL STATE, NOT A CONTRADICTION. The reviewer liked it
          and still left things worth reading. Not blocked — that is Rafi's call — but never
          silent, because the failure it guards against is uploading past feedback nobody read. */}
      {approvedWithOpenNotes.length > 0 && (
        <div className="warn" data-testid="approved-with-notes">
          <strong>Approved, and still has open notes.</strong> Worth reading before you post:{' '}
          {approvedWithOpenNotes.map((v) => `${v.slug} · ${unread.get(v.id)} open note${unread.get(v.id) === 1 ? '' : 's'}`).join(', ')}.
        </div>
      )}

      {videos.length === 0 && <p className="muted">No videos yet.</p>}
    </main>
  )
}
