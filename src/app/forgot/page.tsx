export const dynamic = 'force-dynamic'

/** "Forgot your password?" — one field, and the same answer whatever is typed into it. */
export default async function Forgot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const q = await searchParams
  const sent = q.sent === '1'
  const rate = q.error === 'rate'

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <section className="card" style={{ marginTop: 40, padding: '24px 24px 26px' }}>
        <h1>Reset your password</h1>
        {sent ? (
          <p className="help" data-testid="forgot-sent">
            If that address has an account, a link is on its way. Open it and you&apos;ll be asked to choose a new
            password. It can take a minute to arrive — check the spam folder too.
          </p>
        ) : (
          <>
            <p className="help">Type the email you sign in with. We&apos;ll send a link that lets you choose a new password.</p>
            <form method="post" action="/api/auth/forgot">
              <label className="field" htmlFor="email">
                <span className="fieldname">Email</span>
                <input id="email" name="email" type="email" autoComplete="username" required data-testid="forgot-email" />
              </label>
              {rate && (
                <p className="small error" data-testid="forgot-error">
                  Too many attempts. Wait a minute and try again.
                </p>
              )}
              <button type="submit" style={{ marginTop: 18, width: '100%' }} data-testid="forgot-send">
                Send me a link
              </button>
            </form>
          </>
        )}
        <p className="small" style={{ marginTop: 16 }}>
          <a href="/login">← Back to sign in</a>
        </p>
      </section>
    </main>
  )
}
