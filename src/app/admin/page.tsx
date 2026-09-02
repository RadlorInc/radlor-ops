import RoleNav from '../RoleNav'
import Summary from './Summary'
import { navBadges } from '@/lib/navBadges'
import { allAssignments, allNotes, allReviewers, allVideos } from '@/lib/db'
import { clearance, progressLabel } from '@/lib/clearance'
import { listIssues, listSubscriptions, listTodos } from '@/lib/adminDb'
import { requireRole } from '@/lib/session'
import Costs from './Costs'
import Todos from './Todos'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'summary', label: 'Dashboard' },
  { key: 'costs', label: 'Costs' },
  { key: 'todo', label: 'To-do' },
  { key: 'videos', label: 'Videos' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const me = await requireRole('admin')

  // ⚠️ The two admin tables are read AS THE USER (RLS decides); videos and notes still go through
  // the service key, because reviewers have no account for a policy to be written against.
  const [videos, notes, assignments, reviewers, subscriptions, todos, issues] = await Promise.all([
    allVideos(),
    allNotes(),
    allAssignments(),
    allReviewers(),
    listSubscriptions(),
    listTodos(),
    listIssues(),
  ])

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

  /**
   * ⚠️ THE TAB IS IN THE URL, NOT IN CLIENT STATE. `/admin?tab=videos` is a link Rafi can send
   * himself, a bookmark, and a back button that works. It also means the server renders one
   * section instead of four, so the page a tab shows is the page it built.
   *
   * An unknown value falls back to the first tab rather than rendering nothing — a typo'd query
   * string should not produce a blank dashboard.
   */
  const raw = (await searchParams).tab
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : 'summary'

  /**
   * ⚠️ THE SHARED HELPER, NOT A SECOND COMPUTATION HERE. This page has every row in hand and could
   * count them itself in four lines — and then /tester and /review, which have to use the helper
   * because they do not load this data, would be one edit away from showing a different number for
   * the same thing. One badge, one implementation.
   *
   * ⚠️ THE COUNTS ARE "NEEDS SOMETHING", NOT "HOW MANY ROWS". A badge showing the total would sit
   * at 25 for ever and stop meaning anything; a tab with nothing waiting gets no badge at all
   * rather than a zero. The Dashboard tab never gets one: it is a summary OF the badges beside it.
   */
  const badges = await navBadges(me.user_id)

  return (
    <main className="wrap">
      <RoleNav
        role={me.role}
        current={tab === 'summary' ? '/admin' : `/admin?tab=${tab}`}
        name={me.name}
        badges={badges}
      />
      {/* ⚠️ The tab strip above already names this page. Printing it again as the only visible h1
          is repetition — but a page with no h1 has no name in a screen reader's landmark list, so
          it moves rather than goes. Same reasoning as the section headings. */}
      <h1 className="sr-only">Dashboard</h1>

      {/* ⚠️ THE WARNINGS LIVE ABOVE THE TABS AND SHOW ON EVERY ONE OF THEM. Putting sections
          behind tabs is fine for detail and wrong for signal: "reviewers disagree" is the whole
          reason this page exists, and a version of it that only appears once you click Videos is a
          version nobody reads. Tabs put detail away; they never put a warning away. */}
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


      {tab === 'summary' && (
        <Summary
          subscriptions={subscriptions}
          todos={todos}
          issues={issues}
          rows={rows}
          unread={unread}
          today={new Date()}
        />
      )}
      {tab === 'costs' && <Costs initial={subscriptions} today={new Date().toISOString()} />}
      {tab === 'todo' && <Todos initial={todos} />}
      {tab === 'videos' && (
        <section>
      {/* ⚠️ VISUALLY HIDDEN, NOT DELETED. The tab above already says "Videos", so printing it
          again is noise — but a section with no heading at all is a section a screen reader cannot
          find or skip to, and the document loses its outline. The label moves, it does not go. */}
      <h2 className="sr-only">Videos</h2>
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
        </section>
      )}

      {tab === 'videos' && videos.length === 0 && <p className="muted">No videos yet.</p>}
    </main>
  )
}
