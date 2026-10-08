import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, PhotoSet } from '../../../../src/ui/api-types';
import { PhotosTab } from '../business/photos';
import { counts, initialSort, setChoice, sortRemaining, toChoices } from '../business/photos-state';
import type { BusinessCtx } from '../business/context';

const photo = (n: number, choice: Photo['choice'] = null): Photo => ({ path: `public/brand/photos/${n}.jpg`, url: `/files/site/x/public/brand/photos/${n}.jpg`, source: 'google', width: 1200, height: 800, alt: null, choice, reason: null });
const photos = [photo(1, 'hero'), photo(2), photo(3), photo(4)];

describe('photo sort state', () => {
  it('keeps one hero: a new hero demotes the old one to keep', () => {
    let s = initialSort(photos);
    expect(s.choices[photos[0].path]).toBe('hero');
    s = setChoice(s, photos[2].path, 'hero');
    expect(s.choices[photos[0].path]).toBe('keep');
    expect(s.choices[photos[2].path]).toBe('hero');
    expect(Object.values(s.choices).filter((c) => c === 'hero')).toHaveLength(1);
  });
  it('clears a choice when picked twice, and sends unsorted photos as keep', () => {
    let s = initialSort(photos);
    s = setChoice(s, photos[1].path, 'drop');
    s = setChoice(s, photos[1].path, 'drop');
    expect(s.choices[photos[1].path]).toBeNull();
    expect(toChoices(s, photos).map((c) => c.choice)).toEqual(['hero', 'keep', 'keep', 'keep']);
  });
  it('sorts the remainder in one go', () => {
    const s = sortRemaining(initialSort(photos), photos, 'drop');
    expect(counts(s, photos)).toEqual({ kept: 1, dropped: 3, unsorted: 0, hero: 1 });
  });
});

function renderTab(set: PhotoSet) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/photos') ? set : {}), { status: 200 })));
  const ctx = { slug: 'x', lead: {} as BusinessCtx['lead'], build: undefined, buildLoading: false } satisfies BusinessCtx;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/b/x/photos']}>
        <Routes><Route path="/b/:slug" element={<Outlet context={ctx} />}><Route path="photos" element={<PhotosTab />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PhotosTab', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('decides with K, D and H on a focused tile, with one hero', async () => {
    const user = userEvent.setup();
    renderTab({ photos, waiting: true, curated: false, reasons: ['doorstep', 'clutter'], dropStats: [{ reason: 'doorstep', count: 5 }] });
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(4);
    items[1].focus();
    await user.keyboard('h');
    const pressed = (i: number, label: string) => within(screen.getAllByRole('listitem')[i]).getByRole('button', { name: label }).getAttribute('aria-pressed');
    expect(pressed(1, 'Hero')).toBe('true');
    expect(pressed(0, 'Hero')).toBe('false');
    expect(pressed(0, 'Keep')).toBe('true');
    items[2].focus();
    await user.keyboard('d');
    expect(pressed(2, 'Drop')).toBe('true');
    expect(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: 'doorstep' })).toBeInTheDocument();
    items[3].focus();
    await user.keyboard('k');
    expect(pressed(3, 'Keep')).toBe('true');
    expect(screen.getByText(/Across all sites you've dropped: doorstep 5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue build' })).toBeInTheDocument();
  });

  it('moves focus with the arrow keys', async () => {
    const user = userEvent.setup();
    renderTab({ photos, waiting: false, curated: true, reasons: [], dropStats: [] });
    const items = await screen.findAllByRole('listitem');
    items[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getAllByRole('listitem')[1]);
    expect(screen.getByRole('button', { name: 'Save choices' })).toBeInTheDocument();
    expect(screen.getByText(/Fewer than six photos are kept/)).toBeInTheDocument();
  });
});
