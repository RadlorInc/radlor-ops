import { createHash, randomBytes } from 'node:crypto'

/**
 * The link token. ⚠️ THE RAW TOKEN IS NEVER STORED — it exists in the URL the admin copies and in
 * nothing else; `review.invite_links` holds only `hashToken(it)`. So a dump of that table cannot
 * be turned back into a working link, and neither can a backup, a log, or a screenshot of the
 * Supabase table editor.
 *
 * 24 random bytes, not a uuid: a uuid is 122 bits with a documented layout and is the kind of
 * thing people paste into issue trackers. `base64url` so the whole token survives being a path
 * segment and a WhatsApp forward untouched.
 *
 * Its own module because both halves — the route that mints and the page that looks up — must
 * agree on the hash, and two copies of `createHash('sha256')` is exactly the kind of pair that
 * drifts.
 */
export const mintToken = (): string => randomBytes(24).toString('base64url')
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
