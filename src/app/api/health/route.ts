import { NextResponse } from 'next/server'

/** Liveness only. Deliberately shallow — no database call, so a Supabase hiccup does not read as
 *  "the app is down". Also what the E2E harness waits on before it starts driving the app. */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
