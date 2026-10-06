// The link preview shown in WhatsApp, iMessage and social apps (src/kit/brand-images).
import { OG_SIZE, ogImage } from '@/kit/brand-images';
import site from '@/content/site';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = `${site.business.name}, ${site.business.area}`;
export default function OpengraphImage() { return ogImage(); }
