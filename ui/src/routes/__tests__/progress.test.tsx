import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildDetail, LeadDetail } from '../../../../src/ui/api-types';
import { ToastProvider } from '../../components/ui/toast';
import type { BusinessCtx } from '../business/context';
import { ProgressTab } from '../business/progress';

const build: BuildDetail = {
  slug: 'oslo', name: "Oslo's Barbers", state: 'failed', failedStep: 'gate', lastError: 'gates failed: contrast', previewUrl: null, repoUrl: null, evidenceUrl: null, heroShotUrl: null,
  agentMinutes: 42, agentTurns: 120, agentCostUsd: 3.5, updatedAt: '2026-10-07T10:00:00Z', reviewedAt: null, reviewNote: null, activeJobId: null, rounds: 0,
  rail: [
    { key: 'gather', label: 'Gather', checkpoint: false, status: 'done' },
    { key: 'photos', label: 'Photos', checkpoint: true, status: 'done' },
    { key: 'gate', label: 'Gates', checkpoint: false, status: 'failed' },
    { key: 'deploy', label: 'Deploy', checkpoint: false, status: 'todo' },
  ],
  events: [{ at: '2026-10-07T09:59:00Z', step: 'gate', level: 'error', message: 'contrast failed' }],
  gates: [{ name: 'contrast', pass: false, value: 3.1, threshold: '>= 4.5' }, { name: 'lighthouse', pass: true, value: 95, threshold: '>= 90' }],
  pages: [], docs: [], agent: { phases: [{ key: 'research', label: 'Research', done: true }, { key: 'plan', label: 'Plan', done: false }], current: 'Plan', lastCommit: { message: 'feat: hero', at: '2026-10-07T09:50:00Z' } },
  feedback: [], delivery: null, maxMinutes: 240, maxTurns: 400, startedAt: null, shotsTaking: false,
};

function mount(b: BuildDetail | undefined) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('null')));
  vi.stubGlobal('EventSource', class { onmessage = null; onerror = null; addEventListener() {} close() {} });
  const ctx = { slug: 'oslo', lead: { name: "Oslo's Barbers" } as LeadDetail, build: b, buildLoading: false } satisfies BusinessCtx;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={['/b/oslo/progress']}>
        <Routes><Route path="/b/:slug" element={<Outlet context={ctx} />}><Route path="progress" element={<ProgressTab />} /></Route></Routes>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}

describe('ProgressTab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers a build when there is none', () => {
    mount(undefined);
    expect(screen.getByRole('button', { name: 'Build the site' })).toBeInTheDocument();
  });

  it('shows a failed build with its gates and retry actions', () => {
    mount(build);
    expect(screen.getByText('Build failed at gate')).toBeInTheDocument();
    expect(screen.getByText('gates failed: contrast')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Gate results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry from gate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Build steps' })).toBeInTheDocument();
  });

  it('points to the photos tab while waiting for photos', () => {
    mount({ ...build, state: 'awaiting_photos', failedStep: null, lastError: null });
    expect(screen.getByText('The build is waiting for you to sort the photos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sort photos/ })).toHaveAttribute('href', '/b/oslo/build?view=photos');
  });
});
