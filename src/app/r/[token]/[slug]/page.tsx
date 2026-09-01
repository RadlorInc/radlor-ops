import { notFound } from 'next/navigation'
import { reviewerIdentity } from '@/lib/reviewerIdentity'
import { ReviewerVideo } from '@/app/review/ReviewerSurface'

/** The old door's video page. See the note in ../page.tsx. */
export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string; slug: string }>
}) {
  const { token, slug } = await params
  const identity = await reviewerIdentity(token)
  if (!identity) notFound()

  return (
    <ReviewerVideo
      identity={identity}
      slug={slug}
      token={identity.via === 'token' ? token : null}
      listHref={identity.via === 'token' ? `/r/${encodeURIComponent(token)}` : '/review'}
    />
  )
}
