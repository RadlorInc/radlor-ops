import { defineConfig } from '@playwright/test'
import { ADMIN_TOKEN, PORT, SUPABASE_URL } from './e2e/tokens'

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
  timeout: 60_000,
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
      command: `npx next build && npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-for-the-offline-harness',
        ADMIN_TOKEN,
      },
    },
  ],
})

