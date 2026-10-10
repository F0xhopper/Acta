// Managed by Acta. Do not edit.
/**
 * Counts preview opens. On a preview the layout renders a tiny script that, once per browser session, tells the
 * site's own /api/seen route that a person opened it. It stays quiet for automation: Playwright (navigator.webdriver),
 * Lighthouse, link-preview fetchers and crawlers. The route then counts the open in the shared store, so the pipeline
 * can tell "opened but no reply" from "never opened". Nothing about the visitor is recorded.
 */
import { isPreview } from './preview';

export const BOT_UA = /Lighthouse|HeadlessChrome|bot|crawler|spider|WhatsApp|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Google-PageSpeed|curl|node/i;

const SCRIPT = `(function(){try{if(navigator.webdriver)return;if(${BOT_UA.toString()}.test(navigator.userAgent||''))return;` +
  `if(sessionStorage.getItem('acta-seen'))return;sessionStorage.setItem('acta-seen','1');` +
  `var b=JSON.stringify({p:location.pathname});` +
  `if(navigator.sendBeacon)navigator.sendBeacon('/api/seen',new Blob([b],{type:'application/json'}));` +
  `else fetch('/api/seen',{method:'POST',body:b,keepalive:true,headers:{'content-type':'application/json'}})}catch(e){}})();`;

export function SeenBeacon() {
  if (!isPreview()) return null;
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
