import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../../../src/ui/api-types';
import { ToastProvider } from '../../components/ui/toast';
import { ActivityPage, orderJobs } from '../activity';

const job = (over: Partial<Job>): Job => ({ id: 1, kind: 'build', target: 'oslo', label: 'Build Oslo', status: 'done', createdAt: '2026-10-07T08:00:00Z', startedAt: '2026-10-07T08:00:00Z', endedAt: '2026-10-07T09:00:00Z', exitCode: 0, lastLine: 'finished', ...over });

class FakeES { onmessage: ((e: MessageEvent) => void) | null = null; onerror: (() => void) | null = null; addEventListener() {} close() {} }
// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
afterEach(() => vi.unstubAllGlobals());

describe('Activity', () => {
  it('pins running and queued jobs to the top', () => {
    const ordered = orderJobs([job({ id: 1 }), job({ id: 3, status: 'queued' }), job({ id: 2, status: 'running' }), job({ id: 4, status: 'failed' })]);
    expect(ordered.map((j) => j.id)).toEqual([2, 3, 4, 1]);
  });

  it('shows a job log and asks before cancelling an agent run', async () => {
    const running = job({ id: 7, status: 'running', label: 'Build PHIT', endedAt: null, exitCode: null });
    vi.stubGlobal('EventSource', FakeES);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/jobs?')) return new Response(JSON.stringify([running, job({ id: 1 })]));
      if (url === '/api/jobs/7') return new Response(JSON.stringify(running));
      return new Response('null');
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/activity/7']}><ToastProvider><Routes><Route path="/activity/:jobId" element={<ActivityPage />} /></Routes></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Build PHIT' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancel this run?')).toBeInTheDocument();
  });
});
