import { defineConfig } from '@playwright/test'
import { PORT, SUPABASE_URL } from './e2e/tokens'

/**
 * The E2E harness runs entirely OFFLINE, against `test/fake-supabase.mjs` — PGlite running this
 * repo's real migration, plus a signed-URL endpoint with a real expiry. That is deliberate: the
 * founder is creating the Supabase project by hand (see SETUP.md), so there is no project to point
 * at, and a suite that needs one is a suite nobody runs.
 *
 * ⚠️ WHAT THAT DOES AND DOES NOT PROVE. It exercises THIS APP's logic — token resolution, the 404
 * shape, the rate limit, the admin gate, the note round-trip — against real SQL and real check
 * constraints.
 *
 * ⚠️⚠️ IT PROVES NOTHING ABOUT AUTHORIZATION, and cannot: PGlite runs as one superuser with no
 * role switching, so grants, RLS and every other "who is asking" rule are invisible to it by
 * construction. A 19/19 green run once coexisted with a schema `service_role` could not read at
 * all. Read the declared blind spot at the top of `test/fake-supabase.mjs` before treating a green
 * number here as coverage — the only authorization coverage this tool has is the three live
 * scripts in `scripts/`, run by hand against the real project.
 */
export default defineConfig({
  testDir: './e2e',
  /**
   * ⚠️ 120s, AND THE REASON IS THE LOGIN RATE LIMIT, NOT SLOW TESTS. `signIn`/`freshLogin` wait the
   * 60-second window out and retry once when the suite trips its own ten-attempts-a-minute limit.
   * At a 60s test timeout that retry could never finish — the test died mid-wait — so the run
   * failed intermittently inside whichever spec happened to be holding the tenth attempt, most
   * often the token-refresh one, with a symptom that looked nothing like a rate limit.
   *
   * Raising THIS is the right knob. Raising the limit would have made the suite pass against a
   * build that is not the one that ships.
   */
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // The fake database is one shared in-memory Postgres and the rate limiter is one shared Map.
  // Parallel workers would race both.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: 'node test/fake-supabase.mjs',
      url: `${SUPABASE_URL}/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      // A PRODUCTION build, not `next dev`. Two things only the production build can show: the
      // real CSP (the dev header carries an 'unsafe-eval' that never ships) and the real HTTP
      // status of a `notFound()` page, which is what checks #2 and #5 assert.
      //
      // ⚠️ THE DATA CACHE IS WIPED FIRST, AND THE SUITE IS NOT HERMETIC WITHOUT IT. `next start`
      // persists every `unstable_cache` entry to `.next/cache/fetch-cache` — Next's own comment
      // says "so it can be persisted across deploys" — keyed on the callback's source text, not on
      // a build id, and `revalidateTag` state does NOT survive a restart. So run N served run N-1's
      // `videos` and `assignments` lists until something in run N invalidated the tag, while the
      // PGlite database underneath was freshly seeded. Found 2026-09-09: `delete-video.spec.ts`
      // failed twice in a row on a full run and passed alone — the DELETE route looked `doomed-cut`
      // up in a cached list written by the PREVIOUS run, in which that very spec had deleted it.
      // Whether a run hit it depended on what the last run left behind, which is the definition of
      // a suite that reports history rather than behaviour.
      command: `rm -rf .next/cache/fetch-cache && npx next build && npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-for-the-offline-harness',
        SUPABASE_ANON_KEY: 'fake-anon-key-for-the-offline-harness',
      },
    },
  ],
})

