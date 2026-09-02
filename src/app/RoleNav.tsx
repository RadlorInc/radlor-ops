import Link from 'next/link'
import type { Role } from '@/lib/session'
import type { NavBadges } from '@/lib/navBadges'

/**
 * ONE FLAT TAB STRIP. Everything this person can open, at one level, one click away.
 *
 * ⚠️ IT USED TO BE TWO LEVELS — role surfaces on top, dashboard sections underneath — and the
 * second level is gone on purpose. Two strips of tabs on one page make the reader work out which
 * one they are in before they can look for anything, and "Costs" was never a different KIND of
 * thing from "Chapter testing": both are just a place to be. Nesting them said otherwise.
 *
 * ⚠️ IT RENDERS ONLY WHAT THE ROLE CAN ACTUALLY OPEN. A tester seeing a "Videos" tab that 404s is
 * worse than no tab: the gate is correct and the interface is lying about it. A tester and a
 * reviewer have one destination each, so they get no strip at all — just their name and a way out.
 */
type Tab = { href: string; label: string; badge?: keyof NavBadges }

const TABS: Record<Role, Tab[]> = {
  admin: [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin?tab=costs', label: 'Costs', badge: 'costs' },
    { href: '/admin?tab=todo', label: 'To-do', badge: 'todo' },
    { href: '/admin?tab=issues', label: 'Issues', badge: 'issues' },
    { href: '/admin?tab=videos', label: 'Videos', badge: 'videos' },
    { href: '/tester', label: 'Chapter testing' },
    { href: '/review', label: 'My reviews', badge: 'review' },
  ],
  tester: [{ href: '/tester', label: 'Chapter testing' }],
  reviewer: [{ href: '/review', label: 'My reviews' }],
}

export default function RoleNav({
  role,
  current,
  name,
  badges = {},
}: {
  role: Role
  /** The active tab's href, exactly as it appears above — `/admin?tab=videos`, not `/admin`. */
  current: string
  name: string
  badges?: NavBadges
}) {
  const tabs = TABS[role]

  return (
    <header className="rolenav">
      <div className="who">
        <span className="name">{name}</span>
        <form method="post" action="/api/auth/logout">
          <button className="linky small" type="submit" data-testid="sign-out">
            Sign out
          </button>
        </form>
      </div>

      {tabs.length > 1 && (
        <nav className="tabs" aria-label="Sections">
          {tabs.map((t) => {
            const badge = t.badge ? badges[t.badge] : undefined
            return (
              /* ⚠️ NO PREFETCH. Next prefetches every <Link> that enters the viewport, and each
                 prefetch is a real request through the proxy — which refreshes an expiring session
                 and ROTATES the refresh token. Seven tab links would fire seven concurrent
                 refreshes off one token, six of them spending a value that had just been rotated
                 away, and the session dies. It surfaced as an intermittent failure in the
                 token-refresh spec: 200, no rows, because requireRole had redirected to /login.
                 These are server-rendered pages behind a query string; prefetching them buys a few
                 milliseconds and costs the session. */
              <Link
                key={t.href}
                href={t.href}
                className="tab"
                prefetch={false}
                /* ⚠️ `aria-current`, not just a class. The underline is what a sighted reader takes
                   as "you are here"; without this a screen reader gets seven identical links. */
                aria-current={t.href === current ? 'page' : undefined}
                data-testid={`nav-${t.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              >
                {t.label}
                {badge != null && badge > 0 && (
                  <span className="badge" aria-label={`${badge} needing attention`}>
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      )}
    </header>
  )
}
