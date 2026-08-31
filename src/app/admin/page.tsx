import { notFound } from 'next/navigation'
import { allNotes, allVideos } from '@/lib/db'
import { ADMIN_PARAM, isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const k = sp[ADMIN_PARAM]
  // Wrong key and no key are the same 404 as a route that does not exist. Nothing here says
  // "there is an admin page and you got the password wrong".
  if (!isAdmin(typeof k === 'string' ? k : null)) notFound()

  const [videos, notes] = await Promise.all([allVideos(), allNotes()])

  // Unread = not yet acted on. `resolved_at` is the only thing that clears it.
  const unread = new Map<string, number>()
  for (const n of notes) {
    if (n.resolved_at) continue
    unread.set(n.video_id, (unread.get(n.video_id) ?? 0) + 1)
  }

  const key = typeof k === 'string' ? k : ''

  return (
    <main className="wrap">
      <h1>Videos</h1>
      <p className="muted small">
        <a href={`/admin/export?${ADMIN_PARAM}=${encodeURIComponent(key)}`}>Export all notes as markdown →</a>
      </p>
      <table style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Title</th>
            <th>Status</th>
            <th>Version</th>
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
              <td>{unread.get(v.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {videos.length === 0 && <p className="muted">No videos yet.</p>}
    </main>
  )
}
