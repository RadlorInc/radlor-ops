import { allAssignments, allNotes, allReviewers, allVideos } from '@/lib/db'
import { clearance, progressLabel } from '@/lib/clearance'
import { currentProfile } from '@/lib/session'
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
  // A route handler, not a page: it answers 404 rather than redirecting to a login form, because
  // there is nowhere to render a form inside a text/plain download.
  if ((await currentProfile())?.role !== 'admin') return new Response('Not found', { status: 404 })

  const all = new URL(req.url).searchParams.get('all') === '1'
  const [videos, notes, assignments, reviewers] = await Promise.all([
    allVideos(),
    allNotes(),
    allAssignments(),
    allReviewers(),
  ])
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]))
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
      /**
       * ⚠️ THE VERDICTS ARE ONLY STAMPED ON THE CURRENT VERSION'S HEADING, AND THIS IS THE SAME
       * TRAP `notes.video_version` exists for, one level up. A verdict is the verdict NOW —
       * printing it against a v1 heading for a video that is now at v2 would label an old round
       * with a judgement never passed on it. We do not store verdict history, so older versions get
       * no verdict rather than a borrowed one. If per-version verdicts are ever wanted, that is a
       * `video_version` column on `video_reviewers`, not a change here.
       *
       * ⚠️ AND IT PRINTS EVERY REVIEWER'S ANSWER, NOT A SUMMARY. This export is what gets pasted
       * into a chat and acted on: "APPROVED" over a heading where one of two people asked for
       * changes is how the objection gets posted past. `CLEARED TO POST` appears only when every
       * assigned reviewer approved.
       */
      const mineOnVideo = assignments.filter((a) => a.video_id === v.id)
      const c = clearance(mineOnVideo)
      const said = mineOnVideo
        .filter((a) => a.verdict)
        .map((a) => `${reviewerName.get(a.reviewer_id) ?? 'unknown reviewer'}: ${a.verdict === 'approved' ? 'approved' : 'changes needed'}`)
        .join(', ')
      const stamp =
        version !== v.version || c.assigned === 0
          ? ''
          : c.cleared
            ? ` — CLEARED TO POST (${said})`
            : c.decided === 0
              ? ` — ${progressLabel(c)}`
              : ` — NOT CLEARED · ${progressLabel(c)} · ${said}`
      out.push(`## ${v.slug} — v${version}${stamp}`)
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
