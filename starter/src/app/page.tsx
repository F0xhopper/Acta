import Link from 'next/link';
import site from '@/content/site';
import { telHref } from '@/kit/phone';

// PLACEHOLDER: the design replaces this entirely. Plain semantic HTML so the gates can run on the bare starter.
export default function Home() {
  const b = site.business;
  return (
    <main id="main">
      {/* PLACEHOLDER: the design replaces this entirely */}
      <header>
        {site.logo ? <img src={site.logo.path} alt={site.logo.alt} width={160} /> : <p>{b.name}</p>}
        <nav aria-label="Main">
          <ul>
            <li><Link href="/about">About</Link></li>
            <li><Link href="/contact">Contact</Link></li>
          </ul>
        </nav>
      </header>
      <section>
        <h1>{site.copy.hero_heading}</h1>
        <p>{site.copy.hero_sub}</p>
        {b.phone_e164 ? <a href={telHref(b.phone_e164)}>{site.copy.cta_label}: {b.phone_display}</a> : null}
        {b.whatsapp ? <a href={b.whatsapp}>WhatsApp</a> : null}
      </section>
      {site.photos[0] ? <img src={site.photos[0].path} alt={site.photos[0].alt} width={800} /> : null}
      <section>
        <h2>Services</h2>
        <ul>{site.services.map((s) => <li key={s.slug}><Link href={`/services/${s.slug}`}>{s.name}</Link> — {s.summary}</li>)}</ul>
      </section>
      <section>
        <h2>Areas we cover</h2>
        <ul>{site.areas.map((a) => <li key={a.slug}><Link href={`/areas/${a.slug}`}>{a.name}</Link></li>)}</ul>
      </section>
      {site.reviews.length ? (
        <section>
          <h2>Reviews</h2>
          {site.reviews.map((r, i) => <blockquote key={i}><p>{r.text}</p><footer>{r.author}, {r.when}</footer></blockquote>)}
        </section>
      ) : null}
      <footer>
        <p>{b.name}{b.address ? `, ${b.address}` : ''}{b.postcode ? ` ${b.postcode}` : ''}</p>
        <ul>{b.hours.map((h) => <li key={h}>{h}</li>)}</ul>
      </footer>
    </main>
  );
}
