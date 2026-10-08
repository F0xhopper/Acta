/** Typed client for the Acta UI server. One fetch helper, one react-query hook per endpoint. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Board, BoardColumn, BuildDetail, ConceptSet, Delivery, Device, FeedbackItem, Job, LeadDetail, LeadOutreach, LeadSummary, Meta, NewFeedback, Ok, OutreachMessage, OutreachStatus,
  PhotoChoice, PhotoSet, PipelineStatus, Round, Summary, Usage,
} from '../../src/ui/api-types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
  /** The server isn't there at all (not running, or the dev proxy can't reach it). */
  get unreachable() { return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError(0, (e as Error).message || 'network error');
  }
  const text = await res.text();
  if (!res.ok) {
    const down = res.status >= 502 || (res.status === 500 && (!text || /ECONNREFUSED|proxy/i.test(text)));
    let msg = text; let code: string | undefined;
    try { const j = JSON.parse(text) as { error?: string; message?: string; code?: string }; msg = j.error ?? j.message ?? text; code = j.code; } catch { /* plain text */ }
    throw new ApiError(down ? 0 : res.status, msg || `${res.status} ${res.statusText}`, code);
  }
  return (text ? JSON.parse(text) : null) as T;
}
export const api = {
  get: <T,>(p: string) => call<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T,>(p: string, b: unknown) => call<T>('PUT', p, b),
  patch: <T,>(p: string, b: unknown) => call<T>('PATCH', p, b),
  del: <T,>(p: string) => call<T>('DELETE', p),
};

const enc = encodeURIComponent;
export interface LeadFilters { tier?: string[]; category?: string; status?: string; area?: string; q?: string }
const leadsQs = (f: LeadFilters) => {
  const p = new URLSearchParams();
  if (f.tier?.length) p.set('tier', f.tier.join(','));
  if (f.category) p.set('category', f.category);
  if (f.status) p.set('status', f.status);
  if (f.area) p.set('area', f.area);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
};

const SLOW = 15_000;
const FAST = 2_000;
const isLive = (s: string) => s === 'queued' || s === 'running';
const BUSY_STATES = new Set(['picked', 'gathered', 'repo_ready', 'researched', 'built', 'gated', 'pushed', 'deployed', 'revising']);
const buildBusy = (b: { state: string; activeJobId: number | null } | undefined) => !!b && (b.activeJobId !== null || BUSY_STATES.has(b.state));

export const useMeta = () => useQuery<Meta, ApiError>({ queryKey: ['meta'], queryFn: () => api.get('/api/meta'), staleTime: 60_000, refetchInterval: SLOW, retry: false });
export const useUsage = () => useQuery<Usage | null, ApiError>({ queryKey: ['usage'], queryFn: () => api.get('/api/usage'), refetchInterval: 30_000 });
export const useSummary = () => useQuery<Summary, ApiError>({ queryKey: ['summary'], queryFn: () => api.get('/api/summary'), refetchInterval: (q) => (q.state.data?.running.length ? FAST : SLOW) });
export const useBoard = () => useQuery<Board, ApiError>({ queryKey: ['board'], queryFn: () => api.get('/api/board'), refetchInterval: (q) => (q.state.data?.columns.building.length ? 5_000 : SLOW) });
export const useLeads = (f: LeadFilters) => useQuery<LeadSummary[], ApiError>({ queryKey: ['leads', f], queryFn: () => api.get(`/api/leads${leadsQs(f)}`), refetchInterval: SLOW, placeholderData: (prev) => prev });
export const useLead = (slug: string | undefined) =>
  useQuery<LeadDetail, ApiError>({ queryKey: ['lead', slug], queryFn: () => api.get(`/api/leads/${enc(slug!)}`), enabled: !!slug, refetchInterval: (q) => (buildBusy(q.state.data?.build ?? undefined) ? FAST * 2 : SLOW) });
export const useBuild = (slug: string | undefined, enabled = true) =>
  useQuery<BuildDetail, ApiError>({ queryKey: ['build', slug], queryFn: () => api.get(`/api/builds/${enc(slug!)}`), enabled: !!slug && enabled, retry: (n, e) => e.status !== 404 && n < 2, refetchInterval: (q) => (buildBusy(q.state.data) || q.state.data?.shotsTaking ? FAST : SLOW) });
export const useRounds = (slug: string | undefined) => useQuery<Round[], ApiError>({ queryKey: ['rounds', slug], queryFn: () => api.get(`/api/builds/${enc(slug!)}/rounds`), enabled: !!slug, refetchInterval: SLOW });
export const usePhotos = (slug: string | undefined) => useQuery<PhotoSet, ApiError>({ queryKey: ['photos', slug], queryFn: () => api.get(`/api/builds/${enc(slug!)}/photos`), enabled: !!slug, refetchInterval: SLOW * 2 });
export const useConcepts = (slug: string | undefined) => useQuery<ConceptSet, ApiError>({ queryKey: ['concepts', slug], queryFn: () => api.get(`/api/builds/${enc(slug!)}/concepts`), enabled: !!slug, refetchInterval: SLOW });
export const useJobs = (limit = 100) => useQuery<Job[], ApiError>({ queryKey: ['jobs', limit], queryFn: () => api.get(`/api/jobs?limit=${limit}`), refetchInterval: (q) => (q.state.data?.some((j) => isLive(j.status)) ? FAST : SLOW) });
export const useJob = (id: number | undefined) =>
  useQuery<Job, ApiError>({ queryKey: ['job', id], queryFn: () => api.get(`/api/jobs/${id}`), enabled: id !== undefined, refetchInterval: (q) => (q.state.data && isLive(q.state.data.status) ? FAST : SLOW) });
export const useDelivery = (slug: string | undefined, enabled = true) =>
  useQuery<Delivery | null, ApiError>({
    queryKey: ['delivery', slug], enabled: !!slug && enabled, refetchInterval: SLOW * 2,
    queryFn: async () => { try { return await api.get<Delivery>(`/api/deliveries/${enc(slug!)}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } },
  });

export const useOutreach = () => useQuery<OutreachStatus, ApiError>({ queryKey: ['outreach'], queryFn: () => api.get('/api/outreach'), refetchInterval: 60_000 });
export const useLeadOutreach = (slug: string | undefined) => useQuery<LeadOutreach, ApiError>({ queryKey: ['lead-outreach', slug], queryFn: () => api.get(`/api/leads/${enc(slug!)}/outreach`), enabled: !!slug, refetchInterval: SLOW * 2 });

/** Mutations refresh everything they could have touched; the server is local and cheap. */
function useAction<TVars, TOut>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation<TOut, ApiError, TVars>({ mutationFn: fn, onSettled: () => { void qc.invalidateQueries(); } });
}
type Override = { override?: boolean };
export type JobOk = Ok & { job?: Job | null };

export const usePick = () => useAction((v: { slug: string; pick: boolean }) => api.post<Ok>(`/api/leads/${enc(v.slug)}/${v.pick ? 'pick' : 'unpick'}`));
export const useSetStatus = () => useAction((v: { slug: string; status: PipelineStatus; note?: string }) => api.post<Ok>(`/api/leads/${enc(v.slug)}/status`, { status: v.status, note: v.note }));
export const useStartBuild = () => useAction((v: { slug: string; force?: boolean; from?: string } & Override) => api.post<Job>(`/api/builds/${enc(v.slug)}/start`, { force: v.force, from: v.from, override: v.override }));
export const useApprove = () => useAction((slug: string) => api.post<Ok>(`/api/builds/${enc(slug)}/approve`));
export const useTeardown = () => useAction((slug: string) => api.post<Job>(`/api/builds/${enc(slug)}/teardown`));
export const useRefreshShots = () => useAction((slug: string) => api.post<Job>(`/api/builds/${enc(slug)}/shots`));
export const useAddFeedback = () => useAction((v: { slug: string; item: NewFeedback }) => api.post<FeedbackItem>(`/api/builds/${enc(v.slug)}/feedback`, v.item));
export const useUpdateFeedback = () => useAction((v: { id: number; patch: Partial<Pick<FeedbackItem, 'text' | 'x' | 'y' | 'rule' | 'resolved'>> }) => api.patch<FeedbackItem>(`/api/feedback/${v.id}`, v.patch));
export const useDeleteFeedback = () => useAction((id: number) => api.del<{ ok: true }>(`/api/feedback/${id}`));
export const useSendFeedback = () => useAction((v: { slug: string } & Override) => api.post<Job>(`/api/builds/${enc(v.slug)}/feedback/send`, { override: v.override }));
export const useSavePhotos = () => useAction((v: { slug: string; choices: PhotoChoice[]; resume: boolean } & Override) => api.put<JobOk>(`/api/builds/${enc(v.slug)}/photos`, { choices: v.choices, resume: v.resume, override: v.override }));
export const useSkipPhotos = () => useAction((v: { slug: string } & Override) => api.post<JobOk>(`/api/builds/${enc(v.slug)}/photos/skip`, { override: v.override }));
export const useChooseConcept = () => useAction((v: { slug: string; index: number | null; note?: string } & Override) => api.post<JobOk>(`/api/builds/${enc(v.slug)}/concepts/choose`, { index: v.index, note: v.note, override: v.override }));
export const useRegenerateConcepts = () => useAction((v: { slug: string; note: string } & Override) => api.post<Job>(`/api/builds/${enc(v.slug)}/concepts/regenerate`, { note: v.note, override: v.override }));
export const useSearch = () => useAction((query: string) => api.post<Job>('/api/search', { query }));
export const useCancelJob = () => useAction((id: number) => api.post<Job>(`/api/jobs/${id}/cancel`));
export const useGenerateDelivery = () => useAction((slug: string) => api.post<Delivery>(`/api/deliveries/${enc(slug)}`));
export const useSaveDelivery = () => useAction((v: { slug: string; patch: Partial<Pick<Delivery, 'subject' | 'body' | 'whatsapp'>> }) => api.put<Delivery>(`/api/deliveries/${enc(v.slug)}`, v.patch));
export const useMarkSent = () => useAction((v: { slug: string; channel: string }) => api.post<Ok>(`/api/deliveries/${enc(v.slug)}/sent`, { channel: v.channel }));
export const useUnsend = () => useAction((slug: string) => api.post<Ok>(`/api/deliveries/${enc(slug)}/unsent`));
export const useMoveCard = () => useAction((v: { slug: string; to: BoardColumn; note?: string } & Override) => api.post<JobOk>('/api/board/move', v));

export type { Device };
export type SentOk = Ok & { sent: OutreachMessage };
export const useSendPitch = () => useAction((v: { slug: string; override?: boolean }) => api.post<SentOk>(`/api/deliveries/${enc(v.slug)}/send`, { override: v.override }));
export const useFollowUp = () => useAction((v: { slug: string; mode: 'send' | 'logged'; subject?: string; body?: string; channel?: string; override?: boolean }) => api.post<SentOk>(`/api/leads/${enc(v.slug)}/followup`, v));
export const useCheckReplies = () => useAction(() => api.post<{ checked: number; matched: { slug: string; name: string; kind: string }[]; error: string | null }>('/api/outreach/replies'));
export const useRecheckDns = () => useAction(() => api.post<OutreachStatus>('/api/outreach/dns'));
