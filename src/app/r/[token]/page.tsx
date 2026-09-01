import { notFound } from 'next/navigation'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { ReviewerList } from '@/app/review/ReviewerSurface'

/**
 * ⚠️ THE OLD DOOR. Kept working until a human has signed in at /review and said it worked — the
 * same rule that governed removing the `?k=<ADMIN_TOKEN>` gate. Deleting this route, the tokens
 * and the token column is one commit, and it happens after that confirmation, not before.
 */
export const dynamic = 'force-dynamic'

export default async function ReviewerList_({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Unknown token and revoked token take the SAME branch. A distinct error for "revoked" would
  // confirm to whoever is holding it that the token was once real.
  const identity = await reviewerIdentity(token)
  if (!identity) notFound()

  return <ReviewerList identity={identity} hrefBase={`/r/${encodeURIComponent(token)}`} />
}
