/**
 * The designer fills this from acta/brand.json and the brief. Every colour pair used in the UI must pass the contrast
 * gate (WCAG AA, 4.5:1). Values below are neutral placeholders so the starter builds before a brand exists.
 *
 * Colours are exposed as CSS variables on <html> by app/layout.tsx and as Tailwind tokens by app/globals.css,
 * so `bg-primary`, `text-muted`, `font-heading` etc. work everywhere. `onPrimary` is the text colour used on primary.
 *
 * `type` and `layout` are the site's scale: each pair is [phone, desktop] in px, made fluid between 390px and 1440px
 * by layout.tsx (`--text-h1`, `--space-section`, ...). They are values, not a design: the designer chooses every number
 * for this business, and the brief says why. A display size that is at least three times the body size, and a desktop
 * section rhythm that is at least twice the phone one, are the floor for a site that reads as designed.
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
  /** Font sizes in px as [phone, desktop]. `display` is the hero headline; `h1` the page title elsewhere. */
  type: {
    display: [40, 88],
    h1: [32, 56],
    h2: [26, 40],
    h3: [19, 24],
    body: [17, 18],
    small: [14, 15],
    eyebrow: [13, 14],
    /** Longest comfortable line of body text. */
    measure: '62ch',
  },
  /** Layout in px as [phone, desktop]: the page gutter, the vertical gap between sections, and the content width on desktop. */
  layout: {
    gutter: [20, 64],
    section: [64, 144],
    container: 1280,
  },
  radius: { sm: '0.25rem', md: '0.5rem', lg: '1rem', full: '9999px' },
  space: { xs: '0.5rem', sm: '1rem', md: '1.5rem', lg: '3rem', xl: '5rem' },
} as const;

export type Theme = typeof theme;
