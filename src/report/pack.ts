import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findCategory } from '../config.js';
import type { FullLead } from '../db/types.js';
import type { PlaceReview } from '../discover/places.js';
import { displayUkPhone } from '../util/phone.js';
import { draftPitch } from './pitch.js';
import { hook, link, nextAction, siteUrl, telLink, websiteLink, latestReviewText } from './format.js';
import { describeLead, reviewsOf, SOURCE_LABEL } from './describe.js';

const yn = (v: number | null | undefined) => (v === null || v === undefined ? 'unknown' : v ? 'yes' : 'no');

export function writePack(outDir: string, full: FullLead, reviews: PlaceReview[] = []): string {
  const { lead, audit, ch, score, pipeline } = full;
  const dir = join(outDir, 'leads', lead.slug);
  mkdirSync(dir, { recursive: true });
  const category = findCategory(lead.category_key);
  const reasons: string[] = score ? JSON.parse(score.reasons_json) : [];

  writeFileSync(join(dir, 'lead.json'), JSON.stringify({ lead: { ...lead, raw_json: undefined }, audit, companies_house: ch, score: score ? { ...score, reasons } : null, pipeline, reviews }, null, 2));

  const copied: Record<string, string | null> = { mobile: null, desktop: null, lighthouse: null };
  for (const [key, src, name] of [['mobile', audit?.screenshot_mobile, 'current-mobile.png'], ['desktop', audit?.screenshot_desktop, 'current-desktop.png'], ['lighthouse', audit?.lh_json_path, 'lighthouse.json']] as const) {
    if (src && existsSync(src)) { copyFileSync(src, join(dir, name)); copied[key] = name; }
  }

  const hours: string[] = lead.opening_hours_json ? JSON.parse(lead.opening_hours_json) : [];
  const pitch = draftPitch(full, category);
  const about = describeLead(full);
  const listingReviews = reviewsOf(full);
  const mustHaves = [
    'Click-to-call and WhatsApp buttons above the fold on mobile',
    'Google rating and review count near the top',
    ...(category?.must_haves ?? []),
    'One page per main service, one page per nearby area served',
    'Opening hours, address and map matching the Google listing exactly',
    'LocalBusiness schema, sitemap, Open Graph image, Lighthouse mobile 90+',
  ];

  const md = `# ${lead.name}

**${lead.category_raw}** in **${lead.area}**. Tier **${score?.tier ?? '?'}**, total **${score?.total ?? '?'}** (opportunity ${score?.opportunity ?? '?'}, viability ${score?.viability ?? '?'}).

${[link('Google Maps', lead.google_maps_url), siteUrl(full) ? link('Current website', siteUrl(full)) : null, lead.phone_e164 ? telLink(lead.phone_e164) : null, copied.mobile ? link('Their site on a phone', copied.mobile) : null].filter(Boolean).join(' · ')}

> ${hook(full)}

**Next step:** ${nextAction(full)}

## About

${about.text}

*Source: ${SOURCE_LABEL[about.source]}.* Type on Google: ${lead.type_label ?? lead.category_raw}. Website: ${websiteLink(full)}. Latest review: ${latestReviewText(full)}.

## Listing

| | |
|---|---|
| Phone | ${displayUkPhone(lead.phone_e164) || 'none listed'} |
| Address | ${lead.address ?? ''} |
| Rating | ${lead.rating ?? 'n/a'} from ${lead.review_count ?? 0} reviews |
| Website on listing | ${lead.website_url ?? 'none'} |
| Google Maps | ${lead.google_maps_url ?? ''} |
| Entity | ${ch?.match_confidence === 'high' ? `Limited company: ${ch.company_name} (${ch.company_number})` : `Unknown, treat as sole trader${ch?.match_confidence === 'medium' ? ` (possible match: ${ch.company_name})` : ''}`} |
| Hours | ${hours.length ? hours.join('<br>') : 'not listed'} |

## Why this lead

${reasons.map((r) => `- ${r}`).join('\n') || '- (not scored)'}

## Current website audit

| Check | Result |
|---|---|
| Status | ${audit?.website_status ?? 'not audited'} |
| Final URL | ${audit?.final_url ?? ''} |
| HTTPS | ${yn(audit?.https_ok)} |
| Mobile viewport | ${yn(audit?.has_viewport)} |
| Builder | ${audit?.builder ?? 'unknown'}${audit?.free_tier_host ? ' (free tier)' : ''} |
| Copyright year | ${audit?.copyright_year ?? 'not found'} |
| Lighthouse mobile | perf ${audit?.lh_perf ?? '-'} / seo ${audit?.lh_seo ?? '-'} / a11y ${audit?.lh_a11y ?? '-'} / best practices ${audit?.lh_bp ?? '-'}${audit?.lh_error ? ` (PSI error: ${audit.lh_error})` : ''} |
| Phone on site matches listing | ${yn(audit?.phone_matches_listing)} |
| LocalBusiness schema | ${yn(audit?.has_local_schema)} |
| Screenshots | ${copied.mobile ? `[mobile](${copied.mobile})` : 'none'} ${copied.desktop ? `[desktop](${copied.desktop})` : ''} |

## What the new site needs

${mustHaves.map((m) => `- [ ] ${m}`).join('\n')}

${reviews.length ? `## Review snippets for copy\n\n${reviews.slice(0, 6).map((r) => `> ${r.rating ?? ''}★ ${(r.text?.text ?? '').replace(/\s+/g, ' ').slice(0, 300)} — ${r.authorAttribution?.displayName ?? 'Google user'}, ${r.relativePublishTimeDescription ?? ''}`).join('\n\n')}\n` : listingReviews.length ? `## What customers say\n\nUse these for the site's copy and testimonials. Quote with first name only.\n\n${listingReviews.map((r) => `> ${r.rating ?? ''}★ ${r.text.slice(0, 300)} — ${r.author ?? 'Google user'}, ${r.when ?? ''}`).join('\n\n')}\n` : ''}
## Outreach

Recommended channel: **${pitch.channel}**${category?.dm && pitch.channel !== 'dm' ? ' (Instagram DM as a follow-up)' : ''}

\`\`\`
${pitch.text}
\`\`\`

## Next

- Build checklist: docs/PLAYBOOK.md
- When contacted: \`pnpm pipeline status ${lead.slug} contacted\`
`;
  writeFileSync(join(dir, 'notes.md'), md);
  return dir;
}

export function packRelPath(outDir: string, slug: string): string {
  return join('leads', slug, 'notes.md').replace(basename(outDir), '');
}
