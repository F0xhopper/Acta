import type { CSSProperties } from 'react';
import './globals.css';
import site from '@/content/site';
import { theme } from '@/theme';
import { headingFont, bodyFont } from './fonts';
import { SkipLink } from '@/kit/a11y/SkipLink';
import { localBusinessJsonLd, rootMetadata } from '@/kit/seo';
import { isPreview } from '@/kit/preview';

export const metadata = rootMetadata(site);

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
      </body>
    </html>
  );
}
