import { requireRole } from '@/lib/session'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { ReviewerList } from './ReviewerSurface'

/** Never cached: the list is per-person and changes as videos are assigned and reviewed. */
export const dynamic = 'force-dynamic'

export default async function ReviewHome() {
  // ⚠️ `admin` is allowed on purpose — roles gate the surface, assignments decide what is on it.
  // An admin with no assignments gets the empty list, which is the right answer and not an error.
  await requireRole('reviewer', 'admin')
  const identity = await reviewerIdentity()
  if (!identity) throw new Error('role gate passed but no identity — impossible unless one changed')

  return <ReviewerList identity={identity} />
}
