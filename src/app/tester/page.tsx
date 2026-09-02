import { listIssues, listProfiles, listSessions } from '@/lib/adminDb'
import { requireRole } from '@/lib/session'
import RoleNav from '../RoleNav'
import { navBadges } from '@/lib/navBadges'
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
  const [issues, sessions, people] = await Promise.all([
    listIssues(),
    listSessions(),
    // Only a triager needs to know whose issue it is; a tester reads their own name back otherwise.
    profile.role === 'admin' ? listProfiles() : Promise.resolve([]),
  ])
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]))

  return (
    <main className="wrap">
      <RoleNav
        role={profile.role}
        current="/tester"
        name={`${profile.name} (${profile.role})`}
        /* ⚠️ An admin's strip now carries the dashboard's sections, and a MISSING badge reads as
           "nothing waiting" — so this page has to supply them even though none of them are about
           chapter testing. A tester never sees those tabs, so it never pays for them. */
        badges={profile.role === 'admin' ? await navBadges(profile.user_id) : undefined}
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
