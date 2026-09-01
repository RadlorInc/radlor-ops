/** Fixtures shared by the specs and by `playwright.config.ts`. These match `test/seed.sql`, which
 *  is loaded into the offline PGlite database at harness start-up. Test values only. */
/** Harness accounts — see `test/fake-supabase.mjs`. Not credentials to anything real. */
export const ACCOUNTS = {
  admin: { email: 'admin@harness.test', password: 'harness-admin-pw' },
  tester: { email: 'tester@harness.test', password: 'harness-tester-pw' },
}
export const SUPABASE_URL = 'http://127.0.0.1:54329'
export const PORT = 3019

export const TOKENS = {
  valid: 'tok_valid_9f2c4a7b1d8e3506ac91',
  revoked: 'tok_revoked_5b1e8c0a4d7f2396be40',
  /** Its own reviewer, so tripping the per-token limit cannot lock the other specs out. */
  flood: 'tok_flood_7c3a9e5f2b6d418093af',
  /** Never inserted, by construction — the "token that never existed" path. */
  unknown: 'tok_never_existed_000000000000000000',
}
