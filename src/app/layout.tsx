import type { Metadata } from 'next'
import { Fira_Code, Nunito_Sans } from 'next/font/google'
import './globals.css'

/**
 * ⚠️ `next/font` SELF-HOSTS THESE AT BUILD TIME. It downloads the files during the build and
 * serves them from our own origin, so there is no request to fonts.googleapis.com at runtime —
 * no third party learning who opened a review link, nothing to add to a CSP, and no flash of
 * unstyled text because the CSS is inlined with a `size-adjust` fallback.
 *
 * Fira Sans for the interface, Fira Code wherever a column is meant to be compared down rather
 * than read across: slugs, ids, timestamps, money, renewal dates.
 */
// Nunito Sans, not Fira: rounded and soft on purpose. The people reading these pages are
// reviewers and testers, not developers, and the face is the first thing that says which.
const sans = Nunito_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

const mono = Fira_Code({
  subsets: ['latin'],
  // ⚠️ One weight. Every extra weight is another set of font files in the bundle, and the mono
  // face is only ever used for values you scan down a column — a slug, a timestamp, an id. Those
  // are distinguished by being monospace and by colour; a second weight bought nothing.
  weight: ['400'],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})

export const metadata: Metadata = {
  title: 'Radlor Ops',
  // Unreleased marketing. Belt-and-braces with the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
