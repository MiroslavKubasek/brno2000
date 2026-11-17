import FEEDS from '../tools/data/feeds.json';
import { track } from './stats.js';

export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').trim().replace(/\/$/, '');
const FILES = new Set(Object.values(FEEDS).filter(f => typeof f === 'object').flatMap(f => f.files || []));
FILES.add('feed-meta.json');
export const isFeed = f => FILES.has(f);

export function fetchData(url, init) {
  const m = /(?:^|\/)data\/([\w./-]+\.json)$/.exec(url);
  if (!DATA_BASE || !m || !isFeed(m[1])) return fetch(url, init);
  return fetch(`${DATA_BASE}/data/${m[1]}`, init).then(r => (r.ok ? r : Promise.reject(new Error(`${r.status}`)))).catch(() => { track('Chyba', { co: 'feed-nenacten', detail: m[1] }); return fetch(url, init); });
}

const feedOf = file => Object.keys(FEEDS).find(k => (FEEDS[k].files || []).includes(file));
const watchers = new Map(); // feed name -> [reload]
const hourly = []; // run on every tick, feed or not (live counts read once per visit)
export function watchFeed(file, reload) {
  const name = feedOf(file);
  if (!name) return;
  if (!watchers.has(name)) watchers.set(name, []);
  watchers.get(name).push(reload);
}
export const everyHour = fn => hourly.push(fn);
export const RELOAD = { cache: 'reload' };

const TICK_MIN = 40, JITTER_MS = 120e3, RETURN_MS = 15 * 60e3;
const seen = {}; // feed -> time (ms) of the run whose files the page has; unknown = the page load
const loadedAt = Date.now();
let lastTick = Date.now(), timer = null;
async function tick(since = loadedAt) { // (since: the dev hook can pretend the page is older)
  lastTick = Date.now();
  if (!watchers.size && !hourly.length) return;
  const meta = DATA_BASE ? await fetch(`${DATA_BASE}/data/feed-meta.json`, RELOAD).then(r => (r.ok ? r.json() : null)).catch(() => null) : null;
  const due = [];
  for (const name of watchers.keys()) {
    if (!meta) { if (FEEDS[name].every === 'hourly') due.push(name); continue; }
    const run = meta.feeds && meta.feeds[name];
    const at = run && run.ok ? Date.parse(run.at) : NaN;
    if (at > (seen[name] ?? since)) { seen[name] = at; due.push(name); }
  }
  await Promise.all(due.flatMap(n => watchers.get(n).map(f => Promise.resolve().then(f).catch(() => {}))));
  for (const f of hourly) { try { f(); } catch { /* one hook must not stop the others */ } }
  if (due.length) window.dispatchEvent(new CustomEvent('feed-refresh', { detail: due }));
}
function msToTick() {
  const d = new Date();
  let min = TICK_MIN - d.getMinutes();
  if (min <= 0) min += 60;
  return (min * 60 - d.getSeconds()) * 1000 + Math.random() * JITTER_MS;
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => tick().finally(schedule), msToTick()); }
if (typeof window !== 'undefined') {
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastTick > RETURN_MS) tick().finally(schedule); });
}
