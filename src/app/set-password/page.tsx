import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const MESSAGE: Record<string, string> = {
  short: 'Make it at least 8 characters.',
  match: 'The two passwords did not match. Try again.',
  rate: 'Too many attempts. Wait a minute and try again.',
  '1': 'That did not save. Try again.',
}

/** Where an invite link and a reset link both end: choose the password you will sign in with. */
export default async function SetPassword({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Only reachable with a session — the one the emailed link just created. Anyone else is sent
  // to the same place a dead link goes, so this page does not say which of the two they lack.
  const user = await currentUser()
  if (!user) redirect('/login?error=link')
  const error = (await searchParams).error

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <section className="card" style={{ marginTop: 40, padding: '24px 24px 26px' }}>
        <h1>Choose a password</h1>
        <p className="help">
          You&apos;re signed in as <strong>{user.email}</strong>. Pick a password you&apos;ll remember. At least 8
          characters.
        </p>
        <form method="post" action="/api/auth/password">
          <label className="field" htmlFor="password">
            <span className="fieldname">New password</span>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required data-testid="new-password" />
          </label>
          <label className="field" htmlFor="confirm" style={{ marginTop: 14 }}>
            <span className="fieldname">Type it again</span>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required data-testid="confirm-password" />
          </label>
          {typeof error === 'string' && MESSAGE[error] && (
            <p className="small error" data-testid="password-error">
              {MESSAGE[error]}
            </p>
          )}
          <button type="submit" style={{ marginTop: 18, width: '100%' }} data-testid="save-password">
            Save and continue
          </button>
        </form>
      </section>
    </main>
  )
}
