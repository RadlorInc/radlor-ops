/**
 * The `/admin` gate.
 *
 * ⚠️ NO `import 'server-only'` AND NO `next/headers` HERE, deliberately: `src/proxy.ts` imports
 * this, and proxy code can run outside the Node runtime where both of those blow up. The callers
 * read the cookie themselves — it is two lines each in the two places that need it.
 *
 * The token reaches the browser ONCE, as `?k=…` on a link you paste. `src/proxy.ts` swaps it for
 * an httpOnly cookie and redirects to the same path with the parameter stripped, so it appears in
 * Vercel's request log, browser history and any referrer exactly once instead of on every request.
 * There is still nothing to log into.
 */

export const ADMIN_PARAM = 'k'
export const ADMIN_COOKIE = 'rvr_admin'
/** A week. Rotating `ADMIN_TOKEN` invalidates every outstanding cookie immediately. */
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

/** Length-independent, byte-by-byte. Not `===`, which returns on the first differing character.
 *  Hand-rolled rather than `node:crypto`'s `timingSafeEqual` for the runtime reason above. */
function constantTimeEqual(a: string, b: string): boolean {
  // The length is not the secret, and comparing different-length strings byte-wise is meaningless.
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** An unset or empty `ADMIN_TOKEN` means the admin surface is CLOSED, never open — a missing env
 *  var must not be a way in. */
export function tokenValid(supplied: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !supplied) return false
  return constantTimeEqual(supplied, expected)
}
