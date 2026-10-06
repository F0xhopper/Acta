import Link from 'next/link';
import site from '@/content/site';
import { pageMetadata } from '@/kit/seo';
import { submitContact } from '@/kit/contact';
import { Field } from '@/kit/a11y/Field';
import { telHref } from '@/kit/phone';
import { MapEmbed } from '@/kit/map';

export const metadata = pageMetadata('Contact', `Get in touch with ${site.business.name}.`);

// PLACEHOLDER: the design replaces this entirely (keep the form wired to submitContact and the honeypot field).
export default async function ContactPage(props: PageProps<'/contact'>) {
  const q = await props.searchParams;
  const sent = q.sent === '1';
  const error = typeof q.error === 'string' ? q.error : null;
  const b = site.business;
  return (
    <main id="main">
      {/* PLACEHOLDER: the design replaces this entirely */}
      <p><Link href="/">{b.name}</Link></p>
      <h1>Contact {b.name}</h1>
      {b.phone_e164 ? <p><a href={telHref(b.phone_e164)}>{b.phone_display}</a></p> : null}
      {b.email ? <p><a href={`mailto:${b.email}`}>{b.email}</a></p> : null}
      {sent ? <p role="status">Thanks, your message has been sent.</p> : null}
      {error ? <p role="alert">Please check the form and try again.</p> : null}
      <form action={submitContact}>
        <input type="hidden" name="business" value={b.name} />
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <Field id="name" name="name" label="Your name" required autoComplete="name" />
        <Field id="phone" name="phone" label="Phone" type="tel" autoComplete="tel" />
        <Field id="email" name="email" label="Email" type="email" autoComplete="email" />
        <Field id="message" name="message" label="How can we help?" type="textarea" required />
        <button type="submit">Send</button>
      </form>
      <ul>{b.hours.map((h) => <li key={h}>{h}</li>)}</ul>
      {b.address ? <p>{b.address}</p> : null}
      <MapEmbed business={b} label="Show the map" />
    </main>
  );
}
