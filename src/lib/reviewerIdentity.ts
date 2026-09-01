import 'server-only'
import type { Reviewer } from './db'
import { currentProfile, currentUser } from './session'

/**
 * WHO IS REVIEWING — resolved from a session, or from a token, to the SAME identity.
 *
 * ⚠️ ONE DOOR NOW. The `/r/<token>` path is gone — Rafi signed in at /review on 2026-09-02 and
 * confirmed it, which was the condition for removing it. Deleting it cost nothing precisely
 * because both doors had been made to resolve to the same `profiles.user_id` first: no note and no
 * assignment changed owner when the token stopped existing.
 *
 * ⚠️ AND `admin` IS ACCEPTED HERE. Roles gate the surface, assignments decide what is on it — the
 * one reviewer in production is also the admin account. An admin with no assignments resolves
 * fine and then sees nothing, which is the correct empty list rather than an error.
 */
export type ReviewerIdentity = Reviewer

export async function reviewerIdentity(): Promise<ReviewerIdentity | null> {
  const profile = await currentProfile()
  if (profile && (profile.role === 'reviewer' || profile.role === 'admin')) {
    const user = await currentUser()
    return {
      id: profile.user_id,
      name: profile.name,
      // The watermark reads this: the address they actually signed in with.
      email: user?.email ?? '',
      revoked_at: null,
    }
  }
  return null
}
