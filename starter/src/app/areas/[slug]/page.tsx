import { notFound } from 'next/navigation';
import Link from 'next/link';
import site from '@/content/site';
import { pageMetadata } from '@/kit/seo';
import { telHref } from '@/kit/phone';

export const dynamicParams = false;
export function generateStaticParams() { return site.areas.map((a) => ({ slug: a.slug })); }

export async function generateMetadata(props: PageProps<'/areas/[slug]'>) {
  const { slug } = await props.params;
  const a = site.areas.find((x) => x.slug === slug);
  return a ? pageMetadata(`${site.services[0]?.name ?? site.business.name} in ${a.name}`, a.body.slice(0, 160)) : {};
}

// PLACEHOLDER: the design replaces this entirely.
export default async function AreaPage(props: PageProps<'/areas/[slug]'>) {
  const { slug } = await props.params;
  const a = site.areas.find((x) => x.slug === slug);
  if (!a) notFound();
  return (
    <main id="main">
      {/* PLACEHOLDER: the design replaces this entirely */}
      <p><Link href="/">{site.business.name}</Link></p>
      <h1>{a.name}</h1>
      <p>{a.body}</p>
      {site.business.phone_e164 ? <a href={telHref(site.business.phone_e164)}>{site.copy.cta_label}: {site.business.phone_display}</a> : null}
    </main>
  );
}
