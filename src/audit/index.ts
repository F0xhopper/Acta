import { loadScoring } from '../config.js';
import { bumpRun, leadsNeedingAudit, markChains, recentAuditForDomain, saveAudit } from '../db/queries.js';
import type { AuditRow, LeadRow, WebsiteStatus } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { hostOf } from '../util/http.js';
import { keyedLock, pLimit } from '../util/limit.js';
import { log } from '../util/log.js';
import { classifyFetch, classifyUrl, looksParked } from './classify.js';
import { fetchHomepage, type FetchResult } from './fetch.js';
import { runHtmlChecks, type HtmlChecks } from './html-checks.js';
import { runPsi } from './psi.js';
import { closeBrowser, renderLooksReal, renderSite, type RenderResult } from './screenshot.js';

export interface AuditOpts { query?: string; slug?: string; force?: boolean; psi?: boolean; screenshots?: boolean; runId?: number; dryRun?: boolean }
export interface AuditDeps { fetchHomepage: typeof fetchHomepage; runPsi: typeof runPsi; renderSite: typeof renderSite }

const b = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0);
/** DNS failures are definitive. Everything else deserves a second look in a real browser. */
const DNS_DEAD = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL']);

function emptyAudit(lead: LeadRow, status: WebsiteStatus, runId?: number): AuditRow {
  return {
    lead_id: lead.id, audited_at: isoNow(), run_id: runId ?? null, website_status: status,
    input_url: lead.website_url, final_url: null, final_domain: null, http_status: null, tls_error: null, redirect_count: null, ttfb_ms: null,
    https_ok: null, http_redirects_to_https: null, has_viewport: null, title: null, title_len: null, meta_desc_len: null, h1_count: null,
    builder: null, free_tier_host: null, copyright_year: null, phone_on_page: null, phone_matches_listing: null, has_local_schema: null, ltd_hint: null,
    lh_perf: null, lh_seo: null, lh_a11y: null, lh_bp: null, lh_error: null, lh_json_path: null, screenshot_mobile: null, screenshot_desktop: null, error: null,
    listing_link_broken: null, rendered_rescue: null, site_description: null,
  };
}

function applyFetch(audit: AuditRow, f: FetchResult, fallbackHost: string | null) {
  audit.final_url = f.finalUrl;
  audit.final_domain = f.finalDomain ?? fallbackHost;
  audit.http_status = f.httpStatus;
  audit.tls_error = f.tlsError;
  audit.redirect_count = f.redirectCount;
  audit.ttfb_ms = f.ttfbMs;
  audit.https_ok = b(f.httpsOk);
  audit.http_redirects_to_https = b(f.httpRedirectsToHttps);
  audit.error = f.error;
}

const statusOf = (f: FetchResult, scoring: ReturnType<typeof loadScoring>) =>
  classifyFetch({ httpStatus: f.httpStatus, error: f.error, tlsError: f.tlsError, redirectLoop: f.redirectLoop, body: f.body, contentType: f.contentType }, scoring);

/** Static checks see headers and server HTML. Rendered checks see what JavaScript builders inject. Trust either for positives. */
export function mergeChecks(s: HtmlChecks | null, r: HtmlChecks | null, listingPhone: string | null): HtmlChecks | null {
  if (!s) return r;
  if (!r) return s;
  const phones = [...new Set([...s.phonesOnPage, ...r.phonesOnPage])];
  return {
    hasViewport: s.hasViewport || r.hasViewport,
    title: r.title ?? s.title,
    titleLen: Math.max(s.titleLen, r.titleLen),
    metaDescLen: Math.max(s.metaDescLen, r.metaDescLen),
    h1Count: Math.max(s.h1Count, r.h1Count),
    builder: s.builder ?? r.builder,
    freeTierHost: s.freeTierHost || r.freeTierHost,
    copyrightYear: Math.max(s.copyrightYear ?? 0, r.copyrightYear ?? 0) || null,
    phonesOnPage: phones,
    phoneMatchesListing: listingPhone && phones.length ? phones.includes(listingPhone) : null,
    hasLocalSchema: s.hasLocalSchema || r.hasLocalSchema,
    ltdHint: s.ltdHint || r.ltdHint,
    description: s.description ?? r.description,
  };
}

export async function auditLead(lead: LeadRow, opts: AuditOpts, deps: AuditDeps = { fetchHomepage, runPsi, renderSite }): Promise<AuditRow> {
  const scoring = loadScoring();
  const cls = classifyUrl(lead.website_url, scoring);
  const audit = emptyAudit(lead, cls.status === 'fetch' ? 'down' : cls.status, opts.runId);
  audit.final_domain = cls.host;
  if (cls.status !== 'fetch') return audit;

  audit.input_url = cls.url;
  let f = await deps.fetchHomepage(cls.url);
  applyFetch(audit, f, cls.host);

  // A redirect can land on Facebook or a directory; reclassify on the final URL.
  const finalCls = classifyUrl(f.finalUrl, scoring);
  if (finalCls.status !== 'fetch' && finalCls.status !== 'none') { audit.website_status = finalCls.status; return audit; }

  let status = statusOf(f, scoring);

  // Listing links to a dead inner page (e.g. /birmingham). If the homepage works, the site is live but the Google link is broken.
  if (status === 'broken' && (f.httpStatus === 404 || f.httpStatus === 410) && f.finalUrl) {
    const u = new URL(f.finalUrl);
    if (u.pathname !== '/' || u.search) {
      const root = await deps.fetchHomepage(`${u.protocol}//${u.host}/`);
      if (statusOf(root, scoring) === 'live') {
        f = root;
        applyFetch(audit, root, cls.host);
        status = 'live';
        audit.listing_link_broken = 1;
      }
    }
  }

  // Second opinion in a real phone browser. Also produces the screenshots.
  let rendered: RenderResult | null = null;
  const dnsDead = !!f.error && DNS_DEAD.has(f.error);
  if (opts.screenshots !== false && !dnsDead) {
    rendered = await deps.renderSite(f.finalUrl ?? cls.url, lead.slug);
    audit.screenshot_mobile = rendered.mobile;
    audit.screenshot_desktop = rendered.desktop;
  }
  const renderedOk = renderLooksReal(rendered);

  // Bot protection (403/429), flaky 5xx and slow servers look dead to a script but fine to a person.
  const rescuable = (status === 'down' || status === 'broken') && !f.tlsError && !f.redirectLoop
    && ![404, 410].includes(f.httpStatus ?? 0) && !looksParked(f.body, scoring.parked_phrases);
  if (rescuable && renderedOk && rendered && !looksParked(rendered.html ?? '', scoring.parked_phrases)) {
    status = 'live';
    audit.rendered_rescue = 1;
    audit.final_url = rendered.finalUrl ?? audit.final_url;
    audit.final_domain = hostOf(audit.final_url ?? '') ?? audit.final_domain;
    audit.https_ok = audit.final_url?.startsWith('https://') ? 1 : audit.https_ok;
    audit.error = null;
  }
  audit.website_status = status;
  if (rendered?.error && status !== 'live') audit.error = audit.error ? `${audit.error}; ${rendered.error}` : rendered.error;

  if (status === 'live') {
    const staticChecks = f.body && f.httpStatus && f.httpStatus < 400 ? runHtmlChecks(f.body, f.headers, audit.final_domain, lead.phone_e164, scoring) : null;
    const renderChecks = renderedOk && rendered?.html ? runHtmlChecks(rendered.html, {}, audit.final_domain, lead.phone_e164, scoring) : null;
    const h = mergeChecks(staticChecks, renderChecks, lead.phone_e164);
    if (h) {
      audit.has_viewport = b(h.hasViewport);
      audit.title = h.title; audit.title_len = h.titleLen; audit.meta_desc_len = h.metaDescLen; audit.h1_count = h.h1Count;
      audit.builder = h.builder; audit.free_tier_host = b(h.freeTierHost); audit.copyright_year = h.copyrightYear;
      audit.phone_on_page = h.phonesOnPage[0] ?? null; audit.phone_matches_listing = b(h.phoneMatchesListing);
      audit.has_local_schema = b(h.hasLocalSchema); audit.ltd_hint = b(h.ltdHint);
      audit.site_description = h.description;
    }

    if (opts.psi !== false && audit.final_url) {
      const reuse = audit.final_domain ? recentAuditForDomain(audit.final_domain, scoring.thresholds.audit_fresh_days) : undefined;
      if (reuse) {
        audit.lh_perf = reuse.lh_perf; audit.lh_seo = reuse.lh_seo; audit.lh_a11y = reuse.lh_a11y; audit.lh_bp = reuse.lh_bp; audit.lh_json_path = reuse.lh_json_path;
      } else {
        const p = await deps.runPsi(audit.final_url, lead.slug, () => { if (opts.runId) bumpRun(opts.runId, 'psi_requests'); });
        audit.lh_perf = p.perf; audit.lh_seo = p.seo; audit.lh_a11y = p.a11y; audit.lh_bp = p.bp; audit.lh_json_path = p.jsonPath; audit.lh_error = p.error;
      }
    }
  }
  return audit;
}

export async function auditMany(opts: AuditOpts): Promise<{ audited: number; errors: number; byStatus: Record<string, number>; rescued: number }> {
  const scoring = loadScoring();
  const leads = leadsNeedingAudit({ query: opts.query, slug: opts.slug, force: opts.force, freshDays: scoring.thresholds.audit_fresh_days });
  const out = { audited: 0, errors: 0, byStatus: {} as Record<string, number>, rescued: 0 };
  if (opts.dryRun) { log.info(`[dry-run] would audit ${leads.length} leads`); return out; }
  log.info(`audit: ${leads.length} leads to audit`);
  const limit = pLimit(4);
  const perDomain = keyedLock();
  try {
    await Promise.all(leads.map((lead) => limit(async () => {
      let key = lead.slug;
      try { if (lead.website_url) key = new URL(lead.website_url.startsWith('http') ? lead.website_url : `http://${lead.website_url}`).hostname; } catch { /* keep slug */ }
      await perDomain(key, async () => {
        try {
          const a = await auditLead(lead, opts);
          saveAudit(a);
          out.audited++;
          if (a.rendered_rescue) out.rescued++;
          out.byStatus[a.website_status] = (out.byStatus[a.website_status] ?? 0) + 1;
          const notes = [a.lh_perf !== null ? `perf=${a.lh_perf}` : '', a.builder ? `builder=${a.builder}` : '', a.rendered_rescue ? 'rescued-by-browser' : '', a.listing_link_broken ? 'listing-link-404' : ''].filter(Boolean).join(' ');
          log.info(`audited ${lead.slug}: ${a.website_status}${notes ? ` ${notes}` : ''}`);
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
  if (out.rescued) log.info(`audit: ${out.rescued} sites looked dead to a script but loaded in a real browser, counted as live`);
  return out;
}

/** Backfill website descriptions for live sites audited before descriptions existed. One fast fetch per site, no browser, no Lighthouse. */
export async function backfillDescriptions(opts: { query?: string; force?: boolean } = {}): Promise<{ checked: number; found: number }> {
  const { getAudit, listLeads, setSiteDescription } = await import('../db/queries.js');
  const scoring = loadScoring();
  const leads = listLeads({ query: opts.query }).filter((l) => {
    const a = getAudit(l.id);
    return a && a.website_status === 'live' && a.final_url && (opts.force || !a.site_description);
  });
  const out = { checked: 0, found: 0 };
  const limit = pLimit(6);
  await Promise.all(leads.map((l) => limit(async () => {
    const a = getAudit(l.id)!;
    try {
      const f = await fetchHomepage(a.final_url!);
      if (f.httpStatus && f.httpStatus < 400 && f.body) {
        const d = runHtmlChecks(f.body, f.headers, a.final_domain, l.phone_e164, scoring).description;
        setSiteDescription(l.id, d);
        if (d) out.found++;
      }
    } catch { /* leave empty */ }
    out.checked++;
  })));
  log.info(`describe: ${out.found} of ${out.checked} live sites had a usable description`);
  return out;
}
