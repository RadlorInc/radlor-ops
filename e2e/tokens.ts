/** Fixtures shared by the specs and by `playwright.config.ts`. These match `test/seed.sql`, which
 *  is loaded into the offline PGlite database at harness start-up. Test values only. */
/** Harness accounts — see `test/fake-supabase.mjs`. Not credentials to anything real. */
export const ACCOUNTS = {
  admin: { email: 'admin@harness.test', password: 'harness-admin-pw' },
  /** An admin who does not own the project — the positive control for the owner-only Remove. */
  admin2: { email: 'deputy@harness.test', password: 'harness-deputy-pw' },
  tester: { email: 'tester@harness.test', password: 'harness-tester-pw' },
  dana: { email: 'dana@example.com', password: 'harness-dana-pw' },
  flood: { email: 'flood@example.com', password: 'harness-flood-pw' },
}

/** ⚠️ The user_ids. `notes.reviewer_id` and `video_reviewers.reviewer_id` hold these now, NOT
 *  `reviewers.id` — the reviewer rows keep their own ids only to carry the tokens. */
export const USERS = {
  dana: '77777777-7777-4777-8777-777777777777',
  flood: '88888888-8888-4888-8888-888888888888',
  /** The harness admin, who is also the seeded OWNER — the only account that may remove a person. */
  harnessAdmin: '55555555-5555-4555-8555-555555555555',
  /** Deputy Admin: an admin who is NOT the owner. The only fixture that can tell "not yourself"
   *  apart from "not the owner", because on the harness admin both rules fire at once. */
  deputy: '44444444-4444-4444-8444-444444444444',
}
export const SUPABASE_URL = 'http://127.0.0.1:54329'
export const PORT = 3019

/**
 * ⚠️ `TOKENS` IS GONE. The `/r/<token>` door was removed on 2026-09-02; every reviewer now signs
 * in, and `ACCOUNTS.dana` / `ACCOUNTS.flood` above are how a spec becomes a reviewer.
 */
