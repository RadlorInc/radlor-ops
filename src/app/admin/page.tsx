import Link from 'next/link'
import { allAssignments, allNotes, allReviewers, allVideos } from '@/lib/db'
import { clearance, progressLabel } from '@/lib/clearance'
import { listIssues, listSubscriptions, listTodos } from '@/lib/adminDb'
import { listProfiles } from '@/lib/adminDb'
import { requireRole } from '@/lib/session'
import AdminIssues from './AdminIssues'
import Costs from './Costs'
import Todos from './Todos'

export const dynamic = 'force-dynamic'

export default async function Admin() {
  const me = await requireRole('admin')

  // ⚠️ The two admin tables are read AS THE USER (RLS decides); videos and notes still go through
  // the service key, because reviewers have no account for a policy to be written against.
  const [videos, notes, assignments, reviewers, subscriptions, todos, issues, people] = await Promise.all([
    allVideos(),
    allNotes(),
    allAssignments(),
    allReviewers(),
    listSubscriptions(),
    listTodos(),
    listIssues(),
    listProfiles(),
  ])
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]))

  // Unread = not yet acted on. `resolved_at` is the only thing that clears it.
  const unread = new Map<string, number>()
  for (const n of notes) {
    if (n.resolved_at) continue
    unread.set(n.video_id, (unread.get(n.video_id) ?? 0) + 1)
  }

  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]))
  const rows = videos.map((v) => {
    const mine = assignments.filter((a) => a.video_id === v.id)
    return { video: v, assignments: mine, c: clearance(mine) }
  })

  // ⚠️ THE ORIGINAL WARNING, WITH THE MULTI-REVIEWER MEANING RESTORED. It used to read one
  // `verdict` column; "approved" now means EVERY assigned reviewer approved, so this is
  // "everybody said yes and somebody still left something worth reading" — the sibling the change
  // called for, not a second warning bolted next to it.
  const clearedWithOpenNotes = rows.filter((r) => r.c.cleared && (unread.get(r.video.id) ?? 0) > 0)
  const split = rows.filter((r) => r.c.disagreement)

  return (
    <main className="wrap">
      <h1>Dashboard</h1>
      <p className="muted small">
        {me.name} · <a href="/tester">Chapter testing</a> ·{' '}
        {/* Roles gate the surface; assignments decide what is on it. An admin with no assignments
            gets an empty list here, which is correct. */}
        <Link href="/review" data-testid="my-review-list">
          Videos assigned to me
        </Link>{' '}
        ·{' '}
        <span data-testid="signout-inline">
          <form method="post" action="/api/auth/logout" style={{ display: 'inline' }}>
            <button className="linky" type="submit" data-testid="sign-out">
              Sign out
            </button>
          </form>
        </span>
      </p>
      <Costs initial={subscriptions} today={new Date().toISOString()} />

      <Todos initial={todos} />

      <AdminIssues initial={issues} names={names} />

      <h2 style={{ marginTop: 36 }}>Videos</h2>
      <p className="muted small">
        <a href="/admin/export">Open notes as markdown →</a> ·{' '}
        <a href="/admin/export?all=1">including resolved</a>
      </p>
      {/* ⚠️ Seven columns. At 375px this pushed the whole document sideways until it was given a
          container of its own to scroll inside; `tabIndex` so the scroll is reachable by keyboard
          and not only by a finger or a trackpad. */}
      <div className="tablewrap" tabIndex={0} role="region" aria-label="Videos">
        <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Title</th>
            <th>Status</th>
            <th>Version</th>
            <th>Reviewers</th>
            <th>Cleared to post</th>
            <th>Unread notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ video: v, assignments: mine, c }) => (
            <tr key={v.id} data-testid="admin-row">
              <td>
                <code>{v.slug}</code>
              </td>
              <td>{v.title}</td>
              <td>{v.status}</td>
              <td>v{v.version}</td>
              {/* ⚠️ EACH REVIEWER'S ANSWER, BY NAME, NEVER FOLDED INTO ONE LABEL. A single
                  "verdict" cell is what made a second reviewer's objection invisible behind the
                  first's approval, and the point of asking two people is that they can differ. */}
              <td data-testid="reviewer-verdicts">
                {c.assigned === 0 ? (
                  <span className="muted">nobody assigned</span>
                ) : (
                  <ul className="verdicts">
                    {mine.map((a) => (
                      <li key={a.reviewer_id} data-testid="reviewer-verdict" data-verdict={a.verdict ?? 'pending'}>
                        {reviewerName.get(a.reviewer_id) ?? 'unknown reviewer'} —{' '}
                        {a.verdict === 'approved' ? 'approved' : a.verdict === 'changes_needed' ? 'changes needed' : 'not finished'}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td data-testid="cleared-cell" data-cleared={c.cleared ? 'yes' : 'no'}>
                {c.cleared ? 'yes' : 'no'}
                <div className="muted small" data-testid="progress-label">
                  {c.disagreement ? `disagreement · ${progressLabel(c)}` : progressLabel(c)}
                </div>
                {/* ⚠️ THE BAR IS NEVER THE ONLY READING. It sits under the word and the sentence
                    that already say the same thing, because a fill length cannot distinguish
                    "both approved" from "both answered, one objected" — the state that matters
                    most here. `blocked` colours it amber when an objection is standing; the words
                    above are what carry that meaning for anyone who cannot see the difference. */}
                {c.assigned > 0 && (
                  <span
                    className="meter"
                    data-state={c.cleared ? 'cleared' : c.changesNeeded > 0 ? 'blocked' : undefined}
                    style={{ marginTop: 4, maxWidth: 120 }}
                  >
                    <span className="track">
                      <span className="fill" style={{ width: `${(c.decided / c.assigned) * 100}%` }} />
                    </span>
                  </span>
                )}
              </td>
              <td>{unread.get(v.id) ?? 0}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      {/* ⚠️ APPROVED WITH OPEN NOTES IS A REAL STATE, NOT A CONTRADICTION. The reviewers liked it
          and still left things worth reading. Not blocked — that is Rafi's call — but never
          silent, because the failure it guards against is uploading past feedback nobody read. */}
      {clearedWithOpenNotes.length > 0 && (
        <div className="warn" data-testid="approved-with-notes">
          <strong>Approved by everyone, and still has open notes.</strong> Worth reading before you
          post:{' '}
          {clearedWithOpenNotes
            .map((r) => `${r.video.slug} · ${unread.get(r.video.id)} open note${unread.get(r.video.id) === 1 ? '' : 's'}`)
            .join(', ')}
          .
        </div>
      )}
      {/* ⚠️ DISAGREEMENT IS SHOWN AS DISAGREEMENT. Not averaged, not "mostly approved", and not
          resolved by whoever answered last: one reviewer asked for changes and that is the signal
          the second reviewer was added to catch. */}
      {split.length > 0 && (
        <div className="warn" data-testid="reviewers-disagree">
          <strong>Reviewers disagree.</strong> Not cleared — one approval does not cancel an
          objection:{' '}
          {split
            .map((r) => `${r.video.slug} · ${r.c.approved} approved, ${r.c.changesNeeded} asked for changes`)
            .join(', ')}
          .
        </div>
      )}

      {videos.length === 0 && <p className="muted">No videos yet.</p>}
    </main>
  )
}
