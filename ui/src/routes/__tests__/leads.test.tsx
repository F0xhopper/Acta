import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeadSummary } from '../../../../src/ui/api-types';
import { AgentGuardProvider } from '../../components/agent-guard';
import { ToastProvider } from '../../components/ui/toast';
import { filtersFrom, LeadsPage } from '../leads';

const lead = (over: Partial<LeadSummary>): LeadSummary => ({
  slug: 's', name: 'N', category: 'barber', categoryLabel: 'Barber', area: 'Moseley', address: null, rating: 4.8, reviews: 100, phone: null,
  websiteStatus: 'none', websiteUrl: null, tier: 'A', score: 80, opportunity: 50, viability: 30, channel: 'phone', ltd: false, status: 'new',
  buildState: null, hook: 'No website', reasons: [], mapsUrl: null, sourceQuery: 'barbers in Moseley', discoveredAt: '2026-10-01T00:00:00Z', ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('Leads', () => {
  it('defaults the tier filter to A and B, and "all" clears it', () => {
    expect(filtersFrom(new URLSearchParams()).tier).toEqual(['A', 'B']);
    expect(filtersFrom(new URLSearchParams('tier=all')).tier).toBeUndefined();
  });

  it('lists leads, offers Unpick on a queued pick, and picks a lead', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/leads?')) return new Response(JSON.stringify([
        lead({ slug: 'a', name: 'Alpha Barbers', score: 90 }),
        lead({ slug: 'b', name: 'Beta Cuts', status: 'shortlisted', buildState: 'picked' }),
      ]));
      if (url.startsWith('/api/meta')) return new Response(JSON.stringify({ categories: [{ key: 'barber', label: 'Barber' }], areas: ['Moseley'], senderMissing: [], checkpoints: { photos: true, concept: true } }));
      if (url.endsWith('/pick')) return new Response(JSON.stringify({ ok: true, message: 'picked' }));
      return new Response('null');
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AgentGuardProvider><LeadsPage /></AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
    const table = await screen.findByRole('table');
    expect(calls.some((c) => c.includes('/api/leads?tier=A%2CB'))).toBe(true);
    expect(within(table).getByText('Alpha Barbers')).toBeInTheDocument();
    expect(within(within(table).getByText('Beta Cuts').closest('tr')!).getByRole('button', { name: 'Unpick' })).toBeInTheDocument();
    expect(within(table).queryByText(/picked automatically/i)).not.toBeInTheDocument();
    const row = within(table).getByText('Alpha Barbers').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Pick' }));
    expect(calls).toContain('POST /api/leads/a/pick');
    expect(await screen.findByText('Picked Alpha Barbers')).toBeInTheDocument();
  });
});
