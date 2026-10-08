import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Concept, ConceptSet } from '../../../../src/ui/api-types';
import { ConceptsTab } from '../business/concepts';
import type { BusinessCtx } from '../business/context';

const concept = (index: number, name: string): Concept => ({ index, name, idea: `Idea ${index}`, body: `## ${name}\n\nDetail`, palette: ['#112233', '#aabbcc'], score: 3 + index / 2, shots: { mobile: `/files/site/x/acta/concepts/concept-${index}-mobile.png` } });
const base: ConceptSet = { concepts: [concept(1, 'The window sign'), concept(2, 'The ledger'), concept(3, 'The chair')], waiting: true, chosen: null, agentPick: 2, mdUrl: '/files/site/x/acta/concepts.md' };

function renderTab(set: ConceptSet) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true, message: 'Building concept', job: null }), { status: 200 });
    return new Response(JSON.stringify(url.includes('/concepts') ? set : {}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const ctx = { slug: 'x', lead: {} as BusinessCtx['lead'], build: undefined, buildLoading: false } satisfies BusinessCtx;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/b/x/concepts']}>
        <Routes><Route path="/b/:slug" element={<Outlet context={ctx} />}><Route path="concepts" element={<ConceptsTab />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('ConceptsTab', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('selects a concept and sends it with the note', async () => {
    const user = userEvent.setup();
    const fetchMock = renderTab(base);
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByText("Agent's pick")).toBeInTheDocument();
    const choose = screen.getByRole('button', { name: 'Choose this concept' });
    expect(choose).toBeDisabled();
    await user.click(radios[0]);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByRole('textbox'), 'warmer type');
    expect(screen.getByRole('textbox')).toHaveValue('warmer type');
    await user.click(choose);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/builds/x/concepts/choose');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ index: 2, note: 'warmer type' });
  });

  it('is read-only once a concept is chosen', async () => {
    renderTab({ ...base, waiting: false, chosen: { index: 3, name: 'The chair', note: 'keep it simple' } });
    expect(await screen.findByText('Chosen: The chair')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose this concept' })).toBeNull();
    expect(screen.getAllByRole('radio')[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('says when there are no concepts yet', async () => {
    renderTab({ ...base, concepts: [], agentPick: null });
    expect(await screen.findByText(/Concepts appear here once the agent writes them/)).toBeInTheDocument();
  });
});
