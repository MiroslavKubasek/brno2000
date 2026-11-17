import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';

// The author and the address of the site (site.config.json): the "Jak to vzniklo" text (src/about.html) goes
// into the map and into the page /o-mape; the contact and the absolute address for sharing previews are
// filled in here, at build time.
const site = JSON.parse(fs.readFileSync(resolve(__dirname, 'site.config.json'), 'utf8'));
const SITE = site.siteUrl ? site.siteUrl.replace(/\/?$/, '/') : '';
const CONTACT = site.email ? `<a href="mailto:${site.email}">${site.email}</a>` : '';
const STATS = site.statsUrl ? site.statsUrl.replace(/\/?$/, '/') : '';
const STATS_DOMAIN = SITE ? new URL(SITE).hostname : '';
const statsTag = (mode, manual) => (mode === 'public' && STATS && STATS_DOMAIN
  ? `<script>window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}</script>\n<script defer data-domain="${STATS_DOMAIN}" src="${STATS}js/script.${manual ? 'manual.' : ''}outbound-links.js"></script>`
  : '');
// the overview of the data as schema.org DataCatalog (Google Dataset Search): one Dataset per row of
// public/data/datasets.json; the rows of the parts left out of the public version are not in it (publicPages)
function datasetsLd() {
  const f = resolve(__dirname, 'public/data/datasets.json');
  if (!fs.existsSync(f) || !SITE) return '';
  const hidden = new Set(Object.values(pub.parts).filter(p => !p.public).flatMap(p => p.datasets || []));
  const ds = JSON.parse(fs.readFileSync(f, 'utf8')).filter(d => !hidden.has(d.name)).map(d => {
    const o = { '@type': 'Dataset', name: d.name, description: `${d.what}${d.note ? ` ${d.note}` : ''}`, creator: { '@type': 'Organization', name: d.owner }, license: d.licence, spatialCoverage: 'Brno, Česko', inLanguage: 'cs' };
    if (d.date) o.dateModified = d.date;
    if (d.links && d.links[0]) o.url = d.links[0][1];
    return o;
  });
  const ld = { '@context': 'https://schema.org', '@type': 'DataCatalog', name: 'Data v mapě Brno 2000', url: `${SITE}data`, description: 'Otevřená data, ze kterých je poskládaná živá izometrická mapa Brna.', dataset: ds };
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}
function authorPages(mode) {
  return {
    name: 'author-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const sub = /o-mape/.test(`${ctx.path || ''} ${ctx.filename || ''}`);
        const base = sub ? '../' : './';
        const page = sub ? 'o-mape/' : /data\.html/.test(`${ctx.path || ''} ${ctx.filename || ''}`) ? 'data' : '';
        const about = fs.readFileSync(resolve(__dirname, 'src/about.html'), 'utf8').replace(/^<!--[^\n]*-->\n/, '');
        return html
          .replaceAll('<!--#about-->', about)
          .replaceAll('<!--#ogurl-->', SITE ? `<meta property="og:url" content="${SITE}${page}">\n<link rel="canonical" href="${SITE}${page}">` : '')
          .replaceAll('<!--#datasets-->', page === 'data' ? datasetsLd() : '')
          .replaceAll('<!--#stats-->', statsTag(mode, page === ''))
          .replaceAll('<!--#statsnote-->', statsTag(mode, false) ? '<p class="fine">Návštěvnost měřím anonymně, bez cookies a bez sledování napříč weby (Plausible na vlastním serveru). Vidím jen, co lidi v mapě zajímá, ne kdo jsou.</p>' : '')
          .replaceAll('%OGIMAGE%', SITE ? `${SITE}og.png` : `${base}og.png`)
          .replaceAll('%SITE%', SITE || base)
          .replaceAll('%CONTACT%', CONTACT)
          .replaceAll('%BASE%', base);
      },
    },
  };
}

// ---- the public version: what is left out (public.config.json)
const pub = JSON.parse(fs.readFileSync(resolve(__dirname, 'public.config.json'), 'utf8'));
const hiddenParts = mode => (mode === 'public' ? Object.entries(pub.parts).filter(([, p]) => !p.public).map(([k]) => k) : []);
// remove whole elements (with everything inside) whose start tag matches the test
function removeElements(html, test) {
  const VOID = /^(input|img|br|hr|meta|link|source)$/i;
  for (let guard = 0; guard < 500; guard++) {
    let found = null;
    for (const m of html.matchAll(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g)) if (m[2] && test(m[2])) { found = m; break; }
    if (!found) break;
    const tag = found[1], start = found.index, open = start + found[0].length;
    let end = open;
    if (!VOID.test(tag) && !found[0].endsWith('/>')) {
      const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi'); re.lastIndex = open;
      let depth = 1, m;
      while (depth && (m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) end = m.index + m[0].length; }
      if (depth) end = open;
    }
    html = html.slice(0, start) + html.slice(end);
  }
  return html;
}
function publicPages(mode) {
  const hidden = new Set(hiddenParts(mode));
  return {
    name: 'public-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // the tuning tools are not in the public pages at all (not just hidden by the script)
        if (mode === 'public') html = removeElements(html, a => /\sdata-admin(\s|=|$)/.test(a));
        // parts: data-pub="x" only when x is shown, data-pub-else="x" (its stand-in) only when x is left out
        html = removeElements(html, a => { const p = /\sdata-pub="([\w-]+)"/.exec(a); return !!p && hidden.has(p[1]); });
        html = removeElements(html, a => { const p = /\sdata-pub-else="([\w-]+)"/.exec(a); return !!p && !hidden.has(p[1]); });
        return html;
      },
    },
    // the data files of the left-out parts are not published, nor their rows in the overview of the data
    closeBundle() {
      if (mode !== 'public') return;
      const out = resolve(__dirname, 'dist-public');
      const drop = [];
      for (const k of hidden) for (const f of pub.parts[k].data || []) { fs.rmSync(resolve(out, f), { recursive: true, force: true }); drop.push(f); }
      const dsFile = resolve(out, 'data/datasets.json');
      if (fs.existsSync(dsFile)) {
        const names = new Set([...hidden].flatMap(k => pub.parts[k].datasets || []));
        const ds = JSON.parse(fs.readFileSync(dsFile, 'utf8')).filter(d => !names.has(d.name));
        fs.writeFileSync(dsFile, JSON.stringify(ds));
      }
      if (hidden.size) console.log(`public version leaves out: ${[...hidden].join(', ')} (${drop.join(', ')})`);
    },
  };
}

function mediaLink(mode, outDir, mediaBase) {
  return {
    name: 'media-link',
    apply: 'build',
    closeBundle() {
      if (mode === 'public' && mediaBase) return;
      const src = resolve(__dirname, 'cdn'), dst = resolve(__dirname, outDir, 'cdn');
      if (!fs.existsSync(src)) return;
      try { if (fs.lstatSync(dst).isSymbolicLink()) fs.unlinkSync(dst); } catch { /* none yet */ }
      let n = 0;
      const walk = (a, b) => {
        fs.mkdirSync(b, { recursive: true });
        for (const e of fs.readdirSync(a, { withFileTypes: true })) {
          const pa = resolve(a, e.name), pb = resolve(b, e.name);
          if (e.isDirectory()) walk(pa, pb);
          else if (e.isFile() && !fs.existsSync(pb)) { try { fs.linkSync(pa, pb); } catch { fs.copyFileSync(pa, pb); } n++; }
        }
      };
      walk(src, dst);
      if (n) console.log(`${outDir}/cdn: ${n} media files linked`);
    },
  };
}

// the service worker (src/sw.js) is emitted with the build time as its version: a new build takes over the caches
// (and with the origin of the data feeds, VITE_DATA_BASE, so the worker caches them like the data next to the page)
function swVersion(dataBase) {
  let origin = '';
  try { origin = dataBase ? new URL(dataBase).origin : ''; } catch { /* not an absolute address: no feed origin */ }
  return {
    name: 'sw-version', apply: 'build',
    generateBundle() {
      const src = fs.readFileSync(resolve(__dirname, 'src/sw.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src.replaceAll('__V__', Date.now().toString(36)).replace("'__DATA__'", JSON.stringify(origin)) });
    },
  };
}

const PAGES = ['', 'o-mape/', 'data'];
function seoFiles() {
  return {
    name: 'seo-files', apply: 'build',
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', 'Disallow: /data/', 'Disallow: /assets/', SITE ? `Sitemap: ${SITE}sitemap.xml` : '', ''].filter(l => l !== undefined).join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (!SITE) return;
      const day = new Date().toISOString().slice(0, 10);
      const url = (p, prio) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod><priority>${prio}</priority></url>`;
      const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...PAGES.map(p => url(p, p === '' ? '1.0' : '0.6')), '</urlset>', ''].join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const outDir = mode === 'public' ? 'dist-public' : 'dist';
  return {
    base: './',
    plugins: [authorPages(mode), publicPages(mode), mediaLink(mode, outDir, env.VITE_MEDIA_BASE), swVersion(env.VITE_DATA_BASE), seoFiles()],
    define: { 'import.meta.env.VITE_PUBLIC_HIDE': JSON.stringify(hiddenParts(mode).join(',')) },
    build: {
      outDir, emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1000,
      // pages: the map, the overview table of all its data (data.html) and how the map was made (/o-mape)
      rollupOptions: { input: { main: resolve(__dirname, 'index.html'), data: resolve(__dirname, 'data.html'), about: resolve(__dirname, 'o-mape/index.html') } },
    },
  };
});
