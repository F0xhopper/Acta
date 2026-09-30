// The designer replaces these imports to match theme.fonts (Google Fonts only, loaded through next/font so they self-host).
// Keep the exported names: layout.tsx relies on headingFont and bodyFont.
import { Inter } from 'next/font/google';

export const headingFont = Inter({ subsets: ['latin'], variable: '--font-heading', display: 'swap' });
export const bodyFont = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
