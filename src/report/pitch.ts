import type { Category } from '../config.js';
import type { FullLead } from '../db/types.js';

function problem(full: FullLead): string {
  const s = full.audit?.website_status;
  if (s === 'none') return "doesn't have a website";
  if (s === 'down' || s === 'broken') return 'has a website that isn\'t loading properly';
  if (s === 'facebook_only') return 'only has a Facebook page rather than a website';
  if (s === 'directory_only') return 'only shows up on a directory listing rather than your own site';
  if (s === 'platform_only') return 'only has a booking page rather than your own site';
  if (full.audit?.has_viewport === 0) return "has a site that doesn't work well on phones";
  if ((full.audit?.lh_perf ?? 100) < 50) return 'has a site that loads slowly on phones';
  return 'has a site that could be doing a lot more for you';
}

export function draftPitch(full: FullLead, category: Category | undefined): { channel: string; text: string } {
  const name = full.lead.name;
  const area = full.lead.area;
  const service = full.lead.category_raw.replace(/s$/, '');
  const channel = full.score?.channel ?? 'phone';
  const p = problem(full);

  if (channel === 'email') {
    return { channel, text: `Subject: Made you a quick website mock-up, ${name}

Hi team,

I'm [Your name], a web developer in [your area], Birmingham. I noticed ${name} ${p}, so I put together a version of what one could look like:

[preview link]  (best on your phone)

It's built to load fast, show up on Google for "${service} ${area}", and let people call or WhatsApp you in one tap.

If you'd like it, it's £[X] to finish with your own photos and words, then £[Y] a month for hosting and any changes. I can sort a .co.uk domain and a proper email address too.

No pressure either way. Happy to tweak it or answer anything.

[Your name]
[phone] · [your site]

[Your trading name], [postal address]. Reply "no thanks" and I won't contact you again.` };
  }
  if (channel === 'walk_in') {
    return { channel, text: `Walk in mid-afternoon. Have the preview open on your phone.

"Hi, are you the owner? I'm [Your name], I build websites, I'm just up the road in [your area]. I noticed ${name} ${p}, so I made a quick one for you. Can I show you? Takes ten seconds."

Show it. Say the price (£[X], then £[Y] a month). Leave a card with the link. Two minutes max unless they ask questions.` };
  }
  if (channel === 'dm') {
    return { channel, text: `Hi! Local web dev here in [your area]. Love the ${category?.key === 'cafe' || category?.key === 'restaurant' ? 'photos' : 'reviews'}, noticed ${name} ${p} so I mocked one up: [preview link]. Built for phones, one tap to call or book. £[X] if you want it finished with your own photos. No worries if not!` };
  }
  return { channel, text: `Call 9 to 11 or 2 to 4, not Monday.

"Hi, is that the owner? I'm [Your name], I'm a web developer in [your area]. I build sites for local ${service}s. I noticed ${name} ${p}, and I've actually mocked one up for you already. Can I text you the link so you can have a look when you've got a minute?"

If yes: text the link and the price in one message. If they ask the price: £[X], then £[Y] a month, say it plainly. If no: "No problem, thanks for your time", then mark lost.` };
}
