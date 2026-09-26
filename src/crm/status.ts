import { addSuppression, getFullLead, setStatus } from '../db/queries.js';
import { PIPELINE_STATUSES, type PipelineStatus } from '../db/types.js';

export function applyStatus(slug: string, status: string, note?: string): { ok: boolean; message: string } {
  if (!(PIPELINE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: `Unknown status "${status}". Use one of: ${PIPELINE_STATUSES.join(', ')}` };
  }
  const full = getFullLead(slug);
  if (!full) return { ok: false, message: `No lead with slug "${slug}"` };
  setStatus(slug, status as PipelineStatus, note);
  if (status === 'do_not_contact' || status === 'lost') {
    addSuppression('place_id', full.lead.place_id, status);
    if (full.lead.phone_e164) addSuppression('phone', full.lead.phone_e164, status);
    if (full.audit?.final_domain) addSuppression('domain', full.audit.final_domain, status);
  }
  return { ok: true, message: `${full.lead.name}: ${full.pipeline.status} -> ${status}${note ? ` (${note})` : ''}` };
}
