import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Autopilot } from '../../../../src/ui/api-types';
import { AutopilotPill, autopilotTone } from '../autopilot';
import { ToastProvider } from '../ui/toast';

const status = (over: Partial<Autopilot> = {}): Autopilot => ({
  on: true, scheduled: true, reason: 'Building Aya Estates from the picked queue', buildsToday: 2, maxBuildsPerDay: 3, unreviewed: 1, maxUnreviewed: 3, queued: 5,
  usage: null, nextChore: { kind: 'leads', at: '2026-10-11T06:30:00.000Z' }, lastPick: null, notifyPush: false, ...over,
});

function renderPill(initial: Autopilot) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/autopilot' && init?.method === 'POST') current = { ...current, on: (JSON.parse(String(init.body)) as { on: boolean }).on, reason: 'Off. Builds you start still run' };
    return new Response(JSON.stringify(url.startsWith('/api/autopilot') ? current : null), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AutopilotPill /></ToastProvider></MemoryRouter></QueryClientProvider>);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('AutopilotPill', () => {
  it('tones: grey off, amber while waiting on usage or review, green otherwise', () => {
    expect(autopilotTone(status({ on: false }))).toBe('muted');
    expect(autopilotTone(status({ usage: 'the session is at 79%' }))).toBe('warn');
    expect(autopilotTone(status({ unreviewed: 3 }))).toBe('warn');
    expect(autopilotTone(status())).toBe('ok');
  });

  it('shows the state, opens to the reason and the switch, and turns it off with one click', async () => {
    const fetchMock = renderPill(status());
    const pill = await screen.findByRole('button', { name: /Autopilot on/ });
    fireEvent.click(pill);
    expect(screen.getByRole('dialog', { name: 'Autopilot' })).toHaveTextContent('Building Aya Estates from the picked queue');
    expect(screen.getByRole('dialog')).toHaveTextContent('Builds today 2/3 · previews waiting 1/3 · picked queue 5 · next lead search');
    const sw = screen.getByRole('switch', { name: 'Turn off' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/autopilot', expect.objectContaining({ method: 'POST', body: '{"on":false}' })));
    expect(await screen.findByRole('switch', { name: 'Turn on' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: /Autopilot off/ })).toBeInTheDocument();
    expect(await screen.findByText(/Autopilot is off/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderPill(status({ on: false, reason: 'Off. Builds you start still run' }));
    fireEvent.click(await screen.findByRole('button', { name: /Autopilot off/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/stops at the Claude usage limit/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
