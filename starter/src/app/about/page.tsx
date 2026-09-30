import Link from 'next/link';
import site from '@/content/site';
import { pageMetadata } from '@/kit/seo';

export const metadata = pageMetadata('About', site.copy.about_body.slice(0, 160));

// PLACEHOLDER: the design replaces this entirely.
export default function AboutPage() {
  return (
    <main id="main">
      {/* PLACEHOLDER: the design replaces this entirely */}
      <p><Link href="/">{site.business.name}</Link></p>
      <h1>{site.copy.about_heading}</h1>
      <p>{site.copy.about_body}</p>
      {site.claims.length ? <ul>{site.claims.map((c) => <li key={c}>{c}</li>)}</ul> : null}
    </main>
  );
}
