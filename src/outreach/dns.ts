/**
 * The sending domain's DNS, checked before Acta sends anything itself: mail records, SPF, DKIM and DMARC.
 * Without these, mail from a new domain lands in spam or is rejected.
 */
import { resolveCname, resolveMx, resolveTxt } from 'node:dns/promises';
import type { Transport } from './config.js';

export interface DnsCheck { name: string; ok: boolean; detail: string }
const txt = async (host: string) => { try { return (await resolveTxt(host)).map((r) => r.join('')); } catch { return []; } };

export async function checkDomain(domain: string, transport: Transport): Promise<DnsCheck[]> {
  if (!domain) return [{ name: 'Sending address', ok: false, detail: 'No sending address is set (config/outreach.yaml or config/offer.yaml).' }];
  const out: DnsCheck[] = [];
  let mx: string[] = [];
  try { mx = (await resolveMx(domain)).map((r) => r.exchange.toLowerCase()); } catch { /* none */ }
  const proton = transport === 'proton' || mx.some((m) => m.endsWith('protonmail.ch'));
  out.push({ name: 'Receives replies (MX)', ok: mx.length > 0, detail: mx.length ? mx.join(', ') : `No mail records on ${domain}, so replies would bounce.` });

  if (transport === 'resend') {
    const spf = (await txt(`send.${domain}`)).find((t) => t.startsWith('v=spf1'));
    out.push({ name: 'SPF', ok: !!spf && /amazonses\.com/.test(spf), detail: spf ?? `No SPF record on send.${domain}. Add the one Resend shows.` });
    const dkim = (await txt(`resend._domainkey.${domain}`)).find((t) => /p=/.test(t));
    out.push({ name: 'DKIM', ok: !!dkim, detail: dkim ? 'resend._domainkey is set' : `No DKIM record at resend._domainkey.${domain}. Add the one Resend shows.` });
  } else {
    const spf = (await txt(domain)).find((t) => t.startsWith('v=spf1'));
    out.push({ name: 'SPF', ok: !!spf && (!proton || spf.includes('_spf.protonmail.ch')), detail: spf ?? `No SPF record on ${domain}.` });
    if (proton) {
      const found: string[] = [];
      for (const sel of ['protonmail', 'protonmail2', 'protonmail3']) { try { const c = await resolveCname(`${sel}._domainkey.${domain}`); if (c.length) found.push(sel); } catch { /* missing */ } }
      out.push({ name: 'DKIM', ok: found.length === 3, detail: found.length === 3 ? 'All three Proton signing records are set' : `${found.length} of 3 Proton signing records (protonmail._domainkey and friends) are set. Add them from Proton's domain settings.` });
    } else {
      out.push({ name: 'DKIM', ok: false, detail: 'No mail provider detected to check DKIM against. Choose proton or resend in config/outreach.yaml.' });
    }
  }
  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.startsWith('v=DMARC1'));
  out.push({ name: 'DMARC', ok: !!dmarc, detail: dmarc ?? `No DMARC record at _dmarc.${domain}.` });
  return out;
}
