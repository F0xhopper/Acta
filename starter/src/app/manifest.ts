// The web app manifest: name and colours when saved to a phone's home screen.
import type { MetadataRoute } from 'next';
import site from '@/content/site';
import { theme } from '@/theme';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.business.name,
    short_name: site.business.name.length > 12 ? site.business.name.split(/\s+/)[0] : site.business.name,
    description: site.meta.description,
    start_url: '/',
    display: 'browser',
    background_color: theme.colors.background,
    theme_color: theme.colors.neutral,
    icons: [{ src: '/apple-icon', sizes: '180x180', type: 'image/png' }, { src: '/icon', sizes: '64x64', type: 'image/png' }],
  };
}
