import { listIssues, listTodos, type Issue, type Todo } from '@/lib/adminDb'
import { allAssignments, listMaterial, namesById, type Assignment } from '@/lib/db'
import { badgesFrom } from '@/lib/navBadges'
import { requireRole } from '@/lib/session'
import RoleNav from '../RoleNav'
import Material from './Material'

export const dynamic = 'force-dynamic'

/**
 * SOURCE MATERIAL — the library a cut gets made FROM. ADMINS manage it; TEACHERS look at it.
 *
 * ⚠️ ITS OWN PAGE, NOT AN /admin TAB, AND THE REASON IS THE ROLE. It was `/admin?tab=source` until
 * 2026-09-11, when Rafi asked for a `teacher` role whose whole job is this library. `/admin` holds
 * to-dos, every cut, every reviewer's verdicts and the People tab — none of which a teacher should
 * see, and none of which a tab-level check could keep from them once they were through the page's
 * gate. So the library moved out, and `/admin`'s nav points here the way *Chapter testing* already
 * points at `/tester`: one implementation, two roles, one gate that names both.
 *
 * ⚠️ A TEACHER FETCHES NOTHING BUT THE LIBRARY. The badge lists exist only to label an ADMIN's tabs,
 * so for a teacher those slots resolve empty without a request — the same shape as /tester.
 */
export default async function Source() {
  const me = await requireRole('teacher', 'admin')
  const admin = me.role === 'admin'
  const none = <T,>(): Promise<T[]> => Promise.resolve([])

  const [material, names, todos, issues, assignments] = await Promise.all([
    listMaterial(),
    // ⚠️ SERVICE KEY, NOT `listProfiles()`. A teacher can read only their own profile row, so the
    // as-the-user lookup would label every admin upload "somebody since removed". See namesById.
    namesById(),
    admin ? listTodos() : none<Todo>(),
    admin ? listIssues() : none<Issue>(),
    admin ? allAssignments() : none<Assignment>(),
  ])

  return (
    <main className="wrap">
      <RoleNav
        role={me.role}
        current="/source"
        name={me.name}
        badges={admin ? badgesFrom({ todos, issues, assignments, userId: me.user_id }) : undefined}
      />
      <h1 className="sr-only">Source material</h1>
      <Material
        canEdit={admin}
        /* ⚠️ AN UNFINISHED UPLOAD IS FILTERED OUT FOR A TEACHER, ON THE SERVER. It exists so an admin
           can see and remove a half-made item; a teacher can do neither, so for them it is a title
           with no Open and no Remove — a row that looks broken. Filtered here rather than hidden
           in the component, so the row never reaches a browser that has no use for it. */
        initial={material.filter((m) => admin || m.ready).map((m) => ({
          id: m.id,
          title: m.title,
          subject: m.subject,
          kind: m.kind,
          url: m.url,
          filename: m.filename,
          ready: m.ready,
          // `added_by` is `on delete set null`: the library outlives whoever pasted something in,
          // so a missing name really does mean they were removed — and only that, now that the
          // names are read with the key that can see all of them.
          addedBy: (m.added_by && names.get(m.added_by)) || 'somebody since removed',
          created_at: m.created_at,
        }))}
      />
    </main>
  )
}
