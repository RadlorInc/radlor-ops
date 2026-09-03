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

  const q = await searchParams
  const error = q.error
  const done = q.done

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <section className="card" style={{ marginTop: 40, padding: '24px 24px 26px' }}>
        <h1>Welcome</h1>
        <p className="help">
          {done === 'password'
            ? 'Your new password is saved. Sign in with it.'
            : 'Sign in with your email and password. New here? Use the link you were given.'}
        </p>

        <form method="post" action="/api/auth/login">
          <label className="field" htmlFor="email">
            <span className="fieldname">Email</span>
            <input id="email" name="email" type="email" autoComplete="username" required data-testid="email" />
          </label>

          <label className="field" htmlFor="password" style={{ marginTop: 14 }}>
            <span className="fieldname">Password</span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              data-testid="password"
            />
          </label>

        {error && (
          <p className="small error" data-testid="login-error">
            {error === 'rate'
              ? 'Too many attempts. Wait a minute and try again.'
              : error === 'norole'
                  ? 'Your account is not set up yet. Ask Rafi to add you.'
                  : error === 'link'
                    ? 'That link has expired or was already used. Ask for a new one.'
                    : 'That email and password did not match.'}
          </p>
        )}

          <button type="submit" style={{ marginTop: 18, width: '100%' }} data-testid="sign-in">
            Sign in
          </button>
        </form>

      </section>
    </main>
  )
}
