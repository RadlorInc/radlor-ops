import { notFound } from 'next/navigation'
import { usableInviteLink, userEmail } from '@/lib/db'
import { hashToken } from '@/lib/inviteToken'

export const dynamic = 'force-dynamic'

const MESSAGE: Record<string, string> = {
  short: 'Make it at least 8 characters.',
  match: 'The two passwords did not match. Try again.',
  rate: 'Too many attempts. Wait a minute and try again.',
  '1': 'That did not save. Try again.',
}

/**
 * The link the tester head forwarded. It is the only door into a brand-new account — the account
 * has no password until this page sets one — and it is single use.
 *
 * ⚠️ SPENT, SUPERSEDED, EXPIRED AND UNKNOWN ARE ALL THE SAME 404. `usableInviteLink` collapses
 * them, and this page must not un-collapse them: telling somebody holding a dead link that it was
 * "already used" tells them it was once real, and which addresses this tool knows about is the one
 * thing a forwarded link should not be able to reveal.
 */
export default async function Join({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const link = await usableInviteLink(hashToken(token))
  if (!link) notFound()

  const email = await userEmail(link.user_id)
  const error = (await searchParams).error

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <section className="card" style={{ marginTop: 40, padding: '24px 24px 26px' }}>
        <h1>Choose a password</h1>
        <p className="help">
          This link sets up <strong>{email}</strong>. Pick a password you&apos;ll remember — at least 8
          characters — and you&apos;ll be signed in. From then on you sign in with that email and password.
        </p>
        {/* Form-encoded, like the sign-in form: the password goes from the browser's own submission
            to the route to Supabase, and never through page script. */}
        <form method="post" action="/api/join">
          <input type="hidden" name="token" value={token} />
          <label className="field" htmlFor="password">
            <span className="fieldname">Password</span>
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
