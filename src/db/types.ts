export type WebsiteStatus = 'none' | 'facebook_only' | 'directory_only' | 'platform_only' | 'down' | 'broken' | 'live';
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';
export type Tier = 'A' | 'B' | 'C' | 'X';
export type Channel = 'email' | 'phone' | 'walk_in' | 'dm';
export const PIPELINE_STATUSES = ['new', 'shortlisted', 'building', 'preview_ready', 'contacted', 'followup_1', 'followup_2', 'replied', 'won', 'lost', 'do_not_contact'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export interface LeadRow {
  id: number;
  slug: string;
  place_id: string;
  name: string;
  category_key: string;
  category_raw: string;
  area: string;
  source_query: string;
  address: string | null;
  postcode: string | null;
  outward_code: string | null;
  lat: number | null;
  lng: number | null;
  phone_e164: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  primary_type: string | null;
  types_json: string | null;
  opening_hours_json: string | null;
  is_chain: number;
  raw_json: string | null;
  type_label: string | null;
  editorial_summary: string | null;
  reviews_json: string | null;
  last_review_at: string | null;
  discovered_at: string;
  last_seen_at: string;
}

export type LeadInput = Omit<LeadRow, 'id' | 'is_chain' | 'discovered_at' | 'last_seen_at'>;

export interface CompaniesHouseRow {
  lead_id: number;
  company_number: string | null;
  company_name: string | null;
  company_status: string | null;
  company_type: string | null;
  registered_postcode: string | null;
  sic_codes_json: string | null;
  match_confidence: MatchConfidence;
  ltd_hint_from_site: number;
  matched_at: string;
}

export interface AuditRow {
  lead_id: number;
  audited_at: string;
  run_id: number | null;
  website_status: WebsiteStatus;
  input_url: string | null;
  final_url: string | null;
  final_domain: string | null;
  http_status: number | null;
  tls_error: string | null;
  redirect_count: number | null;
  ttfb_ms: number | null;
  https_ok: number | null;
  http_redirects_to_https: number | null;
  has_viewport: number | null;
  title: string | null;
  title_len: number | null;
  meta_desc_len: number | null;
  h1_count: number | null;
  builder: string | null;
  free_tier_host: number | null;
  copyright_year: number | null;
  phone_on_page: string | null;
  phone_matches_listing: number | null;
  has_local_schema: number | null;
  ltd_hint: number | null;
  lh_perf: number | null;
  lh_seo: number | null;
  lh_a11y: number | null;
  lh_bp: number | null;
  lh_error: string | null;
  lh_json_path: string | null;
  screenshot_mobile: string | null;
  screenshot_desktop: string | null;
  error: string | null;
  listing_link_broken?: number | null;
  site_description?: string | null;
  rendered_rescue?: number | null;
}

export interface ScoreRow {
  lead_id: number;
  scored_at: string;
  opportunity: number;
  viability: number;
  total: number;
  tier: Tier;
  channel: Channel;
  reasons_json: string;
  excluded_reason: string | null;
}

export interface PipelineRow {
  lead_id: number;
  status: PipelineStatus;
  channel: string | null;
  contacted_at: string | null;
  last_touch_at: string | null;
  next_touch_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface FullLead {
  lead: LeadRow;
  audit: AuditRow | null;
  ch: CompaniesHouseRow | null;
  score: ScoreRow | null;
  pipeline: PipelineRow;
}
