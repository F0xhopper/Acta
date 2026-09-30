// Gather brand and facts for one lead and print a summary. Run: pnpm exec tsx scripts/gather-one.ts <slug> [--force]
import { getFullLead } from '../src/db/queries.js';
import { gather } from '../src/build/gather/index.js';

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('usage: gather-one <slug> [--force]'); process.exit(1); }
  const full = getFullLead(slug);
  if (!full) { console.error(`no lead ${slug}`); process.exit(1); }
  const t0 = Date.now();
  let places = 0, ch = 0;
  const r = await gather(full, { force: process.argv.includes('--force'), onRequest: (api) => { if (api === 'places') places++; else ch++; }, log: (m) => console.log('  ' + m) });
  const { brand, facts } = r;
  console.log(`\n${brand.name} (${facts.business.category_label}) in ${((Date.now() - t0) / 1000).toFixed(0)}s, places=${places} ch=${ch}`);
  console.log(`  dir:      ${r.dir}`);
  console.log(`  logo:     ${brand.logo.quality} via ${brand.logo.source} ${brand.logo.width ?? '?'}x${brand.logo.height ?? '?'} ${brand.logo.source_url ?? ''}`);
  console.log(`  palette:  primary=${brand.palette.primary} secondary=${brand.palette.secondary} accent=${brand.palette.accent} neutral=${brand.palette.neutral} bg=${brand.palette.background} (${brand.palette.confidence})`);
  brand.palette.notes.forEach((n) => console.log(`            ${n}`));
  console.log(`  fonts:    heading=${brand.fonts.heading} body=${brand.fonts.body} google=[${brand.fonts.google.join(', ')}]`);
  console.log(`  photos:   ${brand.photos.length} (${brand.photos.filter((p) => p.source === 'google').length} google, ${brand.photos.filter((p) => p.source === 'site').length} site)`);
  console.log(`  social:   ${JSON.stringify(brand.social)}`);
  console.log(`  tone:     ${brand.tone_hints.join(', ')}`);
  console.log(`  site:     ${brand.existing_site.status} keep=[${brand.existing_site.keep.join('; ')}] drop=[${brand.existing_site.drop.join('; ')}]`);
  console.log(`  upsells:  ${brand.quality.upsells.join('; ')}`);
  console.log(`  services: ${facts.services.map((s) => `${s.name} (${s.source})`).join(', ')}`);
  console.log(`  areas:    ${facts.areas.join(', ')}`);
  console.log(`  claims:   ${facts.claims.length}`);
  facts.claims.forEach((c) => console.log(`            - ${c.claim} [${c.source}] "${c.quote.slice(0, 90)}"`));
  console.log(`  company:  ${facts.company ? `${facts.company.name} ${facts.company.number} inc ${facts.company.incorporated}` : 'none'}`);
  console.log(`  attrs:    ${JSON.stringify(facts.attributes)}`);
  console.log(`  competitors: ${facts.competitors.map((c) => c.name).join(', ') || 'none'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
