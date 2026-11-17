import fs from 'node:fs';
import path from 'node:path';
import { picKey } from './mediakeys.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'dist-public');
const DATA = path.join(ROOT, 'public/data');
const read = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = (site.siteUrl || '').replace(/\/?$/, '/');
if (!SITE) { console.log('placepages: site.config.json has no siteUrl, the pages of the places need the absolute address; skipped'); process.exit(0); }
const STATS = site.statsUrl ? site.statsUrl.replace(/\/?$/, '/') : '';
const STATS_TAG = STATS ? `<script defer data-domain="${new URL(SITE).hostname}" src="${STATS}js/script.outbound-links.js"></script>\n` : '';
const envFile = ['.env.public', '.env'].map(f => path.join(ROOT, f)).find(f => fs.existsSync(f));
const MEDIA = ((envFile && (/^VITE_MEDIA_BASE=(.*)$/m.exec(fs.readFileSync(envFile, 'utf8')) || [])[1]) || `${SITE}cdn/`).trim().replace(/\/?$/, '/');
const mediaPics = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'media.json'), 'utf8')).pics || {}; } catch { return {}; } })();
const picOf = url => { const k = picKey(url || ''), s = mediaPics[k]; return s ? `${MEDIA}img/${s}/${k}-m.webp` : ''; };

// ---- the same slug as in the map
const slugOf = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = esc;
// image pixel -> lon/lat (imgToLonLat in src/main.js, rotation 0)
const META = read('r0/meta.json');
const LON0 = 16.606, LAT0 = 49.201, KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110574;
const imgToLonLat = (X, Y) => [(X / META.A - META.R) / KX + LON0, (META.R - ((Y - META.TOP + 60 * META.V) * 2) / META.A) / KY + LAT0];
const centroid = ring => { let x = 0, y = 0, n = 0; for (let i = 0; i + 1 < ring.length; i += 2) { x += ring[i]; y += ring[i + 1]; n++; } return n ? [x / n, y / n] : null; };
const dist = (a, b) => Math.hypot((a.lon - b.lon) * KX, (a.lat - b.lat) * KY);

// ---- collect the places: { slug, name, kind, texts: [{ t, by }], lon, lat, img: { src, alt, by, url }, facts: [[k, v]], links: [{ t, u }] }
const places = new Map();
function place(name, kind) {
  const slug = slugOf(name);
  if (!slug) return null;
  let p = places.get(slug);
  if (!p) { p = { slug, name, kind, texts: [], facts: [], links: [], sameAs: [] }; places.set(slug, p); }
  else if (!p.kind && kind) p.kind = kind;
  return p;
}
const addText = (p, t, by) => { t = String(t || '').trim(); if (t && !p.texts.some(x => x.t === t)) p.texts.push({ t, by }); };
const addLink = (p, t, u) => { if (u && !p.links.some(x => x.u === u)) p.links.push({ t, u }); };
const setPos = (p, lon, lat) => { if (p.lon == null && Number.isFinite(lon) && Number.isFinite(lat)) { p.lon = lon; p.lat = lat; } };

// 1. the stories
for (const s of read('r0/stories.json')) {
  const p = place(s.n, s.d || 'Místo s příběhem'); if (!p) continue;
  addText(p, s.t, 'Brno 2000'); setPos(p, s.lon, s.lat);
  if (s.w) p.wiki = s.w;
}
// 2. the Wikipedia tags
const wiki = read('wiki.json');
for (const [name, key, X, Y] of read('r0/wikipois.json')) {
  const w = wiki[key]; if (!w) continue;
  const p = place(name, 'Památka či zajímavost'); if (!p) continue;
  if (name.length <= 3 && key.length > name.length) p.name = key.replace(/\s*\((Brno|Dyjsko-svratecký úval)\)$/, '');
  const [lon, lat] = imgToLonLat(X, Y); setPos(p, lon, lat);
  addText(p, w[0], 'Wikipedie, CC BY-SA 4.0');
  if (w[1]) { addLink(p, 'Článek na Wikipedii', w[1]); p.sameAs.push(w[1]); }
  if (w[2] && !p.img && picOf(w[2])) p.img = { src: picOf(w[2]), alt: name, by: 'Wikimedia Commons', url: w[3] ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(w[3])}` : w[1] };
}
// 3. GO TO BRNO
const gtb = read('gotobrno.json'), gtbd = read('gotobrno-detail.json');
gtb.places.forEach((l, i) => {
  const d = gtbd.places[i] || {};
  const p = place(l.n, 'Tip z Go to Brno'); if (!p) return;
  setPos(p, l.lon, l.lat);
  addText(p, d.t, 'Go to Brno (TIC Brno)');
  if (d.addr) p.facts.push(['Adresa', d.addr.replace(/, Česko$/, '')]);
  if (d.hours) p.facts.push(['Otevírací doba', d.hours]);
  if (d.url) addLink(p, 'Místo na gotobrno.cz', d.url);
  if (d.web) addLink(p, 'Web místa', d.web);
  if (d.tickets) addLink(p, 'Vstupenky', d.tickets);
  // (the GO TO BRNO photos are not copied: their licence is not stated, the map only links to them)
});
// 4. the city projects (Brno Brzo) and the city's "Co bude" pages
const proj = read('projects.json'), projd = read('projects-detail.json');
for (const r of proj.projects) {
  const d = projd[r.id] || {};
  const name = r.cb ? r.cb.t : r.n; if (!name) continue;
  const p = place(name, r.ty ? `Projekt · ${r.ty}` : 'Projekt'); if (!p) continue;
  const c = r.g && r.g[0] ? centroid(r.g[0]) : null; if (c) setPos(p, c[0], c[1]);
  if (r.cb && r.cb.d) addText(p, r.cb.d, 'Co bude (město Brno)');
  addText(p, d.txt, 'Brno Brzo (město Brno)');
  if (r.st) p.facts.push(['Stav', r.st]);
  if (d.addr) p.facts.push(['Adresa', d.addr]);
  if (d.inv) p.facts.push(['Investor', d.inv]);
  if (d.dev) p.facts.push(['Developer', d.dev]);
  if (d.arch) p.facts.push(['Architekt', d.arch]);
  const pic = [...(r.cb && r.cb.img ? [r.cb.img] : []), ...(d.imgs || [])].map(picOf).find(Boolean);
  if (pic && !p.img) p.img = { src: pic, alt: name, by: r.cb && r.cb.img && picOf(r.cb.img) === pic ? 'Co bude, město Brno' : 'Brno Brzo, město Brno', url: (r.cb && r.cb.img && picOf(r.cb.img) === pic ? r.cb.url : d.src) || 'https://brzo.brno.cz/' };
  if (r.cb && r.cb.url) addLink(p, 'Projekt na cobude.brno.cz', r.cb.url);
  if (d.web) addLink(p, 'Web projektu', d.web);
  if (d.src && d.src !== d.web) addLink(p, 'Záznam v Brno Brzo', d.src);
}
for (const c of proj.cobude || []) {
  if (!c.t) continue;
  const p = place(c.t, 'Projekt města'); if (!p) continue;
  addText(p, c.d, 'Co bude (město Brno)');
  if (c.img && !p.img) p.img = { src: c.img, alt: c.t, by: 'Co bude, město Brno', url: c.url };
  addLink(p, 'Projekt na cobude.brno.cz', c.url);
}

// only places that have something to say
const list = [...places.values()].filter(p => p.texts.length);
const placed = list.filter(p => p.lon != null);
for (const p of list) {
  if (p.lon == null) { p.near = []; continue; }
  p.near = placed.filter(q => q !== p).map(q => [dist(p, q), q]).sort((a, b) => a[0] - b[0]).slice(0, 6).map(([d, q]) => ({ q, d }));
}

// ---- the pages
const CSS = `:root{--night:#1b2333;--panel:#232d42;--edge:#3a4762;--ink:#eef1e6;--muted:#a9b3c4;--tile:#c9583b;--grass:#8cc063;color-scheme:dark}
body{margin:0;background:var(--night);color:var(--ink);font:16px/1.55 "Atkinson Hyperlegible",system-ui,sans-serif}
main{max-width:680px;margin:0 auto;padding:24px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;font-size:.95rem}
.top a{color:var(--grass);text-decoration:none;font-weight:700}
h1{font-size:1.8rem;line-height:1.15;margin:0 0 4px}
.kind{color:var(--muted);margin:0 0 16px}
.card{background:var(--panel);border:2px solid var(--edge);box-shadow:4px 4px 0 rgba(0,0,0,.35);padding:16px 18px;margin-bottom:18px}
.card p{margin:0 0 12px}.card p:last-child{margin-bottom:0}
figure{margin:0 0 16px}figure img{display:block;width:100%;height:auto;max-height:420px;object-fit:cover;border:2px solid var(--edge)}
figcaption{font-size:.8rem;color:var(--muted);margin-top:6px}
.by{font-size:.8rem;color:var(--muted);margin-top:-6px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}dt{color:var(--muted)}dd{margin:0}
.open{display:inline-block;background:var(--tile);color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border:2px solid #7a3220;box-shadow:3px 3px 0 rgba(0,0,0,.4);margin:4px 0 18px}
.open:hover{filter:brightness(1.1)}
ul{padding-left:20px;margin:0}li{margin:4px 0}a{color:var(--ink)}
h2{font-size:1.1rem;margin:0 0 10px;color:var(--grass)}
.near a{text-decoration:none}.near a:hover{text-decoration:underline}.near small{color:var(--muted)}
footer{color:var(--muted);font-size:.85rem;margin-top:24px}footer a{color:var(--ink)}
.index h2{margin-top:24px}.index ul{columns:2;column-gap:24px;list-style:none;padding:0}.index li{break-inside:avoid}
@media(max-width:520px){.index ul{columns:1}}`;
const head = (title, desc, canon, img, extra = '') => `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<meta name="author" content="Mirek Kubásek">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="article">
<meta property="og:locale" content="cs_CZ">
<meta property="og:site_name" content="Brno 2000">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${attr(img)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#c9583b">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#1b2333">
<meta name="application-name" content="Brno 2000">
<meta name="apple-mobile-web-app-title" content="Brno 2000">
<link rel="stylesheet" href="/misto/misto.css">
${STATS_TAG}${extra}</head>
<body>
<main>
<nav class="top"><a href="/">‹ Brno 2000 · mapa Brna</a><a href="/misto/">Všechna místa</a></nav>
`;
const foot = `<footer>Mapu <a href="/o-mape/">Brno 2000</a> vytvořil Mirek Kubásek.</footer>
</main>
</body>
</html>
`;
const shorten = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s\S*$/, '') + '…');
const km = d => (d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`);

fs.mkdirSync(path.join(OUT, 'misto'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'misto/misto.css'), CSS);
const urls = [];
for (const p of list) {
  const canon = `${SITE}misto/${p.slug}/`;
  const title = `${p.name} · Brno 2000, mapa Brna`;
  const desc = shorten(p.texts[0].t.replace(/\s+/g, ' '), 158);
  const img = p.img ? p.img.src : `${SITE}og.png`;
  const ld = { '@context': 'https://schema.org', '@type': 'Place', name: p.name, description: desc, url: canon };
  if (p.lon != null) ld.geo = { '@type': 'GeoCoordinates', latitude: +p.lat.toFixed(5), longitude: +p.lon.toFixed(5) };
  if (p.img) ld.image = p.img.src;
  const addr = p.facts.find(f => f[0] === 'Adresa'); if (addr) ld.address = { '@type': 'PostalAddress', streetAddress: addr[1], addressLocality: 'Brno', addressCountry: 'CZ' };
  if (p.sameAs.length) ld.sameAs = p.sameAs;
  const paras = p.texts.map(x => `${x.t.split(/\n+/).map(t => `<p>${esc(t)}</p>`).join('')}<p class="by">Text: ${esc(x.by)}</p>`).join('');
  const html = head(title, desc, canon, img, `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`) +
    `<h1>${esc(p.name)}</h1>
<p class="kind">${esc(p.kind || 'Místo v Brně')}${p.lon != null ? ` · <a href="https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&amp;mlon=${p.lon.toFixed(5)}#map=17/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}" rel="noopener">${p.lat.toFixed(4)} N, ${p.lon.toFixed(4)} E</a>` : ''}</p>
<a class="open" href="/#misto/${p.slug}">Otevřít na živé mapě Brna</a>
${p.img ? `<figure><img src="${attr(p.img.src)}" alt="${attr(p.img.alt)}" loading="lazy"><figcaption>Foto: <a href="${attr(p.img.url)}" rel="noopener">${esc(p.img.by)}</a></figcaption></figure>` : ''}
<div class="card">${paras}</div>
${p.facts.length ? `<div class="card"><dl>${p.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
${p.links.length ? `<div class="card"><h2>Odkazy</h2><ul>${p.links.map(l => `<li><a href="${attr(l.u)}" rel="noopener">${esc(l.t)}</a></li>`).join('')}</ul></div>` : ''}
${p.near.length ? `<div class="card near"><h2>Další místa v okolí</h2><ul>${p.near.map(({ q, d }) => `<li><a href="/misto/${q.slug}/">${esc(q.name)}</a> <small>${km(d)}</small></li>`).join('')}</ul></div>` : ''}
` + foot;
  fs.mkdirSync(path.join(OUT, 'misto', p.slug), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'misto', p.slug, 'index.html'), html);
  urls.push(canon);
}

// the list of all the places
const groups = [
  ['Místa a příběhy', p => p.texts.some(t => t.by === 'Brno 2000')],
  ['Památky a zajímavosti', p => p.sameAs.length],
  ['Tipy Go to Brno', p => p.texts.some(t => /Go to Brno/.test(t.by))],
  ['Stavby a projekty města', () => true],
];
const used = new Set();
const sections = groups.map(([h, test]) => {
  const items = list.filter(p => !used.has(p) && test(p)).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  for (const p of items) used.add(p);
  return items.length ? `<h2>${h} (${items.length})</h2><ul>${items.map(p => `<li><a href="/misto/${p.slug}/">${esc(p.name)}</a></li>`).join('')}</ul>` : '';
}).join('');
const idxDesc = `Všechna místa na živé izometrické mapě Brna: ${list.length} památek, zajímavostí, tipů na výlet a staveb, každé s popisem a odkazem na mapu.`;
fs.writeFileSync(path.join(OUT, 'misto/index.html'), head('Místa v Brně · Brno 2000', idxDesc, `${SITE}misto/`, `${SITE}og.png`) +
  `<div class="index"><h1>Místa v Brně</h1><p class="kind">${esc(idxDesc)}</p>${sections}</div>\n` + foot);
urls.unshift(`${SITE}misto/`);

// the sitemap
const sm = path.join(OUT, 'sitemap.xml');
if (fs.existsSync(sm)) {
  const day = new Date().toISOString().slice(0, 10);
  const old = fs.readFileSync(sm, 'utf8').replace(/ {2}<url><loc>[^<]*\/misto\/[^<]*<\/loc>[^\n]*\n/g, '');
  const add = urls.map(u => `  <url><loc>${u}</loc><lastmod>${day}</lastmod><priority>${u.endsWith('misto/') ? '0.7' : '0.5'}</priority></url>`).join('\n');
  fs.writeFileSync(sm, old.replace('</urlset>', `${add}\n</urlset>`));
}
console.log(`placepages: ${list.length} places (${placed.length} with a position, ${list.filter(p => p.img).length} with a picture) -> ${path.relative(ROOT, OUT)}/misto/`);
