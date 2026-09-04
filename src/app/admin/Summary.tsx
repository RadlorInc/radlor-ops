import Link from 'next/link'
import type { Subscription, Todo, Issue } from '@/lib/adminDb'
import type { Video } from '@/lib/db'
import type { Clearance } from '@/lib/clearance'
import { progressLabel } from '@/lib/clearance'
import { renewalLabel, renewalState } from '@/lib/renewal'

/**
 * The Dashboard tab: one card per section, each one the smallest thing that answers "do I need to
 * open this?".
 *
 * ⚠️ IT IS SERVER-RENDERED, AND THAT IS ONLY SAFE BECAUSE OF WHERE IT SITS. The per-section
 * summaries deliberately live INSIDE Costs/Todos/AdminIssues, because those lists mutate
 * client-side and a summary rendered elsewhere would disagree with the list it summarises the
 * moment anybody clicked something. This one cannot: the lists it summarises are not on screen at
 * the same time as it, and switching to one is a navigation, so it is a fresh server render every
 * time. Do not "improve" this by moving the section summaries up here.
 *
 * ⚠️ AND EVERY CARD SAYS WHAT IS WAITING, NOT HOW MUCH EXISTS. "3 open of 4" is a reason to click;
 * "4 items" is a number that never changes and stops being read.
 */
export default function Summary({
  subscriptions,
  todos,
  issues,
  rows,
  unread,
  today,
}: {
  subscriptions: Subscription[]
  todos: Todo[]
  issues: Issue[]
  rows: { video: Video; c: Clearance }[]
  unread: Map<string, number>
  today: Date
}) {
  const monthly = subscriptions.reduce((s, r) => s + Number(r.monthly_cost ?? 0), 0)
  const dated = subscriptions
    .filter((r) => r.renewal_date)
    .sort((a, b) => (a.renewal_date! < b.renewal_date! ? -1 : 1))
  const next = dated[0]

  const openTodos = todos.filter((t) => t.status !== 'done').length
  const openIssues = issues.filter((i) => i.status !== 'resolved').length
  const assigned = rows.filter((r) => r.c.assigned > 0)
  const notCleared = assigned.filter((r) => !r.c.cleared)
  const disagreeing = assigned.filter((r) => r.c.disagreement)
  const unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0)

  return (
    <div className="summary" data-testid="summary">
      <Link prefetch={false} className="card sumcard" href="/admin?tab=costs">
        <h2>Costs and renewals</h2>
        {/* The one number this dashboard leads with. Exactly one hero on this view. */}
        <p className="hero">
          <span className="figure">$ {monthly.toFixed(2)}</span>
          <span className="unit">a month across {subscriptions.length}</span>
        </p>
        {next ? (
          <p className="muted small" data-testid="summary-next-renewal">
            Next: <strong>{next.tool}</strong>{' '}
            <span className={`pill pill-${renewalState(next.renewal_date, today)}`}>
              {renewalLabel(next.renewal_date, today)}
            </span>
          </p>
        ) : (
          <p className="muted small">No renewal dates yet.</p>
        )}
      </Link>

      <Link prefetch={false} className="card sumcard" href="/admin?tab=todo">
        <h2>To-do</h2>
        <p className="bignum" data-testid="summary-todo">
          {openTodos} <span className="unit">open of {todos.length}</span>
        </p>
        <span className="meter" data-state={openTodos === 0 ? 'cleared' : undefined}>
          <span className="track">
            <span
              className="fill"
              style={{ width: `${todos.length ? ((todos.length - openTodos) / todos.length) * 100 : 0}%` }}
            />
          </span>
          <span className="count">{todos.length - openTodos} done</span>
        </span>
      </Link>

      <Link prefetch={false} className="card sumcard" href="/tester">
        {/* Links to /tester, because that is where issues are now read and triaged — the admin
            Issues tab was the same list under a second name and has been removed. */}
        <h2>Tester issues</h2>
        <p className="bignum" data-testid="summary-issues">
          {openIssues} <span className="unit">needing something of {issues.length}</span>
        </p>
        <span className="meter" data-state={openIssues === 0 ? 'cleared' : undefined}>
          <span className="track">
            <span
              className="fill"
              style={{ width: `${issues.length ? ((issues.length - openIssues) / issues.length) * 100 : 0}%` }}
            />
          </span>
          <span className="count">{issues.length - openIssues} resolved</span>
        </span>
      </Link>

      <Link prefetch={false} className="card sumcard" href="/admin?tab=videos">
        <h2>Marketing material</h2>
        <p className="bignum" data-testid="summary-videos">
          {notCleared.length} <span className="unit">not cleared of {assigned.length} out for review</span>
        </p>
        {/* ⚠️ Named, not counted. "2 not cleared" tells you to open the tab; the slug and the
            reason tell you whether it is the one you were about to post. */}
        <ul className="minilist">
          {notCleared.slice(0, 3).map((r) => (
            <li key={r.video.id}>
              <code>{r.video.slug}</code>{' '}
              <span className="muted">
                {r.c.disagreement ? 'disagreement' : progressLabel(r.c)}
              </span>
            </li>
          ))}
          {notCleared.length > 3 && <li className="muted">and {notCleared.length - 3} more</li>}
          {notCleared.length === 0 && <li className="muted">Everything assigned is cleared.</li>}
        </ul>
        <p className="muted small">
          {disagreeing.length > 0 && `${disagreeing.length} with a standing objection · `}
          {unreadTotal} unread note{unreadTotal === 1 ? '' : 's'}
        </p>
      </Link>
    </div>
  )
}
