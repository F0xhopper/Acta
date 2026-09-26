import { loadScoring } from '../config.js';
import { bumpRun, leadsNeedingAudit, markChains, recentAuditForDomain, saveAudit } from '../db/queries.js';
import type { AuditRow, LeadRow, WebsiteStatus } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { keyedLock, pLimit } from '../util/limit.js';
import { log } from '../util/log.js';
import { classifyFetch, classifyUrl } from './classify.js';
import { fetchHomepage } from './fetch.js';
import { runHtmlChecks } from './html-checks.js';
import { runPsi } from './psi.js';
import { closeBrowser, screenshotSite } from './screenshot.js';

export interface AuditOpts { query?: string; slug?: string; force?: boolean; psi?: boolean; screenshots?: boolean; runId?: number; dryRun?: boolean }

const b = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0);

function emptyAudit(lead: LeadRow, status: WebsiteStatus, runId?: number): AuditRow {
  return {
    lead_id: lead.id, audited_at: isoNow(), run_id: runId ?? null, website_status: status,
    input_url: lead.website_url, final_url: null, final_domain: null, http_status: null, tls_error: null, redirect_count: null, ttfb_ms: null,
    https_ok: null, http_redirects_to_https: null, has_viewport: null, title: null, title_len: null, meta_desc_len: null, h1_count: null,
    builder: null, free_tier_host: null, copyright_year: null, phone_on_page: null, phone_matches_listing: null, has_local_schema: null, ltd_hint: null,
    lh_perf: null, lh_seo: null, lh_a11y: null, lh_bp: null, lh_error: null, lh_json_path: null, screenshot_mobile: null, screenshot_desktop: null, error: null,
  };
}

export async function auditLead(lead: LeadRow, opts: AuditOpts, deps = { fetchHomepage, runPsi, screenshotSite }): Promise<AuditRow> {
  const scoring = loadScoring();
  const cls = classifyUrl(lead.website_url, scoring);
  const audit = emptyAudit(lead, cls.status === 'fetch' ? 'down' : cls.status, opts.runId);
  audit.final_domain = cls.host;
  if (cls.status !== 'fetch') return audit;

  const f = await deps.fetchHomepage(cls.url);
  audit.input_url = cls.url;
  audit.final_url = f.finalUrl;
  audit.final_domain = f.finalDomain ?? cls.host;
  audit.http_status = f.httpStatus;
  audit.tls_error = f.tlsError;
  audit.redirect_count = f.redirectCount;
  audit.ttfb_ms = f.ttfbMs;
  audit.https_ok = b(f.httpsOk);
  audit.http_redirects_to_https = b(f.httpRedirectsToHttps);
  audit.error = f.error;

  // A redirect can land on Facebook or a directory; reclassify on the final URL.
  const finalCls = classifyUrl(f.finalUrl, scoring);
  if (finalCls.status !== 'fetch' && finalCls.status !== 'none') { audit.website_status = finalCls.status; return audit; }

  audit.website_status = classifyFetch({ httpStatus: f.httpStatus, error: f.error, tlsError: f.tlsError, redirectLoop: f.redirectLoop, body: f.body, contentType: f.contentType }, scoring);

  if (audit.website_status === 'live') {
    const h = runHtmlChecks(f.body, f.headers, f.finalDomain, lead.phone_e164, scoring);
    audit.has_viewport = b(h.hasViewport);
    audit.title = h.title; audit.title_len = h.titleLen; audit.meta_desc_len = h.metaDescLen; audit.h1_count = h.h1Count;
    audit.builder = h.builder; audit.free_tier_host = b(h.freeTierHost); audit.copyright_year = h.copyrightYear;
    audit.phone_on_page = h.phonesOnPage[0] ?? null; audit.phone_matches_listing = b(h.phoneMatchesListing);
    audit.has_local_schema = b(h.hasLocalSchema); audit.ltd_hint = b(h.ltdHint);

    if (opts.psi !== false && f.finalUrl) {
      const reuse = f.finalDomain ? recentAuditForDomain(f.finalDomain, scoring.thresholds.audit_fresh_days) : undefined;
      if (reuse && reuse.lead_id !== lead.id) {
        audit.lh_perf = reuse.lh_perf; audit.lh_seo = reuse.lh_seo; audit.lh_a11y = reuse.lh_a11y; audit.lh_bp = reuse.lh_bp; audit.lh_json_path = reuse.lh_json_path;
      } else {
        const p = await deps.runPsi(f.finalUrl, lead.slug, () => { if (opts.runId) bumpRun(opts.runId, 'psi_requests'); });
        audit.lh_perf = p.perf; audit.lh_seo = p.seo; audit.lh_a11y = p.a11y; audit.lh_bp = p.bp; audit.lh_json_path = p.jsonPath; audit.lh_error = p.error;
      }
    }
  }

  if (opts.screenshots !== false && f.finalUrl && ['live', 'broken', 'platform_only'].includes(audit.website_status)) {
    const s = await deps.screenshotSite(f.finalUrl, lead.slug);
    audit.screenshot_mobile = s.mobile; audit.screenshot_desktop = s.desktop;
    if (s.error) audit.error = audit.error ? `${audit.error}; ${s.error}` : s.error;
  }
  return audit;
}

export async function auditMany(opts: AuditOpts): Promise<{ audited: number; errors: number; byStatus: Record<string, number> }> {
  const scoring = loadScoring();
  const leads = leadsNeedingAudit({ query: opts.query, slug: opts.slug, force: opts.force, freshDays: scoring.thresholds.audit_fresh_days });
  const out = { audited: 0, errors: 0, byStatus: {} as Record<string, number> };
  if (opts.dryRun) { log.info(`[dry-run] would audit ${leads.length} leads`); return out; }
  log.info(`audit: ${leads.length} leads to audit`);
  const limit = pLimit(4);
  const perDomain = keyedLock();
  try {
    await Promise.all(leads.map((lead) => limit(async () => {
      const key = lead.website_url ? (new URL(lead.website_url.startsWith('http') ? lead.website_url : `http://${lead.website_url}`).hostname) : lead.slug;
      await perDomain(key, async () => {
        try {
          const a = await auditLead(lead, opts);
          saveAudit(a);
          out.audited++;
          out.byStatus[a.website_status] = (out.byStatus[a.website_status] ?? 0) + 1;
          log.info(`audited ${lead.slug}: ${a.website_status}${a.lh_perf !== null ? ` perf=${a.lh_perf}` : ''}${a.builder ? ` builder=${a.builder}` : ''}`);
        } catch (e) {
          out.errors++;
          const a = emptyAudit(lead, 'down', opts.runId);
          a.error = `audit crashed: ${(e as Error).message.slice(0, 300)}`;
          saveAudit(a);
          log.warn(`audit failed for ${lead.slug}: ${(e as Error).message}`);
        }
      });
    })));
  } finally {
    await closeBrowser();
  }
  const chains = markChains();
  if (chains) log.info(`audit: flagged ${chains} more leads as chains by shared phone or domain`);
  return out;
}
