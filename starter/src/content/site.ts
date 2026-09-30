// PLACEHOLDER content so the starter builds and the gates run before a lead is seeded.
// The pipeline overwrites this file from acta/facts.json; the copywriter fills the copy fields.
import type { Site } from '@/kit/site-schema';

const site: Site = {
  business: {
    name: 'Example Plumbing',
    phone_e164: '+441210000000',
    phone_display: '0121 000 0000',
    whatsapp: null,
    email: null,
    address: '1 Example Street, Birmingham',
    postcode: 'B1 1AA',
    area: 'Birmingham',
    city: 'Birmingham',
    maps_url: null,
    hours: ['Monday: 9:00 am – 5:00 pm', 'Tuesday: 9:00 am – 5:00 pm', 'Wednesday: 9:00 am – 5:00 pm', 'Thursday: 9:00 am – 5:00 pm', 'Friday: 9:00 am – 5:00 pm', 'Saturday: Closed', 'Sunday: Closed'],
    rating: null,
    review_count: null,
  },
  copy: {
    tagline: 'Placeholder tagline',
    hero_heading: 'Placeholder heading',
    hero_sub: 'Placeholder sub heading for the starter. Replaced by the copywriter.',
    about_heading: 'About Example Plumbing',
    about_body: 'Placeholder about text. Replaced by the copywriter from acta/facts.json.',
    cta_label: 'Call now',
    cta_sub: 'Placeholder call to action.',
  },
  services: [{ slug: 'general-plumbing', name: 'General plumbing', summary: 'Placeholder summary.', body: 'Placeholder body.' }],
  areas: [{ slug: 'birmingham', name: 'Birmingham', body: 'Placeholder area text.' }],
  reviews: [],
  claims: [],
  social: {},
  logo: null,
  photos: [],
  meta: { title: 'Example Plumbing', description: 'Placeholder description for the Acta starter.' },
};

export default site;
