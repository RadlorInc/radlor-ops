import Link from 'next/link'
import { notFound } from 'next/navigation'
import { myAssignment, notesFor, reviewerVideoBySlug, videosForReviewer } from '@/lib/db'
import type { ReviewerIdentity } from '@/lib/reviewerIdentity'
import type { Role } from '@/lib/session'
import RoleNav from '../RoleNav'
import { navBadges } from '@/lib/navBadges'
import Review from './Review'

/**
 * The reviewer's two screens, rendered from an IDENTITY rather than from a token.
 *
 * The token door has been removed; deleting it was two page files and nothing in here changed,
 * which is what sharing one implementation bought.
 */

export async function ReviewerList({ identity, role }: { identity: ReviewerIdentity; role: Role }) {
  const videos = await videosForReviewer(identity.id)
  const unfinished = videos.filter((v) => v.myVerdict === null).length

  return (
    <main className="wrap">
      <RoleNav
        role={role}
        current="/review"
        name={identity.name}
        /* Same reason as /tester: an admin's strip has tabs this page knows nothing about, and an
           absent badge is a claim that they are clear. A reviewer's strip has one tab and pays for
           nothing. ⚠️ Note this is the LIST page — /review/<slug> renders no nav, so a reviewer
           watching a video never waits on these reads. */
        badges={role === 'admin' ? await navBadges(identity.id) : { review: unfinished }}
      />
      <h1>Videos to review</h1>
      <p className="help" data-testid="signout-inline">
        {videos.length === 0
          ? 'Nothing assigned to you.'
          : `${unfinished} of ${videos.length} still waiting on you. Tap a video to watch it and leave your notes.`}
      </p>

      {videos.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }} data-testid="nothing-assigned">
          Nothing waiting on you right now. This page will fill up when the next cut is ready.
        </p>
      ) : (
        <div style={{ marginTop: 20 }}>
          {videos.map((v) => (
            <Link key={v.id} className="card videocard" href={`/review/${v.slug}`} data-testid="video-card">
              <div>
                <strong>{v.title}</strong>
                <div className="muted small">Version {v.version}</div>
              </div>
              {/* The state in words, not only in the count above: "waiting for you" is the thing
                  to tap, "you finished this" is the thing you can leave alone. */}
              <span className={v.myVerdict ? 'pill pill-ok' : 'pill pill-waiting'}>
                {v.myVerdict ? 'You finished this' : 'Waiting for you'}
              </span>
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
