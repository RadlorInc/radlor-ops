import { notFound } from 'next/navigation'

/** There is no front door. Every real surface is either token-gated (`/r/…`) or admin-gated
 *  (`/admin?k=…`), so the root is a 404 rather than a page that says what this app is. */
export default function Home() {
  notFound()
}
