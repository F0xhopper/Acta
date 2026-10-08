/** Outreach settings (config/outreach.yaml) and the secrets they need (.env). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';
import { loadOffer } from '../delivery/index.js';

export const TRANSPORTS = ['manual', 'test', 'proton', 'resend'] as const;
export type Transport = (typeof TRANSPORTS)[number];

const time = z.string().regex(/^\d{2}:\d{2}$/);
const Schema = z.object({
  transport: z.enum(TRANSPORTS).default('manual'),
  from: z.string().default(''),
  cap: z.object({ start_per_day: z.number().int().min(1).default(3), increase_per_week: z.number().int().min(0).default(3), max_per_day: z.number().int().min(1).default(20) }).default({ start_per_day: 3, increase_per_week: 3, max_per_day: 20 }),
  follow_ups: z.object({ days: z.array(z.number().int().min(1)).default([3, 8]), max_contacts: z.number().int().min(1).max(5).default(3), auto: z.boolean().default(false) }).default({ days: [3, 8], max_contacts: 3, auto: false }),
  send_window: z.object({ days: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]), from: time.default('09:00'), to: time.default('17:00') }).default({ days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }),
  replies: z.object({ check: z.boolean().default(false), every_minutes: z.number().int().min(2).default(10) }).default({ check: false, every_minutes: 10 }),
  proton_bridge: z.object({ host: z.string().default('127.0.0.1'), smtp_port: z.number().int().default(1025), imap_port: z.number().int().default(1143) }).default({ host: '127.0.0.1', smtp_port: 1025, imap_port: 1143 }),
});
export type OutreachConfig = z.infer<typeof Schema> & { fromAddress: string; fromName: string };

export function loadOutreach(): OutreachConfig {
  let raw: unknown = {};
  try { raw = parseYaml(readFileSync(join(ROOT, 'config', 'outreach.yaml'), 'utf8')) ?? {}; } catch { /* defaults */ }
  const cfg = Schema.parse(raw);
  let sender = { name: '', email: '' };
  try { sender = loadOffer().sender; } catch { /* no offer yet */ }
  const fromAddress = (cfg.from || sender.email || '').trim();
  return { ...cfg, fromAddress: /\[.*\]/.test(fromAddress) ? '' : fromAddress, fromName: /\[.*\]/.test(sender.name) ? '' : sender.name };
}

/** Whether a transport sends real email (as opposed to recording or writing files). */
export const sendsForReal = (t: Transport) => t === 'proton' || t === 'resend';

export const TRANSPORT_LABEL: Record<Transport, string> = {
  manual: 'By hand: copy into your mail app, then mark as sent',
  test: 'Test mode: emails are written to out/outbox, nothing is sent',
  proton: 'Proton Mail Bridge on this Mac',
  resend: 'Resend',
};

export const secrets = () => ({
  bridgeUser: process.env.PROTON_BRIDGE_USER ?? '',
  bridgePassword: process.env.PROTON_BRIDGE_PASSWORD ?? '',
  resendKey: process.env.RESEND_API_KEY ?? '',
});
