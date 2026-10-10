import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, BoardCard } from '../../../../src/ui/api-types';
import { AgentGuardProvider } from '../../components/agent-guard';
import { ToastProvider } from '../../components/ui/toast';
import { filterBoard, PipelinePage, WhatsWorking } from '../pipeline';

const card = (over: Partial<BoardCard>): BoardCard => ({
  slug: 'x', name: 'X', area: 'Moseley', categoryLabel: 'Barber', tier: 'A', score: 80, status: 'replied', buildState: 'approved',
  heroShotUrl: null, since: new Date().toISOString(), badge: null, moves: [], hook: 'No website and 210 reviews', rating: 4.8, reviews: 210, websiteStatus: 'none', phone: '07700 900000', previewUrl: null, stageLine: { text: 'Not built yet', tone: 'muted' },
  reach: { level: 'message', label: 'Can message', email: null, emailSource: null, emailUrl: null, emailAllowed: false, mobile: true, walkIn: true, socials: [], summary: 'Mobile, for WhatsApp after a call.', checkedAt: null, webSearchedAt: null }, ...over,
});
const board = (): Board => ({
  newLeads: 342,
  columns: {
    picked: [card({ slug: 'p1', name: 'Picked Barber', status: 'shortlisted', buildState: null, moves: ['building', 'closed'] })],
    building: [], preview: [],
    ready: [card({ slug: 'r1', name: 'Ready Cafe', status: 'preview_ready', moves: ['sent', 'closed'], categoryLabel: 'Cafe', area: 'Erdington' })],
    sent: [],
    replied: [card({ slug: 'rep1', name: 'Hair by Jo', moves: ['won', 'closed'] })],
    won: [], closed: [],
  },
});

let calls: { method: string; url: string; body: unknown }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/api/board/move')) return json({ ok: true, message: 'moved' });
    if (url.startsWith('/api/board')) return json(board());
    if (url.startsWith('/api/meta')) return json({ categories: [{ key: 'barber', label: 'Barber' }, { key: 'cafe', label: 'Cafe' }], areas: ['Moseley', 'Erdington'], senderMissing: [], checkpoints: { call: false, photos: true, concept: true } });
    if (url.startsWith('/api/usage')) return json(null);
    return json(null);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider><AgentGuardProvider>
      <MemoryRouter initialEntries={['/pipeline']}>
        <Routes>
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/b/:slug/send" element={<p>Composer page</p>} />
        </Routes>
      </MemoryRouter>
    </AgentGuardProvider></ToastProvider></QueryClientProvider>,
  );
}

describe('PipelinePage', () => {
  it('shows columns, counts and the new-leads link', async () => {
    renderBoard();
    expect((await screen.findAllByText('Hair by Jo')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '342 new leads' })).toHaveAttribute('href', '/leads');
    expect(screen.queryByText(/picked automatically/i)).not.toBeInTheDocument();
  });

  it('moves a card with the Move to menu', async () => {
    const user = userEvent.setup();
    renderBoard();
    const triggers = await screen.findAllByRole('button', { name: 'Move Hair by Jo to' });
    await user.click(triggers[triggers.length - 1]);
    await user.click(await screen.findByRole('menuitem', { name: 'Won' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/board/move')?.body).toEqual({ slug: 'rep1', to: 'won' }));
    expect(await screen.findByText('Hair by Jo moved to Won.')).toBeInTheDocument();
  });

  it('opens the composer instead of moving to Sent', async () => {
    const user = userEvent.setup();
    renderBoard();
    const triggers = await screen.findAllByRole('button', { name: 'Move Ready Cafe to' });
    await user.click(triggers[triggers.length - 1]);
    await user.click(await screen.findByRole('menuitem', { name: 'Sent' }));
    expect(await screen.findByText('Composer page')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/board/move')).toBe(false);
  });
});

describe('filterBoard', () => {
  it('filters by text, category, tier and area', () => {
    const label = (k: string) => ({ barber: 'Barber', cafe: 'Cafe' }[k] ?? k);
    const count = (b: Board) => Object.values(b.columns).flat().length;
    expect(count(filterBoard(board(), { q: 'jo', category: '', tier: '', area: '' }, label))).toBe(1);
    expect(count(filterBoard(board(), { q: '', category: 'cafe', tier: '', area: '' }, label))).toBe(1);
    expect(count(filterBoard(board(), { q: '', category: '', tier: 'A', area: 'Moseley' }, label))).toBe(2);
    expect(count(filterBoard(board(), { q: '', category: '', tier: 'B', area: '' }, label))).toBe(0);
  });
});

describe('WhatsWorking', () => {
  it('shows outcomes by trade, channel and hook, with rates', () => {
    render(<WhatsWorking s={{
      overall: { key: 'all', label: 'All pitches', pitched: 4, opened: 2, replied: 2, won: 1 },
      byTrade: [{ key: 'roofer', label: 'Roofer', pitched: 2, opened: 1, replied: 1, won: 0 }],
      byChannel: [{ key: 'email', label: 'Email', pitched: 4, opened: 2, replied: 2, won: 1 }],
      byHook: [{ key: 'down', label: 'Site down', pitched: 4, opened: 2, replied: 2, won: 1 }],
      opensTracked: false,
    }} />);
    expect(screen.getByText("What's working")).toBeInTheDocument();
    expect(screen.getByText('4 pitched · 2 opened · 2 replied · 1 won')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'By hook' })).toHaveTextContent('Site down');
    expect(screen.getByText(/Preview opens aren't counted/)).toBeInTheDocument();
  });
  it('renders nothing before the first pitch', () => {
    const { container } = render(<WhatsWorking s={{ overall: { key: 'all', label: 'All pitches', pitched: 0, opened: 0, replied: 0, won: 0 }, byTrade: [], byChannel: [], byHook: [], opensTracked: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
