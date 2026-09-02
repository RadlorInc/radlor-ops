import 'server-only'
import { allAssignments, type Assignment } from './db'
import { listIssues, listSubscriptions, listTodos, type Issue, type Subscription, type Todo } from './adminDb'
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

/**
 * ⚠️ THE PURE HALF, AND THE REASON IT IS SPLIT OUT. `/admin` already loads all four of these lists
 * for the page itself. Calling `navBadges()` there fetched them a SECOND time, and — because it
 * was a separate `await` after the page's own `Promise.all` — it did so in a whole extra
 * sequential round trip. On a page where one Supabase round trip is the unit of latency, that was
 * a quarter of the wait, spent re-reading rows already in memory.
 *
 * So: pages that have the rows call this; pages that do not call `navBadges()` below, which
 * fetches and then calls this. One definition of what a badge counts, two ways to feed it.
 */
export function badgesFrom({
  subscriptions,
  todos,
  issues,
  assignments,
  userId,
  today = new Date(),
}: {
  subscriptions: Subscription[]
  todos: Todo[]
  issues: Issue[]
  assignments: Assignment[]
  userId: string
  today?: Date
}): NavBadges {

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
     * ⚠️ `issues` NOW BADGES CHAPTER TESTING, WHICH IS THE ONLY PLACE ISSUES LIVE. It briefly sat
     * on an admin "Issues" tab as well, and having the same figure on two tabs did not tell you
     * twice — it made you work out whether they meant the same thing. They did, which is why that
     * tab is gone: it was `/tester` again under another name.
     */
    review: assignments.filter((a) => a.reviewer_id === userId && a.verdict === null).length,
  }
}

/** For the pages that do not already hold these rows — `/tester` and the reviewer list. */
export async function navBadges(userId: string): Promise<NavBadges> {
  const [subscriptions, todos, issues, assignments] = await Promise.all([
    listSubscriptions(),
    listTodos(),
    listIssues(),
    allAssignments(),
  ])
  return badgesFrom({ subscriptions, todos, issues, assignments, userId })
}
