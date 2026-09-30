// Managed by Acta. Do not edit. Regulated or reputational phrases that need evidence in acta/facts.json.
export const REGULATED_PHRASES: { key: string; re: RegExp }[] = [
  { key: 'gas safe', re: /gas\s*safe/gi },
  { key: 'niceic', re: /niceic/gi },
  { key: 'napit', re: /napit/gi },
  { key: 'checkatrade', re: /checkatrade/gi },
  { key: 'trustmark', re: /trust\s*mark/gi },
  { key: 'which? trusted', re: /which\??\s*trusted/gi },
  { key: 'fully insured', re: /fully\s+insured/gi },
  { key: 'dbs checked', re: /dbs[\s-]*checked/gi },
  { key: 'award-winning', re: /award[\s-]*winning/gi },
  { key: 'years experience', re: /\b\d+\+?\s*years'?\s*(?:of\s+)?experience\b/gi },
  { key: 'ofsted', re: /ofsted/gi },
  { key: 'cqc', re: /\bcqc\b/gi },
  { key: 'gdc', re: /\bgdc\b/gi },
  { key: 'sra', re: /\bsra\b/gi },
];

/** Phrases found in `text` that are not backed by any claim string. */
export function unbackedClaims(text: string, claims: string[]): string[] {
  const backing = claims.map((c) => c.toLowerCase()).join(' | ');
  const out = new Set<string>();
  for (const { key, re } of REGULATED_PHRASES) {
    for (const m of text.matchAll(re)) {
      const phrase = m[0].toLowerCase().replace(/\s+/g, ' ');
      const backed = backing.includes(phrase) || backing.includes(key) || (key === 'years experience' && /\b\d+\+?\s*years/.test(backing) && backing.includes(phrase.match(/\d+/)?.[0] ?? '\u0000'));
      if (!backed) out.add(m[0]);
    }
  }
  return [...out];
}
