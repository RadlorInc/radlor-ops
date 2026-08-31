import Link from 'next/link'
import { notFound } from 'next/navigation'
import { reviewerByToken, videosAwaitingReview } from '@/lib/db'

/** Never cached and never statically generated: the list is per-token and changes as videos move
 *  in and out of `awaiting_review`. */
export const dynamic = 'force-dynamic'

export default async function ReviewerList({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const reviewer = await reviewerByToken(token)
  // Unknown token and revoked token take the SAME branch. A distinct error for "revoked" would
  // confirm to whoever is holding it that the token was once real.
  if (!reviewer) notFound()

  const videos = await videosAwaitingReview()

  return (
    <main className="wrap">
      <h1>Radlor — videos to review</h1>
      <p className="muted small">
        Signed in as {reviewer.name}. This link is yours; please don’t forward it.
      </p>

      {videos.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>
          Nothing waiting on you right now. This page will fill up when the next cut is ready.
        </p>
      ) : (
        <div style={{ marginTop: 20 }}>
          {videos.map((v) => (
            <Link key={v.id} className="card" href={`/r/${encodeURIComponent(token)}/${v.slug}`}>
              <strong>{v.title}</strong>
              <div className="muted small">
                {v.slug} · v{v.version}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
