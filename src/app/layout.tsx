import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Radlor video review',
  // Unreleased marketing. Belt-and-braces with the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
