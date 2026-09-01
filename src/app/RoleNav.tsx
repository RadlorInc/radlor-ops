import Link from 'next/link'
import type { Role } from '@/lib/session'

/**
 * The surfaces this person can open, as tabs, on every page.
 *
 * ⚠️ IT RENDERS ONLY WHAT THE ROLE CAN ACTUALLY OPEN. A tester seeing a "Dashboard" tab that 404s
 * is worse than no tab: the gate is correct and the interface is lying about it. So a tester and a
 * reviewer get one destination and therefore no tab strip at all — just their name and a way out.
 * Admin is the only role with somewhere to switch to, because admin is the only role that is a
 * superset of another.
 *
 * ⚠️ THE COUNTS ARE PASSED IN, NEVER FETCHED HERE. A nav that queries on every page render is a
 * nav that adds a round trip to the reviewer's video page for a number the reviewer cannot act on.
 * Each page hands over what it already loaded, and a tab with nothing to say simply has no badge.
 */
export type NavBadges = { tester?: number; review?: number }

const TABS: Record<Role, { href: string; label: string; key: keyof NavBadges | 'admin' }[]> = {
  admin: [
    { href: '/admin', label: 'Dashboard', key: 'admin' },
    { href: '/tester', label: 'Chapter testing', key: 'tester' },
    { href: '/review', label: 'My reviews', key: 'review' },
  ],
  tester: [{ href: '/tester', label: 'Chapter testing', key: 'tester' }],
  reviewer: [{ href: '/review', label: 'My reviews', key: 'review' }],
}

export default function RoleNav({
  role,
  current,
  name,
  badges = {},
}: {
  role: Role
  current: '/admin' | '/tester' | '/review'
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
        <nav className="tabs" aria-label="Your surfaces">
          {tabs.map((t) => {
            const badge = t.key === 'admin' ? undefined : badges[t.key]
            return (
          /* ⚠️ NO PREFETCH. Next prefetches every <Link> that enters the viewport, and each
             prefetch is a real request through the proxy — which refreshes an expiring session and
             ROTATES the refresh token. Four tab links therefore fired four concurrent refreshes
             off one token, three of them spending a value that had just been rotated away, and the
             session died. It surfaced as an intermittent failure in the token-refresh spec: 200,
             no rows, because requireRole had quietly redirected to /login.
             These are server-rendered sections behind a query string; prefetching them buys a few
             milliseconds and costs the session. */
              <Link
                key={t.href}
                href={t.href}
                className="tab"
                prefetch={false}
                /* ⚠️ `aria-current`, not just a class. The blue underline is what a sighted user
                   reads as "you are here"; without this a screen reader gets three identical
                   links. */
                aria-current={t.href === current ? 'page' : undefined}
                data-testid={`nav-${t.href.slice(1)}`}
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
