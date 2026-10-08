import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delivery, LeadDetail } from '../../../../src/ui/api-types';
import { ToastProvider } from '../../components/ui/toast';
import type { BusinessCtx } from '../business/context';
import { DeliverTab } from '../business/deliver';

const base: Delivery = {
  slug: 'oslo', createdAt: '2026-10-07T10:00:00Z', channel: 'email', emailAllowed: true, zipUrl: '/files/delivery/oslo/package.zip', sentAt: null, sentChannel: null,
  to: 'hi@oslo.test', phone: '07700 900123', phoneE164: '+447700900123', subject: 'A new site for Oslo', body: 'Hello', whatsapp: 'Hi there', script: 'Say hello',
  ownerQuestions: [], previewUrl: 'https://oslo.preview.test', compareUrl: null, ogUrl: null, emlUrl: '/files/delivery/oslo/email.eml',
  price: { build: 395, monthly: 25, currency: 'GBP' }, upsells: [], complianceNote: 'Limited company: cold email allowed with opt-out.', senderMissing: [],
};

function mount(d: Delivery | null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/deliveries/')) return d ? new Response(JSON.stringify(d)) : new Response(JSON.stringify({ error: 'none' }), { status: 404 });
    return new Response('null');
  }));
  const ctx = { slug: 'oslo', lead: { name: "Oslo's Barbers" } as LeadDetail, build: undefined, buildLoading: false } satisfies BusinessCtx;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={['/b/oslo/deliver']}>
        <Routes><Route path="/b/:slug" element={<Outlet context={ctx} />}><Route path="deliver" element={<DeliverTab />} /></Route></Routes>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}

describe('DeliverTab', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('offers to generate a package when there is none', async () => {
    mount(null);
    expect(await screen.findByRole('button', { name: 'Generate the package' })).toBeInTheDocument();
  });

  it('shows the compliance banner and lets a limited company be emailed', async () => {
    mount(base);
    expect(await screen.findByText('Cold email allowed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Mail/ })).toHaveAttribute('href', base.emlUrl);
    expect(screen.getByRole('button', { name: /Mark as sent/ })).toBeEnabled();
  });

  it('locks email for a sole trader', async () => {
    mount({ ...base, emailAllowed: false, channel: 'phone', complianceNote: 'Sole trader: no cold email.' });
    expect(await screen.findByText('No cold email')).toBeInTheDocument();
    expect(screen.getByText(/Sole trader: no cold email/)).toBeInTheDocument();
    screen.getByRole('radio', { name: 'Email' }).click();
    expect(await screen.findByText(/Email is locked for this business/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open in Mail/ })).not.toBeInTheDocument();
  });

  it('blocks sending until the sender details are filled in', async () => {
    mount({ ...base, senderMissing: ['name', 'postal_address'] });
    expect(await screen.findByText('Fill in your sender details before sending')).toBeInTheDocument();
    expect(screen.getByText(/name, postal_address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark as sent/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Open in Mail/ })).toBeDisabled();
  });
});
