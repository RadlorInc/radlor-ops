import { requireRole } from '@/lib/session'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { ReviewerVideo } from '../ReviewerSurface'

export const dynamic = 'force-dynamic'

export default async function ReviewVideo({ params }: { params: Promise<{ slug: string }> }) {
  await requireRole('reviewer', 'admin')
  const identity = await reviewerIdentity(null)
  if (!identity) throw new Error('role gate passed but no identity — impossible unless one changed')

  const { slug } = await params
  return <ReviewerVideo identity={identity} slug={slug} token={null} listHref="/review" />
}
