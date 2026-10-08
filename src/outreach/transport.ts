/**
 * Delivering an email: written to a file in test mode, or sent through Proton Mail Bridge or Resend.
 * Plain text only, one message per call, a Message-ID we choose so replies can be matched, and a
 * List-Unsubscribe header pointing back at you.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { OUT_DIR } from '../config.js';
import { type OutreachConfig, secrets } from './config.js';
import { domainOf } from './rules.js';

export interface Outgoing { to: string; subject: string; body: string; inReplyTo?: string | null; slug: string }
export interface Delivered { status: 'sent' | 'written' | 'failed'; messageId: string; providerId: string | null; error: string | null; file?: string }

export const newMessageId = (from: string, slug: string) => `<acta.${slug.slice(0, 40)}.${Date.now().toString(36)}.${randomBytes(4).toString('hex')}@${domainOf(from) || 'acta.local'}>`;

function mailOptions(cfg: OutreachConfig, m: Outgoing, messageId: string) {
  const from = cfg.fromName ? `"${cfg.fromName.replace(/"/g, '')}" <${cfg.fromAddress}>` : cfg.fromAddress;
  return {
    from, to: m.to, replyTo: cfg.fromAddress, subject: m.subject, text: m.body, messageId,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [m.inReplyTo] } : {}),
    headers: { 'List-Unsubscribe': `<mailto:${cfg.fromAddress}?subject=unsubscribe>` },
  };
}

export async function deliver(cfg: OutreachConfig, m: Outgoing): Promise<Delivered> {
  const messageId = newMessageId(cfg.fromAddress, m.slug);
  try {
    if (cfg.transport === 'test') {
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      const info = await t.sendMail(mailOptions(cfg, m, messageId));
      const dir = join(OUT_DIR, 'outbox');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.slug.slice(0, 50)}.eml`);
      writeFileSync(file, info.message as Buffer);
      return { status: 'written', messageId, providerId: null, error: null, file };
    }
    if (cfg.transport === 'proton') {
      const s = secrets();
      if (!s.bridgeUser || !s.bridgePassword) throw new Error('PROTON_BRIDGE_USER and PROTON_BRIDGE_PASSWORD are not set in .env');
      const local = /^(127\.0\.0\.1|localhost|::1)$/.test(cfg.proton_bridge.host);
      const t = nodemailer.createTransport({
        host: cfg.proton_bridge.host, port: cfg.proton_bridge.smtp_port, secure: false, requireTLS: true,
        auth: { user: s.bridgeUser, pass: s.bridgePassword },
        // Bridge listens on this Mac with its own self-signed certificate; trust it only when it's local.
        tls: { rejectUnauthorized: !local },
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      });
      const info = await t.sendMail(mailOptions(cfg, m, messageId));
      return { status: 'sent', messageId, providerId: info.messageId ?? null, error: null };
    }
    if (cfg.transport === 'resend') {
      const key = secrets().resendKey;
      if (!key) throw new Error('RESEND_API_KEY is not set in .env');
      const o = mailOptions(cfg, m, messageId);
      const headers: Record<string, string> = { ...o.headers, 'Message-ID': messageId };
      if (m.inReplyTo) { headers['In-Reply-To'] = m.inReplyTo; headers.References = m.inReplyTo; }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: o.from, to: [m.to], reply_to: cfg.fromAddress, subject: m.subject, text: m.body, headers }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await res.json().catch(() => ({})) as { id?: string; message?: string };
      if (!res.ok) throw new Error(`Resend ${res.status}: ${j.message ?? 'request failed'}`);
      return { status: 'sent', messageId, providerId: j.id ?? null, error: null };
    }
    throw new Error(`Transport "${cfg.transport}" does not send email`);
  } catch (e) {
    return { status: 'failed', messageId, providerId: null, error: (e as Error).message.slice(0, 500) };
  }
}
