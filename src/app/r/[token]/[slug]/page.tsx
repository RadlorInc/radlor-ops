import { notFound } from 'next/navigation'
import { notesFor, reviewerByToken, reviewerVideoBySlug } from '@/lib/db'
import Review from './Review'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string; slug: string }>
}) {
  const { token, slug } = await params
  const reviewer = await reviewerByToken(token)
  if (!reviewer) notFound()

  // Filters on status itself, so a draft or a cut being revised is a 404 for the reviewer even if
  // they kept the URL from last week. A video they have MARKED FINISHED still resolves — see
  // REVIEWER_VISIBLE in db.ts.
  const video = await reviewerVideoBySlug(slug)
  if (!video) notFound()

  const notes = await notesFor(video.id, reviewer.id, video.version)

  return (
    <Review
      token={token}
      slug={video.slug}
      title={video.title}
      version={video.version}
      status={video.status}
      reviewerName={reviewer.name}
      reviewerEmail={reviewer.email}
      initialNotes={notes.map((n) => ({ id: n.id, t_seconds: n.t_seconds, body: n.body }))}
    />
  )
}
