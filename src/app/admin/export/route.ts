import { cookies } from 'next/headers'
import { allNotes, allVideos } from '@/lib/db'
import { ADMIN_COOKIE, tokenValid } from '@/lib/admin'
import { formatT } from '@/lib/review'

/**
 * Every OPEN note, as markdown, grouped by video and version and sorted by timestamp. This is the
 * actual output of the tool — meant to be selected and pasted straight into a chat, which is why
 * it is `text/plain` (the browser shows the source instead of offering a download).
 *
 * Resolved notes are hidden by default and the footer says how many, so a short export is never
 * silently a truncated one. `?all=1` includes them, struck through. That is what makes
 * `resolved_at` a column something reads: after a bump to v2 the reviewer's panel clears, so an
 * unresolved v1 note exists ONLY here, and an export that cannot tell open from done loses it.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!tokenValid((await cookies()).get(ADMIN_COOKIE)?.value)) return new Response('Not found', { status: 404 })

  const all = new URL(req.url).searchParams.get('all') === '1'
  const [videos, notes] = await Promise.all([allVideos(), allNotes()])
  const known = new Set(videos.map((v) => v.id))

  const mine = notes.filter((n) => known.has(n.video_id))
  const shown = mine.filter((n) => all || !n.resolved_at)
  const hidden = mine.length - shown.length

  // video id → version → notes.
  const grouped = new Map<string, Map<number, typeof notes>>()
  for (const n of shown) {
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
        const body = n.body.replace(/\s+/g, ' ').trim()
        out.push(`- ${formatT(n.t_seconds)} — ${n.resolved_at ? `~~${body}~~` : body}`)
      }
      out.push('')
    }
  }

  if (!out.length) out.push(all ? 'No notes yet.' : 'Nothing open.', '')
  if (hidden > 0) {
    out.push(`_${hidden} resolved note${hidden === 1 ? '' : 's'} hidden — add \`?all=1\` to include ${hidden === 1 ? 'it' : 'them'}._`)
  }

  return new Response(out.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
