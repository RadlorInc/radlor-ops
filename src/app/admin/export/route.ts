import { allNotes, allVideos } from '@/lib/db'
import { ADMIN_PARAM, isAdmin } from '@/lib/admin'
import { formatT } from '@/lib/review'

/**
 * Every note, as markdown, grouped by video and version and sorted by timestamp. This is the
 * actual output of the tool — it is meant to be selected and pasted straight into a chat, which is
 * why it is served as `text/plain` (the browser shows the source instead of offering a download).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get(ADMIN_PARAM)
  if (!isAdmin(k)) return new Response('Not found', { status: 404 })

  const [videos, notes] = await Promise.all([allVideos(), allNotes()])
  const bySlug = new Map(videos.map((v) => [v.id, v]))

  // video id → version → notes. ponytail: grouped in memory; the ceiling is one founder's whole
  // note history, which is kilobytes.
  const grouped = new Map<string, Map<number, typeof notes>>()
  for (const n of notes) {
    if (!bySlug.has(n.video_id)) continue
    const versions = grouped.get(n.video_id) ?? new Map()
    versions.set(n.video_version, [...(versions.get(n.video_version) ?? []), n])
    grouped.set(n.video_id, versions)
  }

  const out: string[] = []
  for (const v of videos) {
    const versions = grouped.get(v.id)
    if (!versions) continue
    for (const version of [...versions.keys()].sort((a, b) => a - b)) {
      out.push(`## ${v.slug} — v${version}`)
      const list = versions.get(version)!
      for (const n of [...list].sort((a, b) => a.t_seconds - b.t_seconds || a.created_at.localeCompare(b.created_at))) {
        // A note body with a newline in it would break the list item into loose prose, so the
        // whitespace is flattened. Nothing else about the text is touched.
        out.push(`- ${formatT(n.t_seconds)} — ${n.body.replace(/\s+/g, ' ').trim()}`)
      }
      out.push('')
    }
  }

  return new Response(out.join('\n') || 'No notes yet.\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
