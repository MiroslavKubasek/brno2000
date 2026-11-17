// What is in Brno and what is going on (City of Brno open data, data.brno.cz, CC BY; prepared by tools/*.mjs):
// GO TO BRNO tourist places, themed routes and events, cultural monuments (Wikidata, CC0), public transport
// closures (IDS JMK), memorial trees, drinking fountains, viewpoints and swimming pools.
import { fetchData, watchFeed, RELOAD } from './feed.js';
import { beacon } from './beacon.js';
const TXT_Z = 2 / 3.5; // text, events and stops only from 3.5 m per pixel
const SMALL_Z = 1 / 0.3; // the small things (statues, trees, fountains …) only from 0.3 m per pixel
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['a', 'v', 'na', 'u', 've', 'brno', 'brne', 'brna', 'the', 'and', 'of', 'z', 'do', 'pro', 'k', 'se', 's']);
const words = s => norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w));
// Two names of the same place: all words agree in some Czech form ("Výstaviště Brno" = "Brněnské výstaviště",
// "Kostel sv. Jiljí" = "sv. Jiljí"), or the shorter name of at least two words is all in the longer one
// ("Janáčkovo divadlo" in "Janáčkovo divadlo – Národní divadlo Brno"); letters and numbers must agree ("Pavilon A").
const OPTIONAL = new Set(['park', 'kostel', 'svaty', 'svata', 'svateho', 'svate', 'brnenska', 'brnenske', 'brnensky', 'brnenskeho']);
const sameWord = (a, b) => { if (a === b) return true; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i >= 5 && i >= Math.max(a.length, b.length) - 3; };
const marks = s => String(s).split(/[^\p{L}\p{N}]+/u).filter(t => /^(\p{Lu}|\d+)$/u.test(t)).sort().join(','); // (Unicode-aware: "Výstaviště" is a word, not a "V")
function sameName(a, b) {
  if (marks(a) !== marks(b)) return false;
  const ka = words(a).filter(w => !OPTIONAL.has(w)), kb = words(b).filter(w => !OPTIONAL.has(w));
  if (!ka.length || !kb.length) return false;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (!s.every(x => l.some(y => sameWord(x, y)))) return 0;
  return l.every(y => s.some(x => sameWord(x, y))) ? 2 : s.length >= 2 ? 1 : 0; // 2 = the same name, 1 = contained
}
export const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// hiddenBehind(X, Y): is this point on the ground hidden behind a building (true / false / null = not known yet)?
// things standing behind a building are drawn see-through
export function createCity({ base, llToImg, hiddenBehind = () => false }) {
  const D = { places: [], routes: [], events: [], monuments: [], outages: [], small: [], updated: {} };
  let loading = null;
  const loadPlaces = init => fetchData(`${base}data/gotobrno.json`, init).then(r => r.json()).then(d => { D.places = d.places; D.routes = d.routes; D.events = d.events; D.updated.gotobrno = d.updated; posKey = ''; }).catch(() => {});
  const loadOutages = init => fetchData(`${base}data/outages.json`, init).then(r => r.json()).then(d => { D.outages = d.items; D.updated.outages = d.updated; posKey = ''; }).catch(() => {});
  const loadSmall = init => fetchData(`${base}data/smallpois.json`, init).then(r => r.json()).then(d => { D.small = d.items; D.updated.small = d.updated; posKey = ''; }).catch(() => {});
  const load = () => (loading ||= Promise.all([
    loadPlaces(), loadOutages(), loadSmall(),
    fetchData(`${base}data/artsprites.json`).then(r => r.json()).then(d => new Promise(res => {
      const im = new Image(); im.onload = () => { sprites = { ...d, im }; res(); }; im.onerror = () => res(); im.src = `${base}data/artsprites.png`;
    })).catch(() => {}),
  ]));
  let sprites = null; // { im, ids: { id: [x, y, w, h] }, models: { id: name }, types: { name: [x, y, w, h] } }
  // the sprite of a small thing: its own (cut out of the photo), or the model of its type; null = the pin
  const spriteOf = o => sprites && o.id != null ? sprites.ids[o.id] || sprites.types[sprites.models[o.id]] || null : null;
  // the cultural monuments (175 KB): fetched only when their layer is switched on or a building card asks for them
  let monuments = null;
  const loadMonuments = init => (monuments ||= fetchData(`${base}data/monuments.json`, init).then(r => r.json()).then(d => { D.monuments = d.items; D.updated.monuments = d.updated; posKey = ''; }).catch(() => {}));
  watchFeed('gotobrno.json', () => loading && loadPlaces(RELOAD).then(() => { detailed = null; }));
  watchFeed('outages.json', () => loading && loadOutages(RELOAD));
  watchFeed('smallpois.json', () => loading && loadSmall(RELOAD));
  watchFeed('monuments.json', () => monuments && (monuments = null, loadMonuments(RELOAD)));
  // the detail file (descriptions, opening hours, pictures, links of the places and events), merged into the same
  // objects: await it before a card or a list that shows them
  let detailed = null;
  const detail = () => (detailed ||= load().then(() => fetchData(`${base}data/gotobrno-detail.json`)).then(r => r.json()).then(d => {
    (d.places || []).forEach((x, i) => D.places[i] && Object.assign(D.places[i], x));
    (d.events || []).forEach((x, i) => D.events[i] && Object.assign(D.events[i], x));
  }).catch(() => { detailed = null; }));
  // image positions depend on the rotation: recomputed when llToImg changes
  let posKey = '';
  function positions() {
    // (the key includes the sizes: the files arrive one by one)
    const k = `${llToImg(16.6, 49.2).join(',')}|${D.places.length},${D.routes.length},${D.events.length},${D.monuments.length},${D.outages.length},${D.small.length}`;
    if (k === posKey) return;
    posKey = k;
    for (const list of [D.places, D.events, D.monuments, D.outages, D.small]) for (const o of list) { [o.X, o.Y] = llToImg(o.lon, o.lat); o.hid = undefined; }
    for (const r of D.routes) for (const s of r.stops) [s.X, s.Y] = llToImg(s.lon, s.lat);
    matched = null;
  }

  // ---- one object per place: GO TO BRNO places joined to the Wikipedia name tags nearby with a similar name
  let matched = null; // { byWiki: Map(title -> place), own: [places without a Wikipedia tag] }
  function match(wikiPois) {
    if (matched && matched.src === wikiPois) return matched;
    positions();
    const byWiki = new Map(), used = new Set();
    for (const p of D.places) {
      const pw = words(p.n);
      let best = null, bs = 0;
      for (const w of wikiPois || []) {
        const d = Math.hypot(w[2] - p.X, (w[3] - p.Y) * 2);
        // the same name (Hády, Zoo Brno, Koupaliště Riviéra…): one tag even when the two sources put the
        // point some hundreds of metres apart (large areas, or a GO TO BRNO point off the building)
        const sn = d <= 800 ? sameName(p.n, w[0]) : 0;
        if (sn === 2 || (sn === 1 && d <= 200)) { const s = 2 - d / 800; if (s > bs) { bs = s; best = w; } continue; }
        if (d > 120) continue;
        const ww = words(w[0]);
        const common = pw.filter(x => ww.some(y => y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5)))).length;
        const score = common / Math.max(1, Math.min(pw.length, ww.length)) - d / 400;
        if (common && score > bs) { bs = score; best = w; }
      }
      if (best && bs > 0.3 && !byWiki.has(best[1])) { byWiki.set(best[1], p); used.add(p); }
    }
    matched = { src: wikiPois, byWiki, own: D.places.filter(p => !used.has(p)) };
    return matched;
  }
  // the place of a project / building by name and position
  function placeNear(lon, lat, name, maxM = 80) {
    let best = null, bs = 0;
    const nw = words(name);
    for (const p of D.places) {
      const d = Math.hypot((p.lon - lon) * 72765, (p.lat - lat) * 111200);
      if (d > maxM) continue;
      const pw = words(p.n);
      const common = nw.length ? pw.filter(x => nw.some(y => y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5)))).length : 0;
      const score = (common ? 1 + common : 0) - d / maxM;
      if (score > bs) { bs = score; best = p; }
    }
    return bs >= 1 ? best : null;
  }

  // ---- monuments: the one inside the building's footprints (ground outlines, image px) or the nearest one within 20 m
  function monumentFor(footprints, lon, lat) {
    positions();
    const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    let near = null, nd = 20;
    for (const m of D.monuments) {
      if (footprints && footprints.some(p => inPoly(p, m.X, m.Y))) return m;
      const d = Math.hypot((m.lon - lon) * 72765, (m.lat - lat) * 111200);
      if (d < nd) { nd = d; near = m; }
    }
    return near;
  }

  // ---- what is valid / on
  const outagesNow = () => D.outages.filter(o => (!o.from || o.from <= Date.now()) && (!o.to || o.to > Date.now()));
  const outagesForLine = line => outagesNow().filter(o => o.lines.includes(String(line)));
  const outagesNear = (lon, lat, lines, m = 400) => outagesNow().filter(o => Math.hypot((o.lon - lon) * 72765, (o.lat - lat) * 111200) < m && (!lines || !lines.length || o.lines.some(l => lines.includes(l))));
  function eventsIn(range, cat) {
    const t0 = dayStart(), t1 = range === 'today' ? t0 + 864e5 : range === 'week' ? t0 + 7 * 864e5 : Infinity;
    // (the dates come as midnight UTC, 1:00 or 2:00 here: the last day of an event is over at the local midnight after it,
    // otherwise yesterday's one-day events would still be in the map for an hour or two — and all day in the icon layer)
    return D.events.filter(e => e.from < t1 && dayStart(e.to || e.from) + 864e5 > t0 && (!cat || e.cats.includes(cat)));
  }
  const categories = () => [...new Set(D.events.flatMap(e => e.cats))].sort((a, b) => a.localeCompare(b, 'cs'));

  // ---- drawing (in the icon layer, above labels and buildings)
  let hits = [];
  const route = { r: null, i: -1 };
  const inView = (ctx, x, y, m = 30) => x > -m && y > -m && x < ctx.canvas.width + m && y < ctx.canvas.height + m;
  // colour and glyph of the pin of each kind of small thing (viewpoints: yellow triangle)
  const SMALL_PIN = { fountain: ['#7fc8f0', '💧'], pool: ['#4fa3e0', '≈'], art: ['#e3c48f', '🗿'], cross: ['#d9d4c7', '✝'], plaque: ['#c9a36a', '▭'] };
  function pin(ctx, x, y, fill, glyph, s = 1) {
    const r = Math.round(7 * s);
    if (ctx.__claim && !ctx.__claim(x - r - 2, y - 2 * r - 2, x + r + 2, y + 4)) return null; // another icon is here: counted in its cluster
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - r + 2, y - 2 * r + 2, 2 * r, 2 * r);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x - r - 1, y - 2 * r - 1, 2 * r + 2, 2 * r + 2);
    ctx.fillStyle = fill; ctx.fillRect(x - r, y - 2 * r, 2 * r, 2 * r);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x - 1, y, 2, 3);
    ctx.font = `400 ${Math.round(14 * s)}px "VT323", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y - r + 1);
    return [x - r - 2, y - 2 * r - 2, x + r + 2, y + 4];
  }
  // an event: a leaf of a tear-off calendar (holes along the top, pink header, the day of the event on it),
  // one person standing on its left and two on its right (the same figures as in the legend)
  const EVENT_PEOPLE = [[-9, '#5a3b22', '#f0c8a0', '#f2c66d', '#3a4762', 1], [21, '#2b2118', '#c68642', '#5fb3e6', '#4b3b2a', -1], [28, '#d9c38a', '#e0ac7a', '#e58ac9', '#3a4762', 1]];
  // (s: the scale of a highlighted leaf from the Aktuálně panel — half again as big, never clustered, with a pulsing ring)
  function calendarLeaf(ctx, x, y, day, s = 1, t = 0, seed = 0) {
    const box = [x - 19 * s, y - 24 * s, x + 26 * s, y + 2];
    if (ctx.__claim && !ctx.__claim(...box)) return null; // (highlighted leaves still fold into clusters: far out there are hundreds in the centre)
    if (s > 1) {
      // highlighted: pink ripples spread over the ground from the leaf, and the leaf hops
      const hop = beacon(ctx, x + 3 * s, y, t, '#e58ac9', 36, seed);
      ctx.save(); ctx.translate(x, y - hop); ctx.scale(s, s); leafBody(ctx, 0, 0, day); ctx.restore();
    } else leafBody(ctx, x, y, day);
    return box;
  }
  function leafBody(ctx, x, y, day) {
    const w = 18, h = 19, x0 = x - w / 2, y0 = y - h - 3;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0 + 2, y0 + 2, w, h); // shadow
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2); ctx.fillRect(x - 1, y0 + h, 2, 3); // outline and the stub to the ground
    ctx.fillStyle = '#eef1e6'; ctx.fillRect(x0, y0, w, h); // the leaf
    ctx.fillStyle = '#e58ac9'; ctx.fillRect(x0, y0, w, 6); // the header
    ctx.fillStyle = '#1b2333'; for (const dx of [4, 9, 14]) ctx.fillRect(x0 + dx - 1, y0 + 1, 2, 2); // the holes of the binding
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x0, y0 + 6, w, 1); // the tear line under the header
    ctx.font = '400 13px "VT323", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(day), x, y0 + 13);
    // the people: 6 × 14 px each (hair, face, shirt, a stepping pair of legs), feet level with the bottom of the leaf
    const g = y0 + h + 1;
    for (const [dx, hair, skin, shirt, legs, face] of EVENT_PEOPLE) {
      const fx = x0 + dx, top = g - 14;
      ctx.fillStyle = skin; ctx.fillRect(fx + 2, top, 2, 4);
      ctx.fillStyle = hair; ctx.fillRect(fx + 2, top, 2, 2); ctx.fillRect(fx + (face > 0 ? 4 : 0), top, 2, 2);
      ctx.fillStyle = shirt; ctx.fillRect(fx, top + 4, 6, 6);
      ctx.fillStyle = legs;
      if (face > 0) { ctx.fillRect(fx, top + 10, 2, 4); ctx.fillRect(fx + 4, top + 12, 2, 2); } else { ctx.fillRect(fx, top + 12, 2, 2); ctx.fillRect(fx + 4, top + 10, 2, 4); }
    }
  }
  // focus: the theme chosen in the Aktuálně panel ('events': the event leaves are bigger, at any zoom; the other icons dimmed)
  function draw(ctx, v, t, layers, focus = null, eventsRange = 'week') {
    hits = [];
    const dim = focus ? 0.5 : 1;
    ctx.globalAlpha = dim;
    if (!D.places.length) { load(); return; }
    positions();
    const S = (o) => [Math.round(v.ox + o.X * v.k), Math.round(v.oy + o.Y * v.k)];
    // (monuments are drawn by the page as outlines of their buildings, see drawMonuments in main.js)
    // small things: memorial trees, fountains, viewpoints, pools, statues and memorials, crosses, plaques — only from 0.3 m per pixel
    if (v.z >= SMALL_Z) {
      const on = { tree: layers.smTree, fountain: layers.pitka, view: layers.smView, pool: layers.smPool, art: layers.smArt, cross: layers.smCross, plaque: layers.smPlaque };
      // everything is drawn to the scale of the map like the buildings, a quarter bigger than life (a sprite of
      // 40 px stands for an object of about 6.5 m): 0.25 × pixels per metre; never under 0.3 and never over 1.6
      // (close up the pixel art would fall apart)
      const sc = Math.min(1.6, Math.max(0.3, v.z * 0.25));
      for (const o of D.small) {
        if (!on[o.k] || o.dup) continue;
        const [x, y] = S(o); if (!inView(ctx, x, y)) continue;
        let box;
        if (o.k === 'tree' && ctx.__claim && !ctx.__claim(x - 12 * sc, y - 30 * sc, x + 12 * sc, y + 2)) continue;
        if (o.k === 'tree') {
          // a big old tree
          const r = v => Math.round(v * sc);
          ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + r(4), y, r(10), Math.max(2, r(4)), 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#5a3b22'; ctx.fillRect(x - r(2), y - r(10), Math.max(2, r(4)), r(10));
          ctx.fillStyle = '#1b2333'; ctx.beginPath(); ctx.arc(x, y - r(18), r(11), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#3f7a2c'; ctx.beginPath(); ctx.arc(x, y - r(18), r(10), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#5e9a3a'; ctx.beginPath(); ctx.arc(x - r(3), y - r(21), r(5), 0, Math.PI * 2); ctx.fill();
          // no name tag (the name is in the card after a click)
          box = [x - r(12), y - r(30), x + r(12), y + 2];
        } else {
          const sp = spriteOf(o);
          if (sp) {
            // the object itself, standing on its point (a statue cut out of the photo, or the model of its type)
            const [sx, sy, sw, sh] = sp, w = Math.round(sw * sc), h = Math.round(sh * sc), x0 = x - (w >> 1), y0 = y - h + 2;
            if (ctx.__claim && !ctx.__claim(x0, y0, x0 + w, y + 2)) continue;
            if (o.hid === undefined) { const hb = hiddenBehind(o.X, o.Y); if (hb !== null) o.hid = hb; } // (null: chunks still loading, asked again next time)
            const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
            if (o.hid) ctx.globalAlpha = 0.45; // behind a building: see-through, no shadow
            else { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, Math.max(4, w * 0.55), Math.max(2, 3 * sc), 0, 0, Math.PI * 2); ctx.fill(); }
            ctx.drawImage(sprites.im, sx, sy, sw, sh, x0, y0, w, h);
            ctx.globalAlpha = dim; ctx.imageSmoothingEnabled = sm;
            box = [x0, y0, x0 + w, y + 2];
          } else box = pin(ctx, x, y, SMALL_PIN[o.k] ? SMALL_PIN[o.k][0] : '#f2c66d', SMALL_PIN[o.k] ? SMALL_PIN[o.k][1] : '▲', 0.85 * sc);
        }
        if (box) hits.push([...box, { kind: 'small', o }]);
      }
    }
    // events today, this week or all coming (the range of the layer): a calendar leaf at the venue
    const evHl = focus === 'events';
    if (layers.events && (v.z >= TXT_Z || evHl)) {
      ctx.globalAlpha = evHl ? 1 : dim;
      for (const e of eventsIn(eventsRange)) {
        if (e.X == null) continue;
        const [x, y] = S(e); if (!inView(ctx, x, y)) continue;
        // the day on the leaf: the first day of the event, or today while it is running
        const bx = calendarLeaf(ctx, x, y, new Date(Math.max(e.from, dayStart())).getDate(), evHl ? 1.5 : 1, t, Math.round(e.X + e.Y)); if (bx) hits.push([...bx, { kind: 'event', o: e }]);
      }
      ctx.globalAlpha = dim;
    }
    // public transport closures valid now (layer "výluky" of the MHD group)
    if (layers.mhdOutages && v.z >= TXT_Z) {
      for (const o of outagesNow()) {
        const [x, y] = S(o); if (!inView(ctx, x, y)) continue;
        const bx = pin(ctx, x, y, '#f08a3c', '!', 0.8); if (bx) hits.push([...bx, { kind: 'outage', o }]);
      }
    }
    // the chosen themed route: a line through its stops and numbered stops
    if (route.r) {
      const st = route.r.stops;
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const path = () => { ctx.beginPath(); st.forEach((s, i) => { const [x, y] = S(s); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
      path(); ctx.strokeStyle = 'rgba(27,35,51,.85)'; ctx.lineWidth = 6; ctx.stroke();
      path(); ctx.strokeStyle = '#e58ac9'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      st.forEach((s, i) => {
        const [x, y] = S(s); if (!inView(ctx, x, y)) return;
        const r = i === route.i ? 12 : 9;
        ctx.fillStyle = '#1b2333'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = i === route.i ? '#f2c66d' : '#e58ac9'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1b2333'; ctx.font = '400 15px "VT323", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 1);
        hits.push([x - r, y - r, x + r, y + r, { kind: 'routeStop', r: route.r, i }]);
      });
    }
    ctx.globalAlpha = 1;
  }
  const at = (sx, sy) => { for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (sx >= h[0] && sx <= h[2] && sy >= h[1] && sy <= h[3]) return h[4]; } return null; };
  return {
    load, loadMonuments, detail, draw, at, match, positions, placeNear, monumentFor, outagesNow, outagesForLine, outagesNear, eventsIn, categories,
    data: D, setRoute: (r, i = -1) => { route.r = r; route.i = i; }, route: () => route,
  };
}
