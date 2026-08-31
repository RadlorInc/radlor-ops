import 'server-only'
import { cookies } from 'next/headers'
import { ADMIN_COOKIE, tokenValid } from './admin'
import { requireRole } from './session'

/**
 * ⚠️ TEMPORARY, AND THE ONLY REASON IT EXISTS IS SEQUENCING.
 *
 * Removing the `?k=<ADMIN_TOKEN>` gate in the same change that adds accounts would lock the founder
 * out of his own tool between deploy and first successful sign-in, with no way back except the
 * database. So both work at once for exactly one window: build auth → create the account → confirm
 * a real sign-in → THEN delete this file and call `requireRole('admin')` directly.
 *
 * It is deliberately a separate file rather than an `if` inside the page, so that removing it is a
 * `git rm` and a compile error at every call site — not a condition someone has to notice.
 *
 * Returns true when the caller got in on the LEGACY path, so the page can say so out loud.
 */
export async function requireAdminDuringHandover(): Promise<boolean> {
  if (tokenValid((await cookies()).get(ADMIN_COOKIE)?.value)) return true
  await requireRole('admin')
  return false
}
