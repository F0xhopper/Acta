/**
 * The designer fills this from acta/brand.json. Every colour pair used in the UI must pass the contrast gate
 * (WCAG AA, 4.5:1). Values below are neutral placeholders so the starter builds before a brand exists.
 *
 * Colours are exposed as CSS variables on <html> by app/layout.tsx and as Tailwind tokens by app/globals.css,
 * so `bg-primary`, `text-muted`, `font-heading` etc. work everywhere. `onPrimary` is the text colour used on primary.
 */
export const theme = {
  colors: {
    primary: '#1f2937',
    onPrimary: '#ffffff',
    secondary: '#4b5563',
    accent: '#111827',
    neutral: '#6b7280',
    background: '#ffffff',
    surface: '#f3f4f6',
    text: '#111827',
    muted: '#4b5563',
  },
  fonts: {
    /** Family names. Must match what app/fonts.ts loads. */
    heading: 'Inter',
    body: 'Inter',
  },
  radius: { sm: '0.25rem', md: '0.5rem', lg: '1rem', full: '9999px' },
  space: { xs: '0.5rem', sm: '1rem', md: '1.5rem', lg: '3rem', xl: '5rem' },
} as const;

export type Theme = typeof theme;
