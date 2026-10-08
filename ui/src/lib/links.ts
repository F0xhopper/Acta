import type { BusinessTab } from '../../../src/ui/api-types';

/**
 * The business page has four tabs: Overview, Build, Review and Send. Photos and concepts are views inside
 * Build, and compare is a mode of Review. The server still names the finer tabs, so map them here.
 */
const PATH: Record<BusinessTab, string> = {
  overview: 'overview', progress: 'build', photos: 'build?view=photos', concepts: 'build?view=concepts',
  review: 'review', compare: 'review?mode=compare', deliver: 'send',
};
export const bizPath = (slug: string, tab: BusinessTab = 'overview') => `/b/${encodeURIComponent(slug)}/${PATH[tab]}`;
