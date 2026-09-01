import { notFound } from 'next/navigation'
import { myAssignment, notesFor, reviewerByToken, reviewerVideoBySlug } from '@/lib/db'
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

  // Filters on the ASSIGNMENT and on status, so three different things are the same 404: a draft,
  // a cut being revised, and a video this reviewer was never assigned. A video they have MARKED
  // FINISHED still resolves — see REVIEWER_VISIBLE in db.ts.
  const video = await reviewerVideoBySlug(slug, reviewer.id)
  if (!video) notFound()

  const [notes, mine] = await Promise.all([
    notesFor(video.id, reviewer.id, video.version),
    myAssignment(video.id, reviewer.id),
  ])

  return (
    <Review
      token={token}
      slug={video.slug}
      title={video.title}
      version={video.version}
      verdict={mine?.verdict ?? null}
      reviewerName={reviewer.name}
      reviewerEmail={reviewer.email}
      initialNotes={notes.map((n) => ({ id: n.id, t_seconds: n.t_seconds, body: n.body }))}
    />
  )
}
