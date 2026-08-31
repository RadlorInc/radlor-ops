import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/**
 * The `/admin` gate. `ADMIN_TOKEN` comes from the environment; an unset or empty var means the
 * admin surface is CLOSED, never open — a missing env var must not be a way in.
 */
export function isAdmin(supplied: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  // Compare lengths separately: timingSafeEqual throws on a length mismatch rather than returning
  // false, and the length is not the secret.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The query parameter the admin token is passed in. It is the founder's own token on the
 *  founder's own machine, so a query string (which does land in Vercel's request logs) is an
 *  accepted trade for having no session, no cookie and no login form to build. Rotate it by
 *  changing the env var. */
export const ADMIN_PARAM = 'k'
