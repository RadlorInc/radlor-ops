import { NextResponse } from 'next/server'

/**
 * Liveness, plus one configuration fact.
 *
 * ⚠️ `region` IS THE ONE NON-BOOLEAN, AND IT IS NOT A SECRET — it is which Vercel region this
 * function is executing in, which the platform already puts in the `x-vercel-id` header of every
 * response. It is here because inferring it from that header was ambiguous: an edge-cached or
 * middleware-answered response can name a point of presence rather than the compute region, so
 * "still iad1" could not be told apart from "not deployed yet". Asking the function itself where
 * it is removes the inference. It matters because every Supabase read crosses to us-west-2, so a
 * function in the wrong region pays that crossing on every wave of a page render.
 *
 * ⚠️ `commit` IS THE SECOND NON-BOOLEAN, AND IT EARNED ITS PLACE TWICE IN ONE DAY. On 2026-09-04
 * a push silently did not deploy — the Git connection had gone stale on a repo rename, and every
 * surface said fine: push succeeded, GitHub held the commit, the site returned 200, the suite was
 * green. Hours later, "the links still vanish" could not be answered either, because there was no
 * way to ask production WHICH BUILD it was serving; the fix was live locally and unverifiable
 * remotely. Seven hex characters end both arguments. It is not a secret — it names a commit in a
 * private repo and reveals nothing about its contents — and it is the answer to the only question
 * that matters after a push.
 *
 * ⚠️ EVERYTHING ELSE IS BOOLEANS ONLY, NEVER VALUES. `auth_configured` says whether the two variables sign-in needs
 * are PRESENT, not what they are. It exists because the login route deliberately gives the same
 * `?error=1` for a wrong password and for a missing environment variable — that sameness is what
 * stops it being an account-enumeration oracle, and it also makes "did the env var get set?"
 * unanswerable from outside. This answers exactly that one question and nothing else.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      auth_configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      region: process.env.VERCEL_REGION ?? 'local',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
