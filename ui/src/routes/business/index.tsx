import { ArrowLeft, ExternalLink, MapPin } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import type { BuildDetail, LeadDetail } from '../../../../src/ui/api-types';
import { useBuild, useLead } from '../../api';
import { ButtonA } from '../../components/ui/button';
import { Chip, TierMark } from '../../components/ui/chip';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/states';
import { LinkTabs } from '../../components/ui/tabs';
import { stageOf } from '../../lib/format';
import { bizPath } from '../../lib/links';
import type { BusinessCtx } from './context';

/** The four tabs, in the order a business moves through them. A tab appears once it has something in it. */
export type Tab = 'overview' | 'build' | 'review' | 'send';
export function tabsFor(lead: LeadDetail, build: BuildDetail | undefined): Tab[] {
  const tabs: Tab[] = ['overview'];
  if (!build) return tabs;
  tabs.push('build');
  if (build.previewUrl || build.pages.length || ['preview_ready', 'approved', 'live'].includes(build.state)) tabs.push('review');
  if (build.delivery || build.state === 'approved' || ['contacted', 'followup_1', 'followup_2', 'replied', 'won'].includes(lead.status)) tabs.push('send');
  return tabs;
}
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', build: 'Build', review: 'Review', send: 'Send' };

/** Which tab is waiting on you, if any: it gets a dot. */
function waitingTab(b: BuildDetail | undefined): Tab | null {
  if (!b) return null;
  if (b.state === 'awaiting_photos' || b.state === 'awaiting_concept' || b.state === 'failed') return 'build';
  if (b.state === 'preview_ready') return 'review';
  if (b.state === 'approved' && !b.delivery?.sentAt) return 'send';
  return null;
}

export function BusinessPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const lead = useLead(slug);
  const hasBuild = !!lead.data?.build;
  const build = useBuild(slug, hasBuild);

  if (lead.error) return <div className="p-6"><ErrorState error={lead.error} what="business" /></div>;
  if (!lead.data) return <div className="mx-auto max-w-[1180px] p-6"><Skeleton className="h-8 w-72" /><Skeleton className="mt-6 h-64" /></div>;
  const l = lead.data;
  const b = hasBuild ? build.data : undefined;
  const base = `/b/${encodeURIComponent(slug)}`;
  const atRoot = location.pathname.replace(/\/$/, '') === base;
  if (atRoot && hasBuild && !b && !build.error) return <div className="mx-auto max-w-[1180px] p-6"><Skeleton className="h-8 w-72" /><Skeleton className="mt-6 h-64" /></div>;
  if (atRoot) return <Navigate to={l.nextAction ? bizPath(slug, l.nextAction.tab) : `${base}/overview`} replace />;
  const tabs = tabsFor(l, b);
  const stage = stageOf(l.status, b?.state ?? l.buildState, b?.activeJobId != null);
  const ctx: BusinessCtx = { slug, lead: l, build: b, buildLoading: hasBuild && build.isLoading };
  const waiting = waitingTab(b);

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border-soft">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-3 md:px-6">
          <Link to="/pipeline" className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"><ArrowLeft className="size-3" aria-hidden />Pipeline</Link>
          <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[30px] leading-tight font-light tracking-[-0.03em] text-fg md:text-[40px]">{l.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-fg-3">
                <Chip dot={stage.tone}>{stage.label}</Chip>
                <TierMark tier={l.tier} />
                <span>{l.categoryLabel}</span><span aria-hidden>·</span><span>{l.area}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {b?.previewUrl ? <ButtonA size="sm" variant="secondary" href={b.previewUrl}><ExternalLink className="size-3.5" aria-hidden />Open the new site</ButtonA> : null}
              {l.websiteUrl ? <ButtonA size="sm" variant="outline" href={l.websiteUrl}><ExternalLink className="size-3.5" aria-hidden />Their current site</ButtonA> : null}
              {l.mapsUrl ? <ButtonA size="sm" variant="outline" href={l.mapsUrl}><MapPin className="size-3.5" aria-hidden />Maps</ButtonA> : null}
            </div>
          </div>
          {tabs.length > 1 ? <div className="mt-3"><LinkTabs label="Business" tabs={tabs.map((t) => ({ to: `${base}/${t}`, label: TAB_LABEL[t], dot: waiting === t }))} /></div> : <div className="h-4" />}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-6"><Outlet context={ctx} /></div>
    </div>
  );
}
