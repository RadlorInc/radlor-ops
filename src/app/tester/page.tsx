import { requireRole } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** Phase 3 fills this in. It exists now so the role gate has a second surface to be tested on. */
export default async function Tester() {
  const profile = await requireRole('tester', 'admin')
  return (
    <main className="wrap">
      <h1>Chapter testing</h1>
      <p className="muted small" data-testid="tester-greeting">
        Signed in as {profile.name} ({profile.role}).
      </p>
      <p className="muted" style={{ marginTop: 20 }}>
        The issue log lands here next.
      </p>
      <form method="post" action="/api/auth/logout" style={{ marginTop: 24 }}>
        <button className="ghost" type="submit" data-testid="sign-out">
          Sign out
        </button>
      </form>
    </main>
  )
}
