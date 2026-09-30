import { notFound } from 'next/navigation';
import Link from 'next/link';
import site from '@/content/site';
import { pageMetadata } from '@/kit/seo';
import { telHref } from '@/kit/phone';

export const dynamicParams = false;
export function generateStaticParams() { return site.services.map((s) => ({ slug: s.slug })); }

export async function generateMetadata(props: PageProps<'/services/[slug]'>) {
  const { slug } = await props.params;
  const s = site.services.find((x) => x.slug === slug);
  return s ? pageMetadata(`${s.name} in ${site.business.area}`, s.summary) : {};
}

// PLACEHOLDER: the design replaces this entirely.
export default async function ServicePage(props: PageProps<'/services/[slug]'>) {
  const { slug } = await props.params;
  const s = site.services.find((x) => x.slug === slug);
  if (!s) notFound();
  return (
    <main id="main">
      {/* PLACEHOLDER: the design replaces this entirely */}
      <p><Link href="/">{site.business.name}</Link></p>
      <h1>{s.name}</h1>
      <p>{s.summary}</p>
      <p>{s.body}</p>
      {site.business.phone_e164 ? <a href={telHref(site.business.phone_e164)}>{site.copy.cta_label}: {site.business.phone_display}</a> : null}
    </main>
  );
}
