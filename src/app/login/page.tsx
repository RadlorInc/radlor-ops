import { currentProfile } from '@/lib/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Already signed in? Don't show a login form to someone who is logged in.
  const profile = await currentProfile()
  // ⚠️ Admin lands on /admin, not /review, even though an admin may open both: the surface you are
  // sent to should be the one your role is FOR. Rafi reaches his own review list from there.
  if (profile) redirect(profile.role === 'admin' ? '/admin' : profile.role === 'reviewer' ? '/review' : '/tester')

  const error = (await searchParams).error

  return (
    <main className="wrap" style={{ maxWidth: 380 }}>
      <h1>Radlor</h1>
      <p className="muted small">Sign in. Accounts are created for you — there is no sign-up.</p>

      <form method="post" action="/api/auth/login" style={{ marginTop: 20 }}>
        <label className="small muted" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required data-testid="email" />

        <label className="small muted" htmlFor="password" style={{ marginTop: 12, display: 'block' }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          data-testid="password"
        />

        {error && (
          <p className="small" style={{ color: '#ff9d9d' }} data-testid="login-error">
            {error === 'rate'
              ? 'Too many attempts. Wait a minute and try again.'
              : 'That email and password did not match.'}
          </p>
        )}

        <button type="submit" style={{ marginTop: 14 }} data-testid="sign-in">
          Sign in
        </button>
      </form>
    </main>
  )
}
