import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../../../src/ui/api-types';
import { AgentGuardProvider } from '../../components/agent-guard';
import { ToastProvider } from '../../components/ui/toast';
import type { BusinessCtx } from '../business/context';
import { bestReviews, OverviewTab } from '../business/overview';

const lead: LeadDetail = {
  slug: 'oslo', name: "Oslo's Barbers", category: 'barber', categoryLabel: 'Barber', area: 'Kings Heath', address: '1 High St', rating: 4.9, reviews: 210,
  phone: '0121 000 0000', websiteStatus: 'none', websiteUrl: null, tier: 'A', score: 88, opportunity: 55, viability: 33, channel: 'phone', ltd: true,
  status: 'shortlisted', buildState: null, hook: 'No website and 210 reviews', reasons: ['No website', 'Busy and well rated'],
  mapsUrl: null, sourceQuery: 'barbers in Kings Heath', discoveredAt: '2026-10-01T00:00:00Z', reach: { level: 'message', label: 'Can message', email: null, emailSource: null, emailUrl: null, emailAllowed: false, mobile: true, walkIn: true, socials: [], summary: 'Mobile, for WhatsApp after a call.', checkedAt: null, webSearchedAt: null }, content: { score: 72, level: 'plenty', label: 'Plenty to build from', summary: 'Plenty to build from (72/100)' }, verdict: 'pass', grade: 72, missing: null, gaps: [], qualify: { verdict: 'pass', grade: 72, gates: [{ key: 'trade', label: 'Good trade', pass: true, detail: 'barber: trade value 30', short: '' }], parts: [{ key: 'gap', label: 'How much a site would help', points: 20, max: 20, detail: 'No website' }] }, contentItems: [{ key: 'photos', label: 'Photos', have: 'yes', detail: '10+ on Google', points: 24, max: 30 }, { key: 'services', label: 'Services and prices', have: 'no', detail: 'A typical barber list, prices to ask them for', points: 0, max: 15 }],
  makeUp: ['Services and prices: a typical list, prices to ask them for'], foundSiteUrl: null, description: { text: '', source: 'none' }, hours: ['Mon 9–6'],
  reviewsList: [
    { rating: 5, text: 'Best fade in Birmingham, friendly and quick every time.', author: 'Sam', when: 'a week ago' },
    { rating: 3, text: 'Fine but had to wait a long while for my turn.', author: 'Al', when: null },
  ],
  audit: null, currentSiteShot: null, timeline: [{ at: '2026-10-05T22:30:00Z', kind: 'status', text: 'Picked by hand' }], build: null,
  nextAction: { label: 'Build the site', tab: 'progress', kind: 'build' },
  callFirst: null,
};

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
afterEach(() => vi.unstubAllGlobals());

describe('Overview', () => {
  it('quotes the best reviews first', () => {
    expect(bestReviews(lead.reviewsList)[0].author).toBe('Sam');
  });

  it('shows the next action, reasons and facts, and starts a build', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/start')) return new Response(JSON.stringify({ id: 9, kind: 'build', target: 'oslo', label: 'Build', status: 'queued', createdAt: '', startedAt: null, endedAt: null, exitCode: null, lastLine: null }));
      return new Response('null');
    }));
    const ctx: BusinessCtx = { slug: 'oslo', lead, build: undefined, buildLoading: false };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AgentGuardProvider>
      <Routes><Route element={<Outlet context={ctx} />}><Route path="/" element={<OverviewTab />} /></Route></Routes>
    </AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('Busy and well rated')).toBeInTheDocument();
    expect(screen.getByText('Limited company')).toBeInTheDocument();
    expect(screen.getByText(/Best fade in Birmingham/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Build the site/ }));
    expect(calls).toContain('POST /api/builds/oslo/start');
    expect(await screen.findByText("Build queued for Oslo's Barbers")).toBeInTheDocument();
  });

  it('asks before marking do not contact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null')));
    const ctx: BusinessCtx = { slug: 'oslo', lead, build: undefined, buildLoading: false };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AgentGuardProvider>
      <Routes><Route element={<Outlet context={ctx} />}><Route path="/" element={<OverviewTab />} /></Route></Routes>
    </AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Do not contact' }));
    expect(await screen.findByText(/suppression list/)).toBeInTheDocument();
  });
});

describe('Overview content', () => {
  it('lists what we have and what the site would make up', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null')));
    const ctx: BusinessCtx = { slug: 'oslo', lead, build: undefined, buildLoading: false };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ToastProvider><AgentGuardProvider>
      <Routes><Route element={<Outlet context={ctx} />}><Route path="/" element={<OverviewTab />} /></Route></Routes>
    </AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('What we have to build from')).toBeTruthy();
    expect(screen.getByText('10+ on Google')).toBeTruthy();
    expect(screen.getByText('Services and prices: a typical list, prices to ask them for')).toBeTruthy();
  });

  it('shows the call-first script and records a yes', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
      if (url.endsWith('/call')) return new Response(JSON.stringify({ ok: true, message: "Oslo's Barbers: yes. The build goes ahead." }));
      return new Response('null');
    }));
    const waiting: LeadDetail = { ...lead, buildState: 'awaiting_call', nextAction: { label: 'Call them first', tab: 'overview', kind: 'call' },
      callFirst: { waiting: true, phone: '07700 900123', whatsapp: true, walkIn: true, lines: ['Call 07700 900123 between 9 and 11.', '', '"Hi, is that the owner of Oslo\'s Barbers?"'], consent: null } };
    const ctx: BusinessCtx = { slug: 'oslo', lead: waiting, build: undefined, buildLoading: false };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AgentGuardProvider>
      <Routes><Route element={<Outlet context={ctx} />}><Route path="/" element={<OverviewTab />} /></Route></Routes>
    </AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText(/is that the owner of Oslo/)).toBeInTheDocument();
    expect(screen.getByText('Build waits for this')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Note from the call'), 'send it Friday');
    await userEvent.click(screen.getByRole('button', { name: 'They said yes' }));
    expect(calls.some((c) => c.startsWith('POST /api/leads/oslo/call') && c.includes('"answer":"yes"') && c.includes('send it Friday'))).toBe(true);
    expect(await screen.findByText(/The build goes ahead/)).toBeInTheDocument();
  });
});
