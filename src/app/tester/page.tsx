import { listIssues, listSessions } from '@/lib/adminDb'
import { requireRole } from '@/lib/session'
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
  const [issues, sessions] = await Promise.all([listIssues(), listSessions()])

  return (
    <main className="wrap">
      <h1>Chapter testing</h1>
      <p className="muted small" data-testid="tester-greeting">
        {profile.name} ({profile.role}) ·{' '}
        {profile.role === 'admin' ? <a href="/admin">Dashboard</a> : null}{' '}
        <form method="post" action="/api/auth/logout" style={{ display: 'inline' }}>
          <button className="linky" type="submit" data-testid="sign-out">
            Sign out
          </button>
        </form>
      </p>

      {sessions.length > 0 && (
        <p className="muted small" data-testid="working-record">
          Working record: {sessions.length} session{sessions.length === 1 ? '' : 's'}, about{' '}
          {hours(sessions)}h, {sessions.reduce((s, x) => s + x.issue_count, 0)} issues filed.
          Captured from when you file, not typed.
        </p>
      )}

      <Issues initial={issues} canTriage={profile.role === 'admin'} />
    </main>
  )
}
