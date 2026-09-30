// Managed by Acta. Do not edit.
/** True while the site is an Acta preview: noindex everywhere, robots disallow. Set ACTA_PREVIEW=1 at build time. */
export const isPreview = () => process.env.ACTA_PREVIEW === '1';
