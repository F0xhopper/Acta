import type { CSSProperties } from 'react';
import './globals.css';
import site from '@/content/site';
import { theme } from '@/theme';
import { headingFont, bodyFont } from './fonts';
import { SkipLink } from '@/kit/a11y/SkipLink';
import { localBusinessJsonLd, rootMetadata } from '@/kit/seo';
import { isPreview } from '@/kit/preview';
import { SeenBeacon } from '@/kit/seen';
import { fluidPx } from '@/kit/fluid';

export const metadata = rootMetadata(site);

const t = theme.type;
const l = theme.layout;
const cssVars = {
  '--primary': theme.colors.primary,
  '--on-primary': theme.colors.onPrimary,
  '--secondary': theme.colors.secondary,
  '--accent': theme.colors.accent,
  '--neutral': theme.colors.neutral,
  '--background': theme.colors.background,
  '--surface': theme.colors.surface,
  '--text': theme.colors.text,
  '--muted': theme.colors.muted,
  '--radius-sm': theme.radius.sm,
  '--radius-md': theme.radius.md,
  '--radius-lg': theme.radius.lg,
  // The scale: fluid between a 390px phone and a 1440px desktop. Tailwind: text-display, text-h1 ... px-gutter, py-section, max-w-container.
  '--text-display': fluidPx(t.display[0], t.display[1]),
  '--text-h1': fluidPx(t.h1[0], t.h1[1]),
  '--text-h2': fluidPx(t.h2[0], t.h2[1]),
  '--text-h3': fluidPx(t.h3[0], t.h3[1]),
  '--text-body': fluidPx(t.body[0], t.body[1]),
  '--text-small': fluidPx(t.small[0], t.small[1]),
  '--text-eyebrow': fluidPx(t.eyebrow[0], t.eyebrow[1]),
  '--measure': t.measure,
  '--gutter': fluidPx(l.gutter[0], l.gutter[1]),
  '--section': fluidPx(l.section[0], l.section[1]),
  '--container': `${l.container}px`,
} as CSSProperties;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-GB" className={`${headingFont.variable} ${bodyFont.variable}`} style={cssVars}>
      <head>
        {isPreview() ? <meta name="robots" content="noindex,nofollow" /> : null}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd(site)) }} />
      </head>
      <body>
        <SkipLink />
        {children}
        <SeenBeacon />
      </body>
    </html>
  );
}
