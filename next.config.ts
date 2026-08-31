import type { NextConfig } from 'next'

/**
 * The origin the <video> element and the signed-URL fetch are allowed to reach. Derived from the
 * env var rather than hard-coded `https://*.supabase.co` so that the E2E harness — which points
 * SUPABASE_URL at a local stand-in — is exercising the SAME policy production runs, not a
 * loosened dev-only one. Falls back to the wildcard when the var is absent at build time.
 */
const mediaOrigin = (() => {
  try { return new URL(process.env.SUPABASE_URL!).origin } catch { return 'https://*.supabase.co' }
})()

const DEV = process.env.NODE_ENV !== 'production'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // ⚠️ NOT the usual `strict-origin-when-cross-origin`. The reviewer's TOKEN IS IN THE PATH,
          // so any referrer that leaves this origin leaks a working credential into someone else's
          // access log. `no-referrer` is the only value that does not.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Unreleased marketing. Keep it out of every index, including link-preview crawlers.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              /**
               * Next inlines its own hydration payload; this app ships no inline scripts of its own.
               * ⚠️ 'unsafe-eval' IN DEV ONLY, and it is not cosmetic: React's development build calls
               * eval() for its debugging features, and with it blocked the page never hydrates at
               * all — the player sits on "Loading video…" for ever and every effect is dead. It
               * looks like a broken fetch, not a header. Never shipped: the branch is dropped from
               * the production header, and the E2E suite runs against a production build.
               */
              `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              // The <video> src is a short-lived Supabase Storage signed URL.
              `media-src 'self' blob: ${mediaOrigin}`,
              // ws: in dev only — Turbopack's HMR socket.
              `connect-src 'self' ${mediaOrigin}${DEV ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
