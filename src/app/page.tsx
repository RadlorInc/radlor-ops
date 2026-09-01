import { notFound } from 'next/navigation'

/** There is no front door. Every real surface is behind an account, so the root is a 404 rather
 *  than a page that says what this app is. (This comment named `/admin?k=…` long after that gate
 *  was deleted — a stale comment about an access mechanism is worth fixing on sight, because it is
 *  the thing someone reads when they are working out how the app is protected.) */
export default function Home() {
  notFound()
}
