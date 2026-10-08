import type { BoardColumn, BuildState, JobKind, JobStatus, PipelineStatus } from '../../../src/ui/api-types';
import type { DotTone } from '../components/ui/chip';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 60) return `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "5 days" style age, for "in this column for". */
export function age(iso: string | null | undefined): string {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'now';
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
export function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function duration(start: string | null | undefined, end?: string | null): string {
  if (!start) return '—';
  const s = Math.max(0, Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
export const humanize = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const SITE_STATUS_LABEL: Record<string, string> = {
  none: 'No website', facebook_only: 'Social only', directory_only: 'Directory only', platform_only: 'Booking page only', down: 'Site down', broken: 'Site broken', live: 'Has a site',
};
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', phone: 'Phone', walk_in: 'Walk in', dm: 'DM', whatsapp: 'WhatsApp' };
export const STATUS_LABEL: Record<PipelineStatus, string> = {
  new: 'New', shortlisted: 'Picked', building: 'Building', preview_ready: 'To review', contacted: 'Sent', followup_1: 'Followed up', followup_2: 'Followed up twice',
  replied: 'Replied', won: 'Won', lost: 'Lost', do_not_contact: 'Do not contact',
};
export const STATUS_TONE: Record<PipelineStatus, DotTone> = {
  new: 'muted', shortlisted: 'info', building: 'live', preview_ready: 'warn', contacted: 'info', followup_1: 'info', followup_2: 'info', replied: 'warn', won: 'ok', lost: 'muted', do_not_contact: 'muted',
};
export const BUILD_LABEL: Record<BuildState, string> = {
  picked: 'Queued', gathered: 'Building', repo_ready: 'Building', awaiting_photos: 'Needs photos', researched: 'Building', awaiting_concept: 'Needs a concept',
  built: 'Checking', gated: 'Deploying', pushed: 'Deploying', deployed: 'Deploying', preview_ready: 'To review', approved: 'Ready to send', revising: 'Making changes', failed: 'Build failed', torn_down: 'Taken down', live: 'Live',
};
export function buildTone(s: BuildState | null | undefined, active = false): DotTone {
  if (!s) return 'muted';
  if (s === 'failed') return 'bad';
  if (s === 'awaiting_photos' || s === 'awaiting_concept' || s === 'preview_ready') return 'warn';
  if (s === 'approved' || s === 'live') return 'ok';
  if (s === 'torn_down') return 'muted';
  return active ? 'live' : 'info';
}
export const COLUMN_LABEL: Record<BoardColumn, string> = { picked: 'Picked', building: 'Building', preview: 'To review', ready: 'Ready to send', sent: 'Sent', replied: 'Replied', won: 'Won', closed: 'Closed' };
export const JOB_LABEL: Record<JobKind, string> = { build: 'Build', revise: 'Revise', search: 'Search', deploy: 'Deploy', gather: 'Gather', teardown: 'Tear down', shots: 'Screenshots', concepts: 'Concepts' };
export const JOB_TONE: Record<JobStatus, DotTone> = { queued: 'muted', running: 'live', done: 'ok', failed: 'bad', cancelled: 'muted' };
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
export const AGENT_KINDS: JobKind[] = ['build', 'revise', 'concepts'];

/** UK mobile in display or E.164 form -> digits for wa.me, else null. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^\d+]/g, '');
  if (/^\+447\d{9}$/.test(d)) return d.slice(1);
  if (/^07\d{9}$/.test(d)) return `44${d.slice(1)}`;
  return null;
}
export const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

/**
 * The one stage word for a business, used in every chip. It combines the pipeline status with the build,
 * because "building" can mean waiting for you, failed, or making changes.
 */
export function stageOf(status: PipelineStatus, build: BuildState | null | undefined, active = false): { label: string; tone: DotTone } {
  if (status === 'won' || status === 'lost' || status === 'do_not_contact' || status === 'replied' || status === 'contacted' || status === 'followup_1' || status === 'followup_2' || status === 'new')
    return { label: STATUS_LABEL[status], tone: STATUS_TONE[status] };
  if (build === 'failed') return { label: 'Build failed', tone: 'bad' };
  if (build === 'awaiting_photos') return { label: 'Needs photos', tone: 'warn' };
  if (build === 'awaiting_concept') return { label: 'Needs a concept', tone: 'warn' };
  if (build === 'revising') return { label: 'Making changes', tone: active ? 'live' : 'info' };
  if (build === 'approved') return { label: 'Ready to send', tone: 'warn' };
  if (build === 'preview_ready' || status === 'preview_ready') return { label: 'To review', tone: 'warn' };
  if (build && build !== 'picked' && build !== 'torn_down') return { label: 'Building', tone: active ? 'live' : 'info' };
  return { label: STATUS_LABEL[status], tone: STATUS_TONE[status] };
}
