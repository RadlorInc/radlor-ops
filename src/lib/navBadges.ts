import 'server-only'
import { allAssignments } from './db'
import { listIssues, listSubscriptions, listTodos } from './adminDb'
import { renewalState } from './renewal'

/**
 * The counts on the tab strip, for an admin, on the pages that have a tab strip.
 *
 * ⚠️ THIS IS A DELIBERATE EXCEPTION TO "THE NAV NEVER QUERIES", AND THE REASON THE RULE EXISTED
 * STILL HOLDS. The rule was written when the nav had three entries and each page already had the
 * numbers: a nav that fetched would have added a round trip to the reviewer's video page for a
 * figure the reviewer cannot act on. Now the admin's sections ARE the nav, and a badge that is
 * absent reads as "nothing waiting" — so on /tester and /review the tabs would have quietly
 * claimed the dashboard was clear.
 *
 * ⚠️ A WRONG BADGE IS WORSE THAN A SLOW ONE. So it is called only where all three conditions hold:
 * the viewer is an ADMIN (nobody else sees these tabs), the page is a LIST page (never
 * /review/<slug>, where a reviewer is watching a video), and the reads are the same handful of
 * rows the dashboard itself loads.
 */
export type NavBadges = {
  costs?: number
  todo?: number
  issues?: number
  videos?: number
  review?: number
}

export async function navBadges(userId: string): Promise<NavBadges> {
  const [subscriptions, todos, issues, assignments] = await Promise.all([
    listSubscriptions(),
    listTodos(),
    listIssues(),
    allAssignments(),
  ])
  const today = new Date()

  // Grouped by video so "not cleared" means the video, not each assignment on it.
  const byVideo = new Map<string, { assigned: number; approved: number }>()
  for (const a of assignments) {
    const v = byVideo.get(a.video_id) ?? { assigned: 0, approved: 0 }
    v.assigned += 1
    if (a.verdict === 'approved') v.approved += 1
    byVideo.set(a.video_id, v)
  }

  return {
    costs: subscriptions.filter((s) => ['soon', 'lapsed'].includes(renewalState(s.renewal_date, today))).length,
    todo: todos.filter((t) => t.status !== 'done').length,
    issues: issues.filter((i) => i.status !== 'resolved').length,
    videos: [...byVideo.values()].filter((v) => v.approved !== v.assigned).length,
    /**
     * ⚠️ NO BADGE ON CHAPTER TESTING, ON PURPOSE. It had one, and it was the open-issue count —
     * the identical number already sitting on the Issues tab two places to its left. Two tabs
     * showing the same figure do not tell you twice; they make you work out whether they mean the
     * same thing, and the moment one of them drifts neither is trusted. `/tester` is where issues
     * are FILED and `/admin?tab=issues` is where they are worked, so the count belongs on the one
     * you act from.
     */
    review: assignments.filter((a) => a.reviewer_id === userId && a.verdict === null).length,
  }
}
