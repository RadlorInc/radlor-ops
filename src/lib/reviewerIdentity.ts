import 'server-only'
import { reviewerByToken, type Reviewer } from './db'
import { currentProfile, currentUser } from './session'

/**
 * WHO IS REVIEWING — resolved from a session, or from a token, to the SAME identity.
 *
 * ⚠️ TWO DOORS, ONE PERSON. `notes.reviewer_id` and `video_reviewers.reviewer_id` hold
 * `profiles.user_id`, so both paths must produce that id or a reviewer's history splits in half
 * depending on how they arrived. `reviewers.user_id` is what makes the token path land on the same
 * row as the login path.
 *
 * ⚠️ THE SESSION IS TRIED FIRST, AND A TOKEN CANNOT UPGRADE A SESSION. A signed-in reviewer who
 * also pastes a token gets their own session identity; a token is never allowed to name a
 * different person than the cookie already did. That way the token path can be deleted later
 * without changing who anything belongs to.
 *
 * ⚠️ AND `admin` IS ACCEPTED HERE. Roles gate the surface, assignments decide what is on it — the
 * one reviewer in production is also the admin account. An admin with no assignments resolves
 * fine and then sees nothing, which is the correct empty list rather than an error.
 */
export type ReviewerIdentity = Reviewer & { via: 'session' | 'token' }

export async function reviewerIdentity(token: string | null): Promise<ReviewerIdentity | null> {
  const profile = await currentProfile()
  if (profile && (profile.role === 'reviewer' || profile.role === 'admin')) {
    const user = await currentUser()
    return {
      id: profile.user_id,
      name: profile.name,
      // The watermark reads this. It used to come off `reviewers.email`; for a session it is the
      // address they actually signed in with, which is the stronger version of the same claim.
      email: user?.email ?? '',
      revoked_at: null,
      via: 'session',
    }
  }
  if (!token) return null
  const reviewer = await reviewerByToken(token)
  return reviewer ? { ...reviewer, via: 'token' } : null
}
