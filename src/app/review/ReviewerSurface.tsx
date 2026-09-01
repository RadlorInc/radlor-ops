import Link from 'next/link'
import { notFound } from 'next/navigation'
import { myAssignment, notesFor, reviewerVideoBySlug, videosForReviewer } from '@/lib/db'
import type { ReviewerIdentity } from '@/lib/reviewerIdentity'
import Review from './Review'

/**
 * The reviewer's two screens, rendered from an IDENTITY rather than from a token.
 *
 * The token door has been removed; deleting it was two page files and nothing in here changed,
 * which is what sharing one implementation bought.
 */

export async function ReviewerList({ identity }: { identity: ReviewerIdentity }) {
  const videos = await videosForReviewer(identity.id)

  return (
    <main className="wrap">
      <h1>Radlor — videos to review</h1>
      <p className="muted small">
        Signed in as {identity.name}.{' '}
        <span data-testid="signout-inline">
          <form method="post" action="/api/auth/logout" style={{ display: 'inline' }}>
            <button className="linky" type="submit" data-testid="sign-out">
              Sign out
            </button>
          </form>
        </span>
      </p>

      {videos.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }} data-testid="nothing-assigned">
          Nothing waiting on you right now. This page will fill up when the next cut is ready.
        </p>
      ) : (
        <div style={{ marginTop: 20 }}>
          {videos.map((v) => (
            <Link key={v.id} className="card" href={`/review/${v.slug}`} data-testid="video-card">
              <strong>{v.title}</strong>
              <div className="muted small">
                {v.slug} · v{v.version}
                {v.myVerdict && ' · you marked this finished'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

export async function ReviewerVideo({ identity, slug }: { identity: ReviewerIdentity; slug: string }) {
  // Filters on the ASSIGNMENT and on status, so three different things are the same 404: a draft,
  // a cut being revised, and a video this reviewer was never assigned.
  const video = await reviewerVideoBySlug(slug, identity.id)
  if (!video) notFound()

  const [notes, mine] = await Promise.all([
    notesFor(video.id, identity.id, video.version),
    myAssignment(video.id, identity.id),
  ])

  return (
    <Review
      slug={video.slug}
      title={video.title}
      version={video.version}
      // Their OWN verdict, never the video's — there may be another reviewer with a different one.
      verdict={mine?.verdict ?? null}
      reviewerName={identity.name}
      reviewerEmail={identity.email}
      initialNotes={notes.map((n) => ({ id: n.id, t_seconds: n.t_seconds, body: n.body }))}
    />
  )
}
