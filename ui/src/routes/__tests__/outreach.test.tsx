import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeadOutreach, OutreachStatus } from '../../../../src/ui/api-types';
import { ToastProvider } from '../../components/ui/toast';
import { FollowUpPanel, MessageHistory, SendingLine } from '../business/deliver-outreach';

const status = (over: Partial<OutreachStatus> = {}): OutreachStatus => ({
  transport: 'manual', transportLabel: 'By hand: copy into your mail app, then mark as sent', from: 'hello@actastudio.co.uk', sendsForReal: false, canSendNow: false,
  problems: ['Sending is by hand.'], cap: { today: 3, sentToday: 1, left: 2, warmupWeek: 1 },
  dns: [{ name: 'DKIM', ok: false, detail: '0 of 3 Proton signing records' }], followUps: { auto: false, days: [3, 8], maxContacts: 3 },
  replies: { check: false, lastCheckedAt: null, lastError: null, matched: 0 }, ...over,
});
const lead: LeadOutreach = {
  messages: [{ id: 1, direction: 'out', kind: 'pitch', channel: 'email', to: 'owner@shop.co.uk', from: 'hello@actastudio.co.uk', subject: 'Made you a quick website mock-up', body: 'Hi there', transport: 'manual', status: 'logged', error: null, at: '2026-10-05T10:00:00Z' }],
  followUp: { slug: 'oslo', name: "Oslo's Barbers", n: 1, dueAt: '2026-10-08T10:00:00Z', overdue: true, channel: 'email', to: 'owner@shop.co.uk', canEmail: true, subject: 'Re: Made you a quick website mock-up', body: 'Hi again, just checking.', last: false },
  nextTouchAt: '2026-10-08T10:00:00Z', pitchBlockers: [],
};

function setup(o: OutreachStatus, calls: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`);
    if (url === '/api/outreach') return new Response(JSON.stringify(o));
    if (url.endsWith('/outreach')) return new Response(JSON.stringify(lead));
    if (url.endsWith('/followup')) return new Response(JSON.stringify({ ok: true, message: 'Follow-up recorded', sent: lead.messages[0] }));
    return new Response('null');
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><SendingLine /><FollowUpPanel slug="oslo" /><MessageHistory slug="oslo" /></ToastProvider></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe('outreach on the Send tab', () => {
  it('says how sending works and flags the domain setup', async () => {
    setup(status());
    expect(await screen.findByText(/By hand: copy into your mail app/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 emails today/)).toBeInTheDocument();
    expect(screen.getByText(/domain setup incomplete/)).toBeInTheDocument();
  });
  it('offers to record a follow-up sent by hand, and lists the pitch', async () => {
    const calls: string[] = [];
    setup(status(), calls);
    expect(await screen.findByText('Follow-up 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send follow-up/ })).not.toBeInTheDocument();
    expect(screen.getByText('Pitch')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I sent it myself' }));
    expect(calls.some((c) => c.startsWith('POST /api/leads/oslo/followup') && c.includes('"mode":"logged"'))).toBe(true);
  });
  it('shows a Send button when Acta can send itself', async () => {
    setup(status({ transport: 'proton', sendsForReal: true, canSendNow: true, problems: [] }));
    expect(await screen.findByRole('button', { name: /Send follow-up/ })).toBeInTheDocument();
  });
});
