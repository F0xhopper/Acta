export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function leadSlug(area: string, categoryKey: string, name: string): string {
  return slugify(`${area}-${categoryKey}-${name}`);
}

/** Normalise a business name for fuzzy comparison. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|limited|llp|plc|uk|the|co|company)\b\.?/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token Dice coefficient between two normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseName(a).split(' ').filter(Boolean));
  const tb = new Set(normaliseName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}
