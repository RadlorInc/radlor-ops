import { listIssues, listProfiles, listSessions, listSubscriptions, listTodos, type Subscription, type Todo } from '@/lib/adminDb'
import { allAssignments, type Assignment } from '@/lib/db'
import { requireRole } from '@/lib/session'
import RoleNav from '../RoleNav'
import { badgesFrom } from '@/lib/navBadges'
import Issues from './Issues'

export const dynamic = 'force-dynamic'

/** Hours are derived, never typed. An approximation, and honest about being one. */
function hours(sessions: { started_at: string; last_seen_at: string }[]) {
  const ms = sessions.reduce((s, x) => s + (Date.parse(x.last_seen_at) - Date.parse(x.started_at)), 0)
  return (ms / 3_600_000).toFixed(1)
}

export default async function Tester() {
  const profile = await requireRole('tester', 'admin')
  // ⚠️ No `reporter` filter on either call — `issues_read_own` and `sessions_own` decide what comes
  // back. A tester gets their own; an admin gets everyone's. Same query, two answers.
  /**
   * ⚠️ ONE WAVE, NOT TWO. The badge counts used to come from `navBadges()`, which fetches — and
   * being a separate `await` after this list, it spent a whole extra sequential round trip. Every
   * Supabase read from the function crosses to us-west-2, so a wave is the unit of latency here,
   * not a query. Everything this page needs now goes in one `Promise.all` and `badgesFrom()` does
   * the counting.
   *
   * ⚠️ A TESTER FETCHES ALMOST NONE OF IT. The four badge lists exist only to label an ADMIN's
   * tabs; a tester has a single tab and no use for them, so those slots resolve to empty arrays
   * without a request. The strip they cannot see costs them nothing.
   */
  const admin = profile.role === 'admin'
  const none = <T,>(): Promise<T[]> => Promise.resolve([])
  const [issues, sessions, people, subscriptions, todos, assignments] = await Promise.all([
    listIssues(),
    listSessions(),
    // Only a triager needs to know whose issue it is; a tester reads their own name back otherwise.
    admin ? listProfiles() : none<{ user_id: string; name: string }>(),
    admin ? listSubscriptions() : none<Subscription>(),
    admin ? listTodos() : none<Todo>(),
    admin ? allAssignments() : none<Assignment>(),
  ])
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]))
  const badges = admin
    ? badgesFrom({ subscriptions, todos, issues, assignments, userId: profile.user_id })
    : undefined

  return (
    <main className="wrap">
      <RoleNav
        role={profile.role}
        current="/tester"
        name={`${profile.name} (${profile.role})`}
        /* ⚠️ An admin's strip now carries the dashboard's sections, and a MISSING badge reads as
           "nothing waiting" — so this page has to supply them even though none of them are about
           chapter testing. A tester never sees those tabs, so it never pays for them. */
        badges={badges}
      />
      <h1 data-testid="tester-greeting">Chapter testing</h1>

      {sessions.length > 0 && (
        <p className="muted small" data-testid="working-record">
          Working record: {sessions.length} session{sessions.length === 1 ? '' : 's'}, about{' '}
          {hours(sessions)}h, {sessions.reduce((s, x) => s + x.issue_count, 0)} issues filed.
          Captured from when you file, not typed.
        </p>
      )}

      <Issues initial={issues} canTriage={profile.role === 'admin'} names={names} />
    </main>
  )
}
