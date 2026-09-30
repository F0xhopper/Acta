import Link from 'next/link';
import site from '@/content/site';

export default function NotFound() {
  return (
    <main id="main">
      <h1>Page not found</h1>
      <p><Link href="/">Back to {site.business.name}</Link></p>
    </main>
  );
}
