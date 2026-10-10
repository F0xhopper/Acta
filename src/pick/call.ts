/**
 * The call before the build (checkpoints.call in config/build.yaml). Cold email is only allowed to a limited company
 * with an email; everyone else gets a call or a visit anyway, so make it before the build instead of after: thirty
 * seconds on the phone turns a cold build into one they asked to see, and a "no" saves the build. Pure where it can be.
 */
import { findCategory } from '../config.js';
import type { FullLead } from '../db/types.js';
import { emailHook, loadOffer, shortName, type Offer } from '../delivery/index.js';
import { reachOf } from '../score/reach.js';
import { displayUkPhone } from '../util/phone.js';

/** Whether this lead would stop at the call checkpoint: anyone the preview can't be cold emailed to. */
export function needsCall(full: FullLead): boolean {
  return !reachOf(full, findCategory(full.lead.category_key)).emailAllowed;
}

export interface CallScript { phone: string | null; whatsapp: boolean; walkIn: boolean; lines: string[] }

/** What to say, before anything exists to show. Pure given the offer. */
export function callScript(full: FullLead, offer: Offer = loadOffer()): CallScript {
  const r = reachOf(full, findCategory(full.lead.category_key));
  const name = shortName(full.lead.name);
  const trade = full.lead.category_key.replace(/_/g, ' ');
  const hook = emailHook(full).replace(/\.$/, '');
  const phone = full.lead.phone_e164 ? displayUkPhone(full.lead.phone_e164) : null;
  const send = r.mobile ? 'WhatsApp it to this number' : r.email ? `email it to ${r.email}` : 'send it over';
  const lines = [
    phone ? `Call ${phone} between 9 and 11 or 2 and 4, not on a Monday.${r.walkIn ? ' Or walk in mid-afternoon when it is quiet.' : ''}` : 'No phone listed: walk in mid-afternoon when it is quiet.',
    '',
    `"Hi, is that the owner of ${name}? I'm ${offer.sender.name}, a web developer in ${offer.sender.area}. I build sites for local ${trade}s. I noticed ${hook}, and I'd like to put a proper one together for you to look at. There's nothing to pay to see it. If I ${send} in a few days, would you have a look?"`,
    '',
    'Yes: "Great, I\'ll send it over in a few days. Nothing to do until then." Press Yes here and the build starts tonight.',
    'Not now or no: "No problem, thanks for your time." Press No here; nothing gets built and they are not contacted again.',
    'If they ask what it costs: say it plainly, the build price then the monthly, and that they only pay if they want it.',
  ];
  return { phone, whatsapp: r.mobile, walkIn: r.walkIn, lines };
}
