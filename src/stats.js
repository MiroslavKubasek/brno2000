import { ADMIN } from './admin.js';

const ON = !ADMIN && import.meta.env.PROD && !/\.pages\.dev$/.test(location.hostname);
const send = (name, opts) => { if (!ON || typeof window.plausible !== 'function') return; try { window.plausible(name, opts); } catch { /* never in the way of the map */ } };
const clean = v => (v == null || v === '' ? undefined : String(v).replace(/\s+/g, ' ').trim().slice(0, 100));
const props = o => { const p = {}; for (const [k, v] of Object.entries(o || {})) { const c = clean(v); if (c !== undefined) p[k] = c; } return Object.keys(p).length ? p : undefined; };

/** One event: track('Karta', { typ: 'dum', nazev: 'Masarykova 12' }). */
export function track(name, o) { send(name, { props: props(o) }); }

/** The page view of the map: once, without the hash (every view and place would be a page of its own otherwise). */
export function pageview(o) {
  if (pageview.sent) return;
  pageview.sent = true;
  send('pageview', { u: location.origin + location.pathname, props: props(o) });
}
/** How the visitor came in, from the address: a place link, a shared view, or the plain map. */
export const entry = () => (location.hash.startsWith('#misto/') ? 'misto' : location.hash.startsWith('#@') ? 'pohled' : 'start');
