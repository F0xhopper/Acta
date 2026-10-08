import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Summary } from '../../../../src/ui/api-types';
import { AgentGuardProvider } from '../../components/agent-guard';
import { ToastProvider } from '../../components/ui/toast';
import { InboxPage, sortInbox } from '../inbox';

const summary = (over: Partial<Summary> = {}): Summary => ({
  needsYou: [
    { kind: 'review', slug: 'oslo', name: "Oslo's Barbers", detail: 'Round 2 ready', at: '2026-10-07T09:00:00Z', tab: 'review' },
    { kind: 'failed', slug: 'phit', name: 'PHIT Fitness', detail: 'Gates: contrast', at: '2026-10-07T10:00:00Z', tab: 'progress' },
  ],
  counts: { picked: 3, building: 1, preview: 1, ready: 0, sent: 6, replied: 0, won: 0, closed: 1, newLeads: 342 },
  running: [],
  recent: [{ at: '2026-10-07T09:30:00Z', slug: 'oslo', name: "Oslo's Barbers", message: 'revised', level: 'info' }],
  discovery: {
    lastRunAt: '2026-10-05T22:00:00Z', newThisWeek: { total: 40, tierAB: 6 },
    recentSearches: [{ query: 'florist in Moseley', lastRunAt: '2026-10-05T22:00:00Z', found: 12, tierAB: 3 }],
  },
  usage: null,
  ...over,
});

function renderWith(data: Summary) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/summary') ? data : null), { status: 200 })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AgentGuardProvider><InboxPage /></AgentGuardProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe('Inbox', () => {
  it('orders failed before review', () => {
    expect(sortInbox(summary().needsYou).map((i) => i.kind)).toEqual(['failed', 'review']);
  });

  it('shows each item with its action and the pipeline strip', async () => {
    renderWith(summary());
    expect(await screen.findByText('PHIT Fitness')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review site' })).toHaveAttribute('href', '/b/oslo/review');
    expect(screen.getByRole('link', { name: 'Open the pipeline board' })).toHaveTextContent('6Sent');
    expect(screen.queryByText('florist in Moseley')).not.toBeInTheDocument();
    expect(screen.queryByText(/picked automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next sweep|auto sweep/i)).not.toBeInTheDocument();
  });

  it('says nothing needs you when the list is empty', async () => {
    renderWith(summary({ needsYou: [] }));
    expect(await screen.findByText(/You're all caught up/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find businesses' })).toHaveAttribute('href', '/leads');
  });
});
