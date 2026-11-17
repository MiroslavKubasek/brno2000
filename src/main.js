import OpenSeadragon from 'openseadragon';
import { createFx } from './fx.js';
import { createLayers } from './layers.js';
import { fetchWeather } from './live.js';
import { setLength } from './vehicles.js';
import { createAir, POLL, LEVEL, ADVICE, bandOf } from './air.js';
import { createWebcams } from './webcams.js';
import { createPano } from './pano.js';
import { createMeteo } from './meteo.js';
import { createVmo, VMO_STYLE } from './vmo.js';
import { ICON } from './sky.js';
import { createCity, dayStart } from './city.js';
import { createLupa, LUPA } from './lupa.js';
import { createParo, PARO_WEB } from './paro.js';
import { createPeople } from './people.js';
import { createTramPlan } from './tramplan.js';
import { createZoo } from './zoo.js';
import { createDatamap, DATAMAPS } from './datamap.js';
import { ADMIN, stripAdmin, shown } from './admin.js';
import { track, pageview, entry } from './stats.js';
import { fetchData, watchFeed } from './feed.js';
import { createQuick, placePxIcons } from './quick.js';
import { picKey, commonsFile } from '../tools/mediakeys.mjs';
import META from '../public/data/r0/meta.json';
import TILES_VERSION from '../public/data/r0/tiles-version.json';
stripAdmin(); // [ADMIN] the public build has no tuning tools
// the visit (src/stats.js): how the visitor came in, and whether the map runs as an installed app
pageview({ vstup: entry(), instalace: matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web' });

const $ = id => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;
const MEDIA = (import.meta.env.VITE_MEDIA_BASE || `${BASE}cdn/`).replace(/\/?$/, '/');
{ const el = document.getElementById('adminBadge'); if (el) el.textContent = `LADĚNÍ · místní verze · dlaždice ${import.meta.env.VITE_MEDIA_BASE ? `publikované (${new URL(MEDIA).host})` : 'místní (cdn/)'}`; }
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
let touched = false; // has the person moved the map yet?
// a phone or tablet (no fine pointer) and a wish for less motion: fewer tiles in memory, half the frame rate
const TOUCH = matchMedia('(pointer: coarse)').matches;
const CALM = TOUCH || matchMedia('(prefers-reduced-motion: reduce)').matches;

const GEO = { LON0: 16.606, LAT0: 49.201, R: META.R, A: META.A, V: META.V, Z0: META.Z0, TOP: META.TOP, W: META.W, H: META.H };
// zoom thresholds were tuned at 2 m per image pixel; S converts them
const S = GEO.A * 2;
const KX = Math.cos((GEO.LAT0 * Math.PI) / 180) * 111320, KY = 110574;
// The map is drawn in four rotations: 0 = north up, 1 = east up, 2 = south up, 3 = west up.
let ROT = 0;
const rotXY = (x, y) => (ROT === 0 ? [x, y] : ROT === 1 ? [-y, x] : ROT === 2 ? [-x, -y] : [y, -x]);
const unrotUW = (u, w) => (ROT === 0 ? [u, w] : ROT === 1 ? [w, -u] : ROT === 2 ? [-u, -w] : [-w, u]);
const imgToLonLat = (X, Y) => {
  const u = X / GEO.A - GEO.R;
  const w = GEO.R - ((Y - GEO.TOP + 60 * GEO.V) * 2) / GEO.A;
  const [x, y] = unrotUW(u, w);
  return [x / KX + GEO.LON0, y / KY + GEO.LAT0];
};
const lonLatToImg = (lon, lat) => {
  const [u, w] = rotXY((lon - GEO.LON0) * KX, (lat - GEO.LAT0) * KY);
  return [(u + GEO.R) * GEO.A, ((GEO.R - w) * GEO.A) / 2 + GEO.TOP - 60 * GEO.V];
};
const tilesUrl = s => `${MEDIA}tiles/r${ROT}/${s}/map.dzi?v=${encodeURIComponent(TILES_VERSION.rendered || '')}`; // OpenSeadragon passes the query on to every tile

// the season of a date in Brno (meteorological seasons)
const seasonOf = (d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }))) => ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][d.getMonth()];
const state = {
  season: seasonOf(), night: 0, weather: 'clear',
  // (the measuring points and the permits, i.e. air quality, webcams, weather stations and roadworks, are off at the
  // start: the map opens with the city, the transport and the events on it, the rest is a tick away in Vrstvy)
  // The themes and their levels are in src/quick.js; the starting levels: Stavby 1 (building sites), MHD 1 (vehicles and stops; the
  // closures are level 2), Doprava 3 (jams, closures, roadworks), Akce 2 (this week), Zajímavosti 1 (statues and trees), Měření 3 (air,
  // weather stations, webcams), Fotky 1. The switches in index.html start the same way.
  layers: { labels: true, traffic: true, smoke: false, hover: true, jams: true, closures: true, works: true, projects: true, mhd: true, mhdStops: true, mhdOutages: false, air: true, cams: true, meteo: true, events: true, monuments: false, people: true, zoo: true,
    // names of places (tags) off by default; building and development: building sites on, plans off
    names: false, building: true, planCity: false, planPrivate: false, bigplans: false, paro: true,
    pitka: true, wc: true, stin: true, kose: false, smView: true, smPool: true, smTree: true,
    // statues and memorials on; crosses and shrines with the monuments (level 2), memorial plaques (dense on the walls of the centre) off
    smArt: true, smCross: false, smPlaque: false,
    // street-level photos (Panoramax): light blue dots of the pictures, only zoomed well in; on by default
    pano: true },
  eventsRange: 'week', // the events layer: 'today' | 'week' | 'all' (level 1–3 of Akce)
  mhdMode: 'live',
  focus: null, // the theme chosen in the Aktuálně panel ('paro', 'events'): its points are drawn bigger, the other icons dimmed
  datamap: null, // key of the datová mapa shown (src/datamap.js), null = none
};
// the day switch (the tile at the top right, on phones above the bottom tiles): the map in daylight although it is
// evening or night in Brno; everything else stays as it is. Remembered in this browser.
let dayLock = false;
try { dayLock = localStorage.getItem('izo-day') === '1'; } catch { /* private mode */ }

// ------------------------------------------------------------------ viewer
OpenSeadragon.setImageFormatsSupported({ webp: true });
const viewer = OpenSeadragon({
  element: $('osd'),
  tileSources: tilesUrl(state.season), // the real season from the start
  showNavigationControl: false,
  imageSmoothingEnabled: false,
  maxZoomPixelRatio: 4, // (the tiles have 2 px per metre: up to 8 screen px per metre)
  minZoomImageRatio: 0.5,
  visibilityRatio: 0.3,
  animationTime: 0.7,
  springStiffness: 9,
  blendTime: 0,
  immediateRender: false,
  preserveImageSizeOnResize: true,
  gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, flickEnabled: true },
  gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchRotate: false },
  zoomPerScroll: 1.4,
  crossOriginPolicy: false,
  // decoded tiles kept in memory (1 MB each): the default 200 is too much for a phone, where Safari drops the tab
  maxImageCacheCount: TOUCH ? 80 : 200,
});
viewer.container.style.background = 'transparent';

const DETAIL = { meta: null, item: null, adding: false };
fetch(`${MEDIA}tiles/r${ROT}/detail/meta.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(m => { if (m && m.seasons && m.seasons.length) { DETAIL.meta = m; detailUpdate(); } }).catch(() => {});
const detailUrl = s => `${MEDIA}tiles/r${ROT}/detail/${s}/map.dzi?v=${encodeURIComponent(DETAIL.meta.rendered || '')}`;
function detailWanted() {
  const m = DETAIL.meta;
  if (!m || !m.seasons.includes(state.season) || !viewer.world.getItemCount()) return false;
  return view().k * (window.devicePixelRatio || 1) >= m.scale - 0.01;
}
function detailUpdate() {
  const want = detailWanted();
  if (want && !DETAIL.item && !DETAIL.adding) {
    const m = DETAIL.meta, season = state.season;
    DETAIL.adding = true;
    viewer.addTiledImage({
      tileSource: detailUrl(season), x: m.x / GEO.W, y: m.y / GEO.W, width: m.w / GEO.W, index: viewer.world.getItemCount(),
      success: ev => { DETAIL.adding = false; if (season !== state.season) { viewer.world.removeItem(ev.item); detailUpdate(); return; } DETAIL.item = ev.item; detailUpdate(); },
      error: () => { DETAIL.adding = false; },
    });
  } else if (!want && DETAIL.item) { viewer.world.removeItem(DETAIL.item); DETAIL.item = null; }
}
// (a season swap removes every other tiled image, the detail one too: setSeason calls this afterwards)
function detailReset() { DETAIL.item = null; detailUpdate(); }
viewer.addHandler('zoom', detailUpdate);
viewer.addHandler('animation-finish', detailUpdate);
// Pixel-true magnification: once the drawing is magnified (from 1.75 physical pixels per drawn pixel), the zoom settles
// after every movement on a whole number of physical pixels per drawn pixel, so all the pixels of the drawing come out
// the same size (nearest-neighbour scaling at 2.5× draws runs of 2 and 3 px). Never during a gesture, and only above
// the usual flights (1 px = 1 m and the like), which stay as they are.
viewer.addHandler('animation-finish', () => {
  const dpr = window.devicePixelRatio || 1, src = DETAIL.item ? DETAIL.meta.scale : 2;
  const ratio = (view().k * dpr) / src;
  if (ratio < 1.75) return;
  const want = Math.round(ratio);
  if (Math.abs(ratio - want) < 0.005) return;
  viewer.viewport.zoomTo(viewer.viewport.getZoom() * (want / ratio), null, false);
});

// map image px (1 px per metre, GEO.W wide) <-> screen px; computed from the viewport (0…1 across the
// map's width), so it does not depend on the resolution of the tiles
function view() {
  const vp = viewer.viewport;
  const o = vp.viewportToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
  const e = vp.viewportToViewerElementCoordinates(new OpenSeadragon.Point(1, 0));
  const k = (e.x - o.x) / GEO.W;
  return { ox: o.x, oy: o.y, k, z: k * S, S };
}
const screenToImg = (sx, sy) => { const v = view(); return [(sx - v.ox) / v.k, (sy - v.oy) / v.k]; };

function homeBounds() {
  const cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
  let dw, cx;
  let cy = ch / 2;
  if (cw > 640) {
    dw = cw >= 1440 ? cw * 0.93 : 1340;
    cx = cw >= 1440 ? cw * 0.528 : cw / 2 + 40;
    cy -= 14;
  } else { dw = 1000; cx = cw / 2 + 5; cy -= 10; }
  const zoom = dw / cw;
  const ic = (GEO.TOP + GEO.H) / 2 / GEO.W;
  return { zoom, center: new OpenSeadragon.Point(0.5 + (cw / 2 - cx) / (zoom * cw), ic + (ch / 2 - cy) / (zoom * cw)) };
}
function goHome(immediately = false) {
  const h = homeBounds();
  viewer.viewport.zoomTo(h.zoom, null, immediately);
  viewer.viewport.panTo(h.center, immediately);
}
// z: zoom on the 2 m/px scale (1 = one image pixel of the old map per screen pixel)
const isPhone = () => matchMedia('(max-width: 640px)').matches;
function flyTo(X, Y, z = 1.4, immediately = false) {
  touched = true;
  const k = z / S;
  const cw = viewer.container.clientWidth;
  const zoom = (k * GEO.W) / cw;
  viewer.viewport.zoomTo(zoom, null, immediately);
  viewer.viewport.panTo(new OpenSeadragon.Point(X / GEO.W, Y / GEO.W), immediately);
}

// ------------------------------------------------------------------ data
// positions differ per rotation (data/r<ROT>/…); the Wikipedia texts are shared
const load = f => fetch(`${BASE}data/r${ROT}/${f}`).then(r => r.json());
const loadShared = f => fetch(`${BASE}data/${f}`).then(r => r.json());
const data = { labels: [], stories: [], routes: [], chimneys: [], lights: null, wikiPois: [], streets: null };
// a file that fails to load keeps its empty default: the map still opens, only that layer is missing
const loadInto = (f, key, empty) => load(f).then(d => (data[key] = d)).catch(e => { console.warn(`data/${f}:`, e); data[key] = empty; });
const loadData = () => Promise.all([
  loadInto('stories.json', 'stories', []),
  loadInto('chimneys.json', 'chimneys', []),
  loadInto('wikipois.json', 'wikiPois', []),
  loadInto('labels.json', 'labels', []),
]);
const ready = loadData();
// the big files that are not needed to open the map come when first needed (fx.js asks for them): the roads
// (routes.json, 325 KB: the cars and the street lamps), the street names (streets.json, 230 KB: zoomed in) and the
// light map (lights.json, 540 KB: at night). A rotation drops them (lazyReset), the next need fetches them again.
const lazy = new Map();
function need(f, key, empty) {
  if (!lazy.has(f)) { const rot = ROT; lazy.set(f, load(f).then(d => { if (rot === ROT) data[key] = d; }).catch(e => { console.warn(`data/${f}:`, e); if (rot === ROT) data[key] = empty; })); }
  return lazy.get(f);
}
let lightsP = null; // the light map prepared once per rotation (fx.prepareLights is slow: it draws every light)
const lazyReset = () => { lazy.clear(); lightsP = null; data.routes = []; data.streets = null; data.lights = null; };

// building chunks for hover, click and the occlusion of cars, vehicles and people. A chunk file (b/<key>.json) has
// the geometry only: [roof outline, wall height, big (hides vehicles), group?]; the names, addresses and codes of
// the same buildings (ba/<key>.json, in the same order) are fetched when a building is clicked (withAttrs).
const CH = 1024;
const chunks = new Map(), chunkAttrs = new Map();
// an entry as the page uses it (see below); an older chunk file carries everything in one entry
const expand = e => { if (e.length > 4) { e.attrs = true; return e; } const b = [e[0], e[1], '', '', '', 0, 0, 0, '', 0, '', '']; if (e[3] !== undefined) b[12] = e[3]; b.big = !!e[2]; return b; };
// the chunks are fetched two at a time: nine of them come at once when the view moves, and parsing nine files of
// half a megabyte in the same moment froze the map for a second; this way each is parsed as it arrives
const chunkQueue = []; let chunkBusy = 0;
function pumpChunks() {
  while (chunkBusy < 2 && chunkQueue.length) {
    const [key, rot] = chunkQueue.shift();
    chunkBusy++;
    fetch(`${BASE}data/r${rot}/b/${key}.json`).then(r => (r.ok ? r.json() : [])).then(list => { if (rot === ROT) chunks.set(key, list.map(expand)); }).catch(() => { if (rot === ROT) chunks.set(key, []); })
      .finally(() => { chunkBusy--; pumpChunks(); });
  }
}
function chunk(cx, cy) {
  const key = `${cx}_${cy}`;
  if (!chunks.has(key)) {
    if (!chunks.size) queueMicrotask(() => city.loadMonuments()); // (a building card looks up the cultural monument in the building)
    chunks.set(key, null);
    chunkQueue.push([key, ROT]); pumpChunks();
  }
  return chunks.get(key);
}
// the attributes of the buildings of a chunk, merged into its entries (once)
function attrsOf(key) {
  if (!chunkAttrs.has(key)) {
    const rot = ROT;
    chunkAttrs.set(key, fetch(`${BASE}data/r${ROT}/ba/${key}.json`).then(r => (r.ok ? r.json() : [])).then(a => {
      const list = rot === ROT ? chunks.get(key) : null;
      if (list) a.forEach((x, i) => { const b = list[i]; if (b && !b.attrs) { for (let j = 0; j < 10; j++) b[j + 2] = x[j]; b.attrs = true; } });
    }).catch(() => {}));
  }
  return chunkAttrs.get(key);
}
const withAttrs = b => { if (b.attrs) return Promise.resolve(); const ci = chunkIndexOf(b); return ci ? attrsOf(ci[0]) : Promise.resolve(); };
function inPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const pieceArea = q => { const p = q[0]; let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return Math.abs(a); };
function piecesOf(b) {
  const g = b[12];
  if (g === undefined) return [b];
  const cx = Math.floor(b[0][0] / CH), cy = Math.floor(b[0][1] / CH), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const list = chunk(cx + dx, cy + dy);
    if (list) for (const q of list) if (q[12] === g) out.push(q);
  }
  if (out.length < 2) return out.length ? out : [b];
  const big = Math.max(...out.map(pieceArea)) * 0.2;
  return out.filter(q => pieceArea(q) >= big);
}
function buildingAt(X, Y) {
  const cx = Math.floor(X / CH), cy = Math.floor(Y / CH);
  let best = null, bestY = -Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const list = chunk(cx + dx, cy + dy);
    if (!list) continue;
    for (const b of list) {
      const p = b[0], hp = b[1];
      if (Math.abs(p[0] - X) > 160 * S || Math.abs(p[1] - Y) > 160 * S) continue;
      const front = p[1] + hp;
      if (front < bestY) continue;
      let hit = false;
      for (let d = 0; d <= hp + 0.01 && !hit; d += Math.max(0.5, hp / 6)) hit = inPoly(p, X, Y - d);
      if (hit) { best = b; bestY = front; }
    }
  }
  return best;
}

// Is a point on the ground hidden behind a building (seen from the south-west)? It is when it lies in the
// silhouette of a building (roof outline swept down by the wall height) but not on the building's footprint:
// the building stands in front of it. null = the building chunks around are not loaded yet (asked for now).
function hiddenBehind(X, Y) {
  const cx = Math.floor(X / CH), cy = Math.floor(Y / CH);
  let pending = false;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const list = chunk(cx + dx, cy + dy);
    if (!list) { pending = true; continue; }
    for (const b of list) {
      const p = b[0], hp = b[1];
      if (Math.abs(p[0] - X) > 160 * S || Math.abs(p[1] - Y) > 160 * S || hp < 2) continue;
      if (inPoly(p, X, Y - hp)) continue; // on the footprint: the thing stands on (or at) this building, not behind it
      for (let d = 0; d <= hp + 0.01; d += Math.max(0.5, hp / 6)) if (inPoly(p, X, Y - d)) return true;
    }
  }
  return pending ? null : false;
}

// ------------------------------------------------------------------ effects layer
const fx = createFx({ canvas: $('fx'), pins: $('pins'), viewer, view, GEO, state, data, BASE });
fx.cardOpen = () => !$('card').hidden; // the marker of a place stays while its card is open
fx.needRoutes = () => need('routes.json', 'routes', []);
fx.needStreets = () => need('streets.json', 'streets', []);
// the light map: lights.json has the grid size; the values are a greyscale image (lights.webp, lossless), decoded
// through a canvas (older data carry the values in the JSON itself, base64)
async function lightValues() {
  const L = data.lights;
  if (!L || L.d || L.raw || !L.img) return;
  try {
    const blob = await (await fetch(`${BASE}data/r${ROT}/${L.img}`)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas'); c.width = L.w; c.height = L.h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, L.w, L.h).data, raw = new Uint8Array(L.w * L.h);
    for (let i = 0; i < raw.length; i++) raw[i] = px[i * 4];
    L.raw = raw;
  } catch (e) { console.warn(`${L.img}:`, e); }
}
fx.needLights = () => (lightsP ||= Promise.all([need('lights.json', 'lights', null).then(lightValues), need('routes.json', 'routes', [])]).then(() => fx.prepareLights()));
fx.pieces = piecesOf; // the hover / selection outline covers every piece of the building
// live traffic, public transport and city projects
const layers = createLayers({ base: BASE, GEO, rotation: () => ROT, state, routes: () => { if (!data.routes.length) need('routes.json', 'routes', []); return data.routes; } }); // (routes: the lane counts for the queues of cars)
layers.mhd.wantSnap = !TOUCH; // phones: the timetable (2 MB) only for a stop or vehicle card or the timetable mode
let hoverProj = null;
// air quality stations (ČHMÚ; live values via the European Environment Agency)
const air = createAir({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
const cams = createWebcams({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
// street-level photos (Panoramax): when the open picture moves off the screen (walking along a street), the map follows
const pano = createPano({
  llToImg: (lon, lat) => layers.llToImg(lon, lat), imgToLonLat, stamp: () => layers.stamp(),
  onMove: p => {
    const v = view(); const [X, Y] = layers.llToImg(p.lon, p.lat);
    const sx = v.ox + X * v.k, sy = v.oy + Y * v.k, cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
    if (sx < 40 || sy < 40 || sx > cw - 40 || sy > ch - 40) viewer.viewport.panTo(new OpenSeadragon.Point(X / GEO.W, Y / GEO.W));
  },
});
const vmo = createVmo({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
// Zoo Brno: the paths and the enclosures with the animals (under the people, so visitors walk over the paths)
const zoo = createZoo({ base: BASE, rot: ROT, GEO, occluded: (X, Y) => occludedAt(X, Y), night: () => state.night });
fx.extra = (ctx, v, t) => { zoo.draw(ctx, v, t, state.layers.zoo); if (state.layers.bigplans) { vmo.draw(ctx, v, t); tramplan.draw(ctx, v); } people.draw(ctx, v, t, state.layers.people && !state.datamap); layers.draw(ctx, v, t, hoverProj); drawMe(ctx, v, t); };
// datové mapy: a quantity on the roofs and the ground (src/datamap.js), drawn under the traffic and the people
const datamap = createDatamap({ base: BASE, rotation: () => ROT, GEO, chunk, CH, canvasSize: () => fx.size() });
fx.under = (ctx, v) => datamap.draw(ctx, v);
// icons people click on are drawn on top of everything and win the click over labels, buildings and areas
const meteo = createMeteo({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
const city = createCity({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat), hiddenBehind });
const tramplan = createTramPlan({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
fx.projOn = p => layers.projOn(p);
const LUPA_ON = shown('lupa'); // (left out of the public version until its data are ready, see public.config.json)
// Dáme na vás: the proposals of the participatory budget vote (src/paro.js)
const paro = createParo({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) });
const lupa = LUPA_ON ? createLupa({ base: BASE, llToImg: (lon, lat) => layers.llToImg(lon, lat) }) : { load: () => Promise.resolve(), draw() {}, at: () => null, nearFountain: () => false, data: {} };
// people on the streets when zoomed in: walking along the roads, waiting at stops, getting on and off
let stopsImg = null;
const people = createPeople({
  GEO,
  walks: () => fetch(`${BASE}data/r${ROT}/walks.json`).then(r => (r.ok ? r.json() : [])),
  stops: () => {
    if (!stopsImg) { const s = layers.mhd.stops(); const keys = Object.keys(s); if (keys.length) stopsImg = keys.map(k => { const [X, Y] = layers.llToImg(s[k][1], s[k][2]); return { key: k, X, Y }; }); }
    return stopsImg || [];
  },
  vehicles: () => (state.layers.mhd ? layers.drawnVehicles() : []),
  events: () => city.eventsIn('today').filter(e => e.X != null),
  occluded: (X, Y) => occludedAt(X, Y),
  weather: () => state.weather,
});
Promise.all([lupa.load(), city.load()]).then(() => { for (const o of city.data.small) if (o.k === 'fountain' && lupa.nearFountain(o.lon, o.lat)) o.dup = true; });
// icon clusters: icons do not pile up. Each icon asks for its place (ctx.__claim); where another icon already is,
// it is left out and counted, and the first icon gets a "+N" badge (click it to zoom in). Important icons first.
let clusterHits = [];
fx.top = (ctx, v, t) => {
  if (state.layers.monuments) drawMonuments(ctx, v);
  if (data.wikiPois && data.wikiPois.length && city.data.places.length) fx.placeTags = city.match(data.wikiPois).own.map(p => [p.n, null, p.X, p.Y, 0, null, p]);
  const boxes = [];
  ctx.__claim = (x0, y0, x1, y1, important = false) => {
    const pad = 2;
    if (!important) for (const b of boxes) if (b[0] < x1 + pad && b[2] > x0 - pad && b[1] < y1 + pad && b[3] > y0 - pad) { b[4]++; return false; }
    boxes.push([x0, y0, x1, y1, 0]);
    return true;
  };
  // a theme chosen in Aktuálně: its icons bigger and at full strength, every other icon half see-through
  const F = state.focus, dim = F ? 0.5 : 1;
  ctx.globalAlpha = dim;
  if (state.layers.air) air.draw(ctx, v, t);
  if (state.layers.cams) cams.draw(ctx, v, t);
  ctx.globalAlpha = 1;
  city.draw(ctx, v, t, state.layers, F, state.eventsRange);
  ctx.globalAlpha = F === 'paro' ? 1 : dim;
  if (state.layers.paro) paro.draw(ctx, v, t, F === 'paro');
  ctx.globalAlpha = dim;
  lupa.draw(ctx, v, state.layers);
  if (state.layers.meteo) meteo.draw(ctx, v);
  ctx.globalAlpha = 1;
  pano.draw(ctx, v, t, state.layers.pano); // photographed streets and pictures; the cone of the open picture
  if ($('panoNote') && $('panoNote').textContent !== pano.status()) { $('panoNote').textContent = pano.status(); $('panoNote').hidden = !pano.status(); }
  ctx.__claim = null;
  clusterHits = [];
  ctx.font = '700 11px "Atkinson Hyperlegible", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of boxes) if (b[4]) {
    const x = b[2], y = b[1], txt = `+${b[4]}`, w = Math.max(16, ctx.measureText(txt).width + 8);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x - w / 2 - 1, y - 8, w + 2, 15);
    ctx.fillStyle = '#eef1e6'; ctx.fillRect(x - w / 2, y - 7, w, 13);
    ctx.fillStyle = '#1b2333'; ctx.fillText(txt, x, y);
    clusterHits.push([x - w / 2 - 2, y - 9, x + w / 2 + 2, y + 9, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
  }
};
const clusterAt = (sx, sy) => clusterHits.find(h => sx >= h[0] && sx <= h[2] && sy >= h[1] && sy <= h[3]);
fx.inJam = (X, Y) => layers.inJam(X, Y);
let tagStamp = -1, tagSrc = null;
function refreshProjectTags() {
  const st = layers.stamp();
  if (st === tagStamp && tagSrc === data.wikiPois && layers.proj.list) return;
  const { tags, byWiki } = layers.projectTags(data.wikiPois);
  fx.projTags = tags; fx.projByWiki = byWiki;
  tagStamp = st; tagSrc = data.wikiPois;
}

let hover = null;
viewer.addHandler('canvas-exit', () => { hover = null; fx.hover = null; if ($('dmTip')) $('dmTip').hidden = true; });
new OpenSeadragon.MouseTracker({
  element: viewer.canvas,
  moveHandler: e => {
    const v = view();
    const [X, Y] = [(e.position.x - v.ox) / v.k, (e.position.y - v.oy) / v.k];
    const crH = layers.craneAt(e.position.x, e.position.y);
    hoverProj = crH ? [crH] : v.z >= 0.25 ? layers.projectsAt(X, Y) : null;
    if (hoverProj && !hoverProj.length) hoverProj = null;
    hover = !crH && state.layers.hover && v.z >= 0.45 ? buildingAt(X, Y) : null;
    fx.hover = hover;
    dmTip(e.position.x, e.position.y, X, Y);
    const tag = wikiPoiAt(e.position.x, e.position.y);
    viewer.canvas.style.cursor = hover || tag || hoverProj || layers.vehicleAt(e.position.x, e.position.y) || (state.layers.air && air.at(e.position.x, e.position.y)) || (state.layers.cams && cams.at(e.position.x, e.position.y)) || (state.layers.pano && pano.at(e.position.x, e.position.y)) || city.at(e.position.x, e.position.y) || lupa.at(e.position.x, e.position.y) || (state.layers.paro && paro.at(e.position.x, e.position.y)) || (state.layers.meteo && meteo.at(e.position.x, e.position.y)) || (state.layers.zoo && zoo.at(e.position.x, e.position.y)) || layers.trafficAt(e.position.x, e.position.y, v) || (state.layers.projects && vmo.at(e.position.x, e.position.y, v)) ? 'pointer' : '';
  },
});
viewer.addHandler('canvas-click', e => {
  if (!e.quick) return;
  if (placing) {
    const v0 = view();
    const [lon, lat] = clickToLonLat((e.position.x - v0.ox) / v0.k, (e.position.y - v0.oy) / v0.k);
    if (placing.pick) { const p = placing.pick; placing = null; viewer.canvas.style.cursor = ''; p(lon, lat); return; }
    layers.setPosition(placing.key, lon, lat, placing.name);
    const done = placing.done;
    placing = null; viewer.canvas.style.cursor = '';
    toast('Nová poloha je uložená v tomto prohlížeči. Opravy můžete stáhnout v menu Živá data.');
    updateCorrCount();
    if (done) done();
    return;
  }
  // a "+N" cluster badge: zoom in there
  const cl = clusterAt(e.position.x, e.position.y);
  if (cl) { const v1 = view(); flyTo((cl[4] - v1.ox) / v1.k, (cl[5] - v1.oy) / v1.k, Math.min(4, v1.z * 2)); return; }
  const lb = fx.labelAt(e.position.x, e.position.y);
  if (lb && shown('datamap')) { showArea(lb); return; } // the name of a quarter: its card, not the house under the letters (the card is part of the datové mapy, public.config.json)
  // small icons first (they sit on top), then name tags, then areas and buildings
  const pd = state.layers.pano ? pano.at(e.position.x, e.position.y) : null;
  if (pd) { openPanoId(pd.id); return; } // a dot of a street-level picture
  const cam = state.layers.cams ? cams.at(e.position.x, e.position.y) : null;
  if (cam) { showCam(cam); return; }
  const pa = state.layers.paro ? paro.at(e.position.x, e.position.y) : null;
  if (pa) { showParo(pa); return; }
  const lp = lupa.at(e.position.x, e.position.y);
  if (lp) { showLupa(lp); return; }
  const ci = city.at(e.position.x, e.position.y);
  if (ci) { ({ monument: () => showMonument(ci.o), small: () => showSmall(ci.o), event: () => showEvent(ci.o), outage: () => showOutage(ci.o), routeStop: () => showRouteStop(ci.r, ci.i) })[ci.kind](); return; }
  const aq = state.layers.air ? air.at(e.position.x, e.position.y) : null;
  if (aq) { showAir(aq); return; }
  const ws = state.layers.meteo ? meteo.at(e.position.x, e.position.y) : null;
  if (ws) { showMeteo(ws); return; }
  const zp = state.layers.zoo ? zoo.at(e.position.x, e.position.y) : null;
  if (zp) { showZooPen(zp); return; }
  const veh = layers.vehicleAt(e.position.x, e.position.y);
  if (veh) { showVehicle(veh); return; }
  const cr = layers.craneAt(e.position.x, e.position.y);
  if (cr) { const v2 = view(); const [cx, cy] = [(e.position.x - v2.ox) / v2.k, (e.position.y - v2.oy) / v2.k]; const more = layers.projectsAt(cx, cy).filter(q => q !== cr); showProject(cr, more); return; }
  const stop = state.layers.mhdStops ? layers.stopAt(e.position.x, e.position.y) : null;
  if (stop) { showStop(stop, lastLine); return; }
  const wp = wikiPoiAt(e.position.x, e.position.y);
  if (wp) { showWikiPoi(wp); return; }
  const v = view();
  if (state.layers.bigplans && vmo.at(e.position.x, e.position.y, v)) { showVmo(); return; }
  if (state.layers.bigplans && tramplan.at(e.position.x, e.position.y, v)) { showTramPlan(); return; }
  const tr = layers.trafficAt(e.position.x, e.position.y, v);
  if (tr) { showTraffic(tr); return; }
  const [X, Y] = [(e.position.x - v.ox) / v.k, (e.position.y - v.oy) / v.k];
  const projs = v.z >= 0.25 ? layers.projectsAt(X, Y) : [];
  const b = v.z >= 0.45 ? buildingAt(X, Y) : null;
  if (b) withAttrs(b).then(() => showBuilding(b, projs));
  else if (projs.length) showProject(projs[0], projs.slice(1));
  else if (state.layers.pano && v.z >= pano.SHOW_FROM) panoStreet(X, Y); // a click into a street with the photo dots shown: the nearest picture
});

// ------------------------------------------------------------------ street-level photos (Panoramax) in the card
// the first look follows the map: what is up on the screen (north, east, south or west by the rotation)
const mapHeading = () => ROT * 90;
function openPano(p, heading = mapHeading()) {
  card({ kind: 'pano',
    title: 'Pohled z ulice',
    rows: [['Foceno', p.date ? new Date(p.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }) : ''], ['Autor', p.author]],
    lon: p.lon, lat: p.lat, extra: pano.section(p, { heading }),
  });
}
async function openPanoId(id) {
  toast('Načítám fotku…', 1500);
  try { openPano(await pano.byId(id)); } catch { track('Chyba', { co: 'pano-nenacten' }); toast('Server Panoramaxu teď neodpovídá, zkuste to za chvíli.'); }
}
async function panoAt(lon, lat, maxM, heading) {
  toast('Hledám fotku z ulice…', 1500);
  try {
    const p = await pano.nearest(lon, lat, maxM);
    if (p) openPano(p, heading); else { track('Chyba', { co: 'pano-zadna-fotka' }); toast('Tady z ulice žádná fotka není. Bledě modré linky ukazují, které ulice jsou nafocené.', 4000) };
  } catch { toast('Server Panoramaxu teď neodpovídá, zkuste to za chvíli.'); }
}
const panoStreet = (X, Y) => panoAt(...clickToLonLat(X, Y), 30);
// ------------------------------------------------------------------ card
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Wikipedia summaries (downloaded once while the map data was prepared)
let wikiData = null;
const wikiLoad = () => (wikiData ||= loadShared('wiki.json'));
// The card: title and basic facts, then one block per source — Wikipedia first, then city
// projects — each with a picture and a clear link to the original source.
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const srcBtn = (href, label) => { const a = el('a', 'src-btn', label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
function rowsDl(rows) { const dl = el('dl'); for (const [k, v] of rows) if (v) dl.append(el('dt', '', k), el('dd', '', v)); return dl; }
const BRNO_BRZO_MAP = 'https://experience.arcgis.com/experience/829f491bc03242ba99ba2e246056e982';
// the card of one project in the Brno Brzo map (opens straight on that project)
const brzoCard = id => `${BRNO_BRZO_MAP}?dlg=Karta-projektu#data_s=id%3AdataSource_1-190735f1807-layer-113%3A${id}`;
let siteWeb = {};
if (shown('siteweb')) loadShared('siteweb.json').then(d => { siteWeb = (d && d.items) || {}; }).catch(() => {});
const searchUrl = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
let mediaPics = {}, mediaData = null;
const mediaReady = () => (mediaData ||= fetchData(`${BASE}data/media.json`).then(r => r.json()).then(d => { mediaPics = (d && d.pics) || {}; }).catch(() => { mediaData = null; }));
mediaReady();
watchFeed('media.json', () => { mediaData = null; return mediaReady(); });
const picSizes = base => ({ s: `${MEDIA}${base}-s.webp`, m: `${MEDIA}${base}-m.webp`, l: `${MEDIA}${base}-l.webp` });
// the copies of the given originals, in their order; originals without a copy are left out
const picsOf = urls => urls.filter(isUrl).map(u => { const k = picKey(u), src = mediaPics[k]; return src ? picSizes(`img/${src}/${k}`) : null; }).filter(Boolean);
const basePics = bases => bases.map(picSizes); // pictures stored under their own names (Dáme na vás)
// one picture in a card (the card size), a click opens the big view
function picImg(p, alt, credit, cls = '') {
  const im = el('img', cls); im.src = p.m; im.alt = alt; im.loading = 'lazy'; im.decoding = 'async';
  zoomable(im, credit, p.l);
  return im;
}
// pictures of a project: the first one big, the others as small thumbnails to switch; a click opens the big view.
// null when there is nothing to show
function gallery(pics, alt, credit) {
  if (!pics.length) return null;
  const wrap = el('div', 'gallery');
  let cur = 0;
  const big = el('img'); big.alt = alt; big.loading = 'lazy'; big.referrerPolicy = 'no-referrer'; big.src = pics[0].m;
  big.title = 'Zvětšit obrázek'; big.classList.add('zoomable');
  big.onerror = () => { wrap.remove(); };
  big.onclick = () => openLightbox(pics, cur, alt, credit);
  wrap.append(big);
  if (pics.length > 1) {
    const row = el('div', 'thumbs');
    pics.forEach((pc, i) => {
      const b = el('button', i ? '' : 'on'); b.type = 'button'; b.title = `Obrázek ${i + 1} z ${pics.length}`;
      const t = el('img'); t.src = pc.s; t.alt = ''; t.loading = 'lazy'; t.referrerPolicy = 'no-referrer'; t.onerror = () => b.remove();
      b.append(t); b.onclick = () => { cur = i; big.src = pc.m; row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      row.append(b);
    });
    wrap.append(row);
  }
  wrap.append(el('span', 'credit', credit));
  return wrap;
}
// the big view of the pictures: over the whole window, arrows (and ← →) to go through them, Esc or a click outside closes
function openLightbox(pics, i, alt, credit) {
  track('Nástroj', { nastroj: 'lightbox' });
  let d = $('lightbox');
  if (!d) {
    d = el('dialog', 'lightbox'); d.id = 'lightbox';
    d.innerHTML = '<button class="px-btn close" type="button" aria-label="Zavřít">×</button><button class="px-btn lb-prev" type="button" aria-label="Předchozí obrázek">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="px-btn lb-next" type="button" aria-label="Další obrázek">›</button>';
    document.body.append(d);
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelector('.close').onclick = () => d.close();
    d.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') d.querySelector('.lb-prev').click(); if (e.key === 'ArrowRight') d.querySelector('.lb-next').click(); });
  }
  const img = d.querySelector('img'), cap = d.querySelector('figcaption');
  // (when the large picture is not there, the one shown in the card is used)
  img.onerror = () => { if (pics[i].m && img.src !== pics[i].m) img.src = pics[i].m; };
  const show = k => {
    i = (k + pics.length) % pics.length;
    img.src = pics[i].l; img.alt = alt; img.referrerPolicy = 'no-referrer';
    cap.textContent = `${alt}${pics.length > 1 ? ` · ${i + 1} / ${pics.length}` : ''} · ${credit}`;
  };
  d.querySelector('.lb-prev').hidden = d.querySelector('.lb-next').hidden = pics.length < 2;
  d.querySelector('.lb-prev').onclick = () => show(i - 1);
  d.querySelector('.lb-next').onclick = () => show(i + 1);
  show(i);
  if (!d.open) d.showModal();
}
// any single picture in a card: a click opens it in the big view (large: the address of a bigger copy, when there is one)
function zoomable(im, credit, large = '') {
  im.classList.add('zoomable'); im.title = 'Zvětšit obrázek';
  im.onclick = () => openLightbox([{ l: large || im.currentSrc || im.src, m: im.currentSrc || im.src }], 0, im.alt, credit);
  return im;
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'web projektu'; } };
const isUrl = u => /^https?:\/\//i.test(u || '');
const SITE_KIND = { residential: 'bytové domy', apartments: 'bytové domy', house: 'rodinné domy', commercial: 'komerční budovy', retail: 'obchody', office: 'kanceláře', industrial: 'průmysl', school: 'škola', kindergarten: 'mateřská škola', university: 'univerzita', hospital: 'nemocnice', hotel: 'hotel', theatre: 'divadlo', church: 'kostel', civic: 'veřejná budova', public: 'veřejná budova', transportation: 'dopravní stavba', road: 'silnice', highway: 'silnice', railway: 'železnice', rail: 'železnice', tram: 'tramvajová trať', bridge: 'most', utility_tunnel: 'kolektor', parking: 'parkoviště', yes: 'stavba', ...Object.fromEntries(Object.entries({ playground: 'dětské hřiště', pitch: 'sportovní hřiště', park: 'park', garden: 'zahrada', recreation_ground: 'rekreační plocha', dog_park: 'psí hřiště', footway: 'chodník', sidewalk: 'chodník', cycleway: 'cyklostezka', path: 'cesta', pedestrian: 'pěší zóna', square: 'náměstí' })) };
// an open-air space being redone (a playground, a park, a footpath): fenced ground, not a building site with a crane
const SOFT_SITE = new Set(['playground', 'pitch', 'park', 'garden', 'recreation_ground', 'dog_park', 'footway', 'sidewalk', 'cycleway', 'path', 'pedestrian', 'square']);
const softSite = p => SOFT_SITE.has(p.kind);
// the hatched ground of a building site can be switched off from its card: a big site covers the houses
// around it, which then cannot be clicked. The crane stays and still opens this card. Remembered in this browser.
function areaToggle(p) {
  const lab = el('label', 'areatoggle');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !layers.areaHidden(p);
  cb.onchange = () => { layers.setAreaHidden(p, !cb.checked); toast(cb.checked ? 'Plocha staveniště je zpět na mapě' : 'Plocha staveniště je skrytá, zůstal jen jeřáb (klikací)'); };
  lab.append(cb, ' Kreslit šrafovanou plochu staveniště');
  lab.title = 'Odškrtnutím plocha zmizí a přestane zakrývat okolní budovy. Stavbu pak otevře klik na jeřáb.';
  return lab;
}
// a construction site mapped in OpenStreetMap (no record in the city's project data)
function siteSection(p) {
  const s = el('div', 'sec proj');
  const sw = siteWeb[`site-${p.osmId}`] || {};
  const soft = softSite(p);
  s.append(el('h3', '', soft ? 'Úprava veřejného prostoru' : 'Staveniště'));
  if (sw.title && !p.n) s.append(el('strong', '', sw.title));
  if (!soft) s.append(areaToggle(p));
  const sg = gallery(picsOf([sw.img]), sw.title || 'Stavba', `Obrázek: ${hostOf(sw.web)}`);
  if (sg) s.append(sg);
  s.append(el('p', '', p.desc || sw.desc || (soft ? `Tady se podle OpenStreetMap opravuje ${SITE_KIND[p.kind]}: plocha je po dobu prací oplocená. Není to stavba budovy, jen úprava toho, co tu už bylo. Podrobnosti zatím v otevřených datech nejsou.` : 'Území je zakreslené jako staveniště. Podrobnosti o stavbě zatím v otevřených datech nejsou.')));
  const czDate = d => (d ? d.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ') : '');
  s.append(rowsDl([
    [soft ? 'Co se opravuje' : 'Co se staví', p.kind ? cap(SITE_KIND[p.kind] || p.kind.replace(/_/g, ' ')) : ''], ['Stavebník', p.op], ['Zahájení', p.start || sw.start], ['Dokončení plánováno', p.open || sw.end],
    ['Upraveno v OSM', czDate(p.edited)], ['Ověřeno', p.checked ? czDate(p.checked) : ''],
    ['Potvrzuje i', p.confirmedBy || 'jen OpenStreetMap (upraveno za poslední rok)'],
  ]));
  const btns = el('div', 'btns');
  const web = isUrl(p.web) ? p.web : sw.web;
  if (isUrl(web)) btns.append(srcBtn(web, 'Web stavby'));
  else btns.append(srcBtn(searchUrl(`${p.n && p.n !== 'Demolice' ? p.n : sw.title || 'stavba'} Brno${p.op ? ` ${p.op}` : ''}`), 'Hledat stavbu na webu'));
  s.append(btns);
  return s;
}
function demolSection(p) {
  const s = el('div', 'sec proj');
  s.append(el('h3', '', p.g === 'grass' || p.g === 'paved' ? 'Zbouraná budova' : 'Zbořeniště'));
  if (p.n) s.append(el('strong', '', p.n));
  const today = p.g === 'grass' ? 'je tu dnes tráva' : p.g === 'paved' ? 'je tu dnes zpevněná plocha' : 'je tu dnes zbořeniště';
  s.append(el('p', '', `Budova tu podle ${p.src === 'osm' ? 'OpenStreetMap' : '3D modelu města (2020–2023)'} ještě stála, na leteckých snímcích z jara 2025 a na ortofotu z března 2026 ale už nestojí, ${today}. Mapa ji proto nekreslí.`));
  s.append(rowsDl([['Adresa', p.addr ? `${p.addr} Brno` : ''], ['Půdorys', p.a ? `cca ${p.a} m²` : ''], ['Výška v datech', p.h ? `cca ${p.h} m` : ''], ['Staveniště v OSM', p.site ? 'ano' : '']]));
  return s;
}
function projectSection(p, showName) {
  if (p.demol) return demolSection(p);
  if (p.osm) return siteSection(p);
  const s = el('div', 'sec proj');
  s.append(el('h3', '', p.cb ? 'Co bude, Brno? · projekt města' : 'Projekt ve městě · Brno Brzo'));
  if (showName) s.append(el('strong', '', p.cb ? p.cb.t : p.n));
  if (p.st === 've výstavbě' && !p.pt) s.append(areaToggle(p));
  const sw = siteWeb[String(p.id)] || {};
  // the copies of the pictures of Brno Brzo and "Co bude, Brno?"; the project's web page when there is none
  const urls = [...(p.cb && p.cb.img ? [p.cb.img] : []), ...(p.imgs || [])];
  const pg = gallery(picsOf(urls), p.cb ? p.cb.t : p.n, p.imgsrc || (p.imgs && p.imgs.length ? 'Foto a vizualizace: Brno Brzo, Statutární město Brno' : 'Obrázek: Co bude, Brno?')) || gallery(picsOf([sw.img]), p.n, `Obrázek: ${hostOf(sw.web)}`);
  if (pg) s.append(pg);
  const txt = (p.cb && p.cb.d) || p.txt || sw.desc;
  if (txt) s.append(el('p', '', txt));
  if (p.news) s.append(el('p', 'livenote', `Aktuálně: ${p.news}`));
  s.append(rowsDl([['Stav', p.st], ['Typ', p.ty && cap(p.ty)], ['Investice', p.inv], ['Investor', p.dev], ['Architekt', p.arch], ['Adresa', p.addr], ['Městská část', p.mc],
    ['Zahájení', p.begin || (sw.start ? `${sw.start} (podle webu projektu)` : '')], ['Dokončení', p.done || (sw.end ? `${sw.end} (podle webu projektu)` : '')]]));
  const btns = el('div', 'btns');
  if (p.cb) btns.append(srcBtn(p.cb.url, 'Detail na cobude.brno.cz'));
  const web = sw.web || (isUrl(p.web) ? p.web : '');
  if (isUrl(web) && (!p.cb || web !== p.cb.url)) btns.append(srcBtn(web, 'Web projektu'));
  else if (!p.cb) btns.append(srcBtn(searchUrl(`${p.n} Brno${p.dev ? ` ${p.dev}` : ''}`), 'Hledat projekt na webu'));
  if (sw.investor && sw.investor !== web) btns.append(srcBtn(sw.investor, 'Projekty investora'));
  if (!p.pt && typeof p.id === 'number') btns.append(srcBtn(brzoCard(p.id), 'Karta projektu v Brno Brzo'));
  s.append(btns);
  return s;
}
async function card({ kind = null, title, text, rows = [], lon, lat, wiki, projects = [], extra = null, buttons = [], place = null, monument = null, link = null }) {
  // the address of the page follows the open place (#misto/…), so it can be shared or bookmarked
  if (link) history.replaceState(null, '', `#misto/${link}`); else if (location.hash.startsWith('#misto/')) history.replaceState(null, '', location.pathname + location.search);
  // what people look at (src/stats.js): the kind of the card, its name and where it was opened from; a redraw of the same card does not count
  { const key = `${kind}|${title}`; if (key !== card.last) track('Karta', { typ: kind, nazev: title, odkud: card.fromLink ? 'odkaz' : card.fromSearch ? 'hledani' : 'mapa' }); card.last = key; card.fromLink = false; }
  if (document.activeElement !== $('q') && !(card.fromSearch && Date.now() - card.fromSearch < 3000)) { $('q').value = ''; $('results').replaceChildren(); }
  card.fromSearch = 0;
  // every card about a place marks the place on the map (a caller may set a more exact position itself)
  fx.cardOpened(); fx.area = null;
  if (Number.isFinite(+lon) && Number.isFinite(+lat) && +lat) fx.markerIfNone(...layers.llToImg(+lon, +lat)); // on the terrain (dem), not the flat formula
  $('cardTitle').textContent = title;
  $('cardFig').hidden = true;
  $('cardText').hidden = !text;
  $('cardText').textContent = text || '';
  const dl = $('cardDl');
  dl.replaceChildren(...rowsDl(rows).childNodes);
  const secs = $('cardSections');
  secs.replaceChildren();
  const links = $('cardLinks');
  links.replaceChildren();
  $('card').hidden = false;
  $('cardBack').hidden = !(card.fromEvents && Date.now() - card.fromEvents < 3000); card.fromEvents = 0;
  $('card').querySelector('.sheet-body').scrollTop = 0; // a new card starts at its top
  $('fcPop').hidden = true; $('fcTile').setAttribute('aria-expanded', 'false');
  if (isPhone() && openTab) setTab(null);
  if (!$('events').hidden) setEventsOpen(false);
  cams.select(null); // a camera card selects its camera again after this
  vmo.select(false); tramplan.select(false);
  if (extra) secs.append(extra);
  else layers.selectVehicle(null);
  const token = (card.token = (card.token || 0) + 1);
  await mediaReady(); // the list of our copies of the pictures (usually already here)
  if (token !== card.token) return;
  if (wiki) {
    const w = (await wikiLoad())[wiki];
    if (token !== card.token) return;
    if (w) {
      const s = el('div', 'sec wiki');
      s.append(el('h3', '', 'Wikipedie'));
      const wp = w[2] ? picsOf([w[2]]) : []; // the lead photo of the article, from our copy
      if (wp.length) {
        const cr = el('a', '', 'Foto: Wikimedia Commons'); cr.href = `https://cs.wikipedia.org/wiki/Soubor:${encodeURIComponent(w[3] || '')}`; cr.target = '_blank'; cr.rel = 'noopener';
        const c = el('span', 'credit'); c.append(cr);
        s.append(picImg(wp[0], title, 'Foto: Wikimedia Commons'), c);
      }
      s.append(el('p', '', w[0]));
      const btns = el('div', 'btns'); btns.append(srcBtn(w[1], 'Celý článek na Wikipedii'));
      s.append(btns, el('span', 'credit', 'Text: Wikipedie, CC BY-SA 4.0'));
      secs.append(s);
    }
  }
  // GO TO BRNO for this place (matched to its Wikipedia tag, or given), then the cultural monument
  const gp = place || (wiki && city.data.places.length && data.wikiPois ? city.match(data.wikiPois).byWiki.get(wiki) : null);
  if (gp) { await city.detail(); if (token !== card.token) return; secs.append(gotobrnoSection(gp)); }
  if (monument) secs.append(monumentSection(monument));
  const seen = new Set();
  if (projects.length) { await layers.projectDetail(); if (token !== card.token) return; }
  for (const p of projects) { if (seen.has(p.id)) continue; seen.add(p.id); secs.append(projectSection(p, projects.length > 1 || (p.cb ? p.cb.t : p.n) !== title)); }
  // buttons to other maps and registers (open in a new window)
  for (const b of buttons) links.append(srcBtn(b.href, b.label));
  if (link) {
    const sh = el('button', 'src-btn', 'Sdílet odkaz na místo'); sh.type = 'button';
    sh.onclick = async () => { track('Sdílení', { co: 'misto', jak: navigator.share && matchMedia('(max-width: 640px)').matches ? 'share' : 'schranka' }); try { if (navigator.share && matchMedia('(max-width: 640px)').matches) await navigator.share({ title, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('Odkaz na místo je zkopírovaný'); } } catch { toast('Odkaz je v adresním řádku'); } };
    links.append(sh);
  }
  if (lon) {
    links.append(
      srcBtn(`https://mapy.cz/zakladni?x=${lon}&y=${lat}&z=19&source=coor&id=${lon}%2C${lat}`, 'Mapy.cz'),
      srcBtn(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`, 'OpenStreetMap'),
    );
  }
}
const projByWiki = title => ((title && fx.projByWiki && fx.projByWiki.get(title)) || []).filter(p => layers.projOn(p));
function showBuilding(b, projs = []) {
  const [poly, , name, addr, type, lon, lat, h, wiki, levels, ruian, psc] = b;
  const fullAddr = addr ? `${addr}${psc ? `, ${String(psc).replace(/^(\d{3})(\d{2})$/, '$1 $2')}` : ''} Brno` : '';
  const buttons = [];
  // the building in the official register of addresses and buildings (RÚIAN, ČÚZK), which links on to the cadastre
  if (ruian) buttons.push({ href: `https://vdp.cuzk.cz/vdp/ruian/stavebniobjekty/${ruian}`, label: 'Katastr (RÚIAN, ČÚZK)' });
  else buttons.push({ href: `https://vdp.cuzk.cz/vdp/ruian/stavebniobjekty/vyhledej`, label: 'Katastr (RÚIAN, ČÚZK)' });
  card({ kind: 'dum',
    title: name || (wiki ? wiki.replace(/ \(.*\)$/, '') : addr ? addr.split(',')[0] : cap(type)),
    rows: [['Typ', cap(type)], ['Adresa', fullAddr], ['Podlaží', levels ? String(levels) : ''], ['Výška', h ? `cca ${h} m` : ''], ['Kód budovy', ruian ? String(ruian) : '']],
    lon, lat, wiki, projects: [...projByWiki(wiki), ...projs], buttons,
    // the cultural monument in this building (Wikidata): its point is on the ground, so it is tested against the
    // footprints (the roof outlines moved down by the wall height) of all the pieces of the building, not against
    // the roof, which for a tall building covers the ground of the building behind it. Then the GO TO BRNO place
    // when the building has no Wikipedia article.
    monument: city.monumentFor(piecesOf(b).map(q => q[0].map((v, i) => (i % 2 ? v + q[1] : v))), lon, lat),
    place: wiki ? null : city.placeNear(lon, lat, name || '', 40),
  });
  // a street-level photo of the house on request (the card's sections are already replaced at this point); the street
  // may be as far from the middle of the house as the house is big (its outline in image px: 1 px = 1 m across, 2 m down)
  if (shown('pano') && Number.isFinite(+lon) && +lat) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of piecesOf(b)) for (let i = 0; i < q[0].length; i += 2) { x0 = Math.min(x0, q[0][i]); x1 = Math.max(x1, q[0][i]); y0 = Math.min(y0, q[0][i + 1]); y1 = Math.max(y1, q[0][i + 1]); }
    const half = Number.isFinite(x0) ? Math.hypot((x1 - x0) / GEO.A, (2 * (y1 - y0)) / GEO.A) / 2 : 0;
    $('cardSections').append(pano.buildingSection(+lon, +lat, Math.min(150, 35 + half), (p, heading) => pano.section(p, { heading })));
    // [ADMIN] the facade as drawn checked against the street photo
    if (ADMIN) $('cardSections').append(facadeAdmin({ lon: +lon, lat: +lat, wiki, name: name || addr || '', levels }));
  }
  // the marker in the middle of the roof as drawn (of all the pieces of the building), that is what was clicked
  if (poly && poly.length >= 6) { let sx = 0, sy = 0, n = 0; for (const q of piecesOf(b)) for (let i = 0; i < q[0].length; i += 2) { sx += q[0][i]; sy += q[0][i + 1]; n++; } fx.marker(sx / n, sy / n); }
  fx.selected = b;
  void poly;
  // what the datové mapy say about this building (their files load the first time)
  const ci = chunkIndexOf(b);
  if (ci) datamap.describe(ci[0], ci[1]).then(rows => { if (fx.selected === b && rows.length) $('cardDl').append(...rowsDl(rows).childNodes); });
}
const FAC_LS = 'izo-facades';
function ownFacades() { try { return JSON.parse(localStorage.getItem(FAC_LS) || '{}'); } catch { return {}; } }
function saveFacades(o) { try { localStorage.setItem(FAC_LS, JSON.stringify(o)); } catch { /* private mode */ } updateCorrCount(); }
const FACADE_KINDS = [['', 'druh beze změny'], ['old', 'starý dům (činžák)'], ['house', 'rodinný dům'], ['flat', 'bytový dům'], ['panel', 'panelák'], ['office', 'kanceláře (sklo)'], ['shop', 'obchod, nízká budova'], ['public', 'veřejná budova'], ['ind', 'průmysl'], ['church', 'kostel'], ['portholes', 'hladká fasáda s průhledy (Letmo)']];
function facadeAdmin({ lon, lat, wiki, name, levels }) {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  const cur = ownFacades()[key] || {};
  const box = el('div', 'sec admin-box fac');
  box.append(el('h3', '', 'Fasáda podle fotky'));
  box.append(el('p', 'livenote', 'Otevřete fotku z ulice (tlačítko výš), porovnejte ji s kresbou a zapište, co má mapa kreslit jinak. Kapátko vezme barvu přímo z fotky (Chrome).'));
  const form = el('div', 'fac-form');
  const useCol = el('input'); useCol.type = 'checkbox'; useCol.checked = !!cur.wall; useCol.title = 'Změnit barvu zdi';
  const colour = el('input'); colour.type = 'color'; colour.value = cur.wall || '#d9d2c3'; colour.oninput = () => { useCol.checked = true; };
  const drop = el('button', 'px-btn small', 'Kapátko'); drop.type = 'button'; drop.title = 'Vybrat barvu kdekoli na obrazovce, třeba z fotky z ulice';
  drop.onclick = async () => {
    if (!window.EyeDropper) { toast('Kapátko umí jen Chrome a Edge.'); return; }
    try { const r = await new window.EyeDropper().open(); colour.value = r.sRGBHex; useCol.checked = true; } catch { /* cancelled */ }
  };
  const kind = el('select'); for (const [v, l] of FACADE_KINDS) { const o = el('option', '', l); o.value = v; kind.append(o); } kind.value = cur.kind || '';
  const lv = el('input'); lv.type = 'number'; lv.min = 1; lv.max = 40; lv.placeholder = levels ? `v datech ${levels}` : 'podle fotky'; lv.value = cur.lv || '';
  const shop = el('input'); shop.type = 'checkbox'; shop.checked = !!cur.shop;
  const why = el('input'); why.type = 'text'; why.placeholder = 'co je na fotce vidět'; why.value = cur.why || '';
  const row = (label, ...els) => { const l = el('label', 'fac-row'); l.append(el('span', '', label), ...els); return l; };
  form.append(row('Barva zdi', useCol, colour, drop), row('Druh', kind), row('Podlaží', lv), row('Výloha v přízemí', shop), row('Poznámka', why));
  const btns = el('div', 'btns');
  const save = el('button', 'px-btn small', 'Uložit opravu'); save.type = 'button';
  const del = el('button', 'px-btn small', 'Smazat'); del.type = 'button'; del.hidden = !cur.at;
  const state = el('span', 'livenote', cur.at ? `Uloženo ${new Date(cur.at).toLocaleDateString('cs-CZ')}.` : '');
  save.onclick = () => {
    const o = ownFacades();
    o[key] = { lon, lat, w: wiki || undefined, name, wall: useCol.checked ? colour.value : undefined, kind: kind.value || undefined, lv: +lv.value || undefined, shop: shop.checked || undefined, why: why.value || undefined, at: new Date().toISOString() };
    saveFacades(o); state.textContent = 'Uloženo.'; del.hidden = false; toast('Oprava fasády je uložená v tomto prohlížeči.');
  };
  del.onclick = () => { const o = ownFacades(); delete o[key]; saveFacades(o); state.textContent = ''; del.hidden = true; };
  btns.append(save, del, state);
  box.append(form, btns);
  return box;
}
// the chunk (key) and the index of a building in it
function chunkIndexOf(b) {
  const cx = Math.floor(b[0][0] / CH), cy = Math.floor(b[0][1] / CH);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const list = chunk(cx + dx, cy + dy), i = list ? list.indexOf(b) : -1; if (i >= 0) return [`${cx + dx}_${cy + dy}`, i]; }
  return null;
}
// the card of a quarter (cadastral unit) under the name clicked: people, and what the datové mapy say about its houses
const fmtN = n => Math.round(n).toLocaleString('cs-CZ');
function bars(classes, counts, total, firstLabel) {
  const ul = el('ul', 'bars');
  const row = (name, colour, n) => { const li = el('li'); const sw = el('span', 'dm-sw'); sw.style.background = colour; const bar = el('span', 'bar'); const fill = el('span', 'fill'); fill.style.width = `${total ? Math.round((100 * n) / total) : 0}%`; bar.append(fill); li.append(sw, el('span', 'nm', name), bar, el('span', 'val', total ? `${Math.round((100 * n) / total)} %` : '–')); ul.append(li); };
  if (firstLabel) row(firstLabel, '#6b7280', counts[0]);
  for (const c of classes) row(c.n, c.c, c.v.reduce((a, v) => a + (counts[v] || 0), 0));
  return ul;
}
async function showArea(lb) {
  const a = await datamap.areaAt(lb.X, lb.Y);
  if (!a) { toast(`${lb.n}: statistiky jsou jen pro území města Brna`); return; }
  const flats = a.vyuziti[1] + a.vyuziti[2];
  const sec = el('div', 'sec area');
  sec.append(el('h3', '', `Hluk z dopravy u ${fmtN(flats)} domů s bydlením`), bars(DATAMAPS.hluk.classes, a.hlukB, flats, 'pod 50 dB'));
  const wet = a.povodenB.slice(1).reduce((x, y) => x + y, 0);
  sec.append(el('h3', '', `Povodeň: ${fmtN(wet)} domů s bydlením v záplavovém území`), bars(DATAMAPS.povoden.classes, a.povodenB, flats, null));
  const known = a.b - a.vyuziti[0];
  sec.append(el('h3', '', `Co je v ${fmtN(known)} domech, které průzkum zná`), bars(DATAMAPS.vyuziti.classes, a.vyuziti, known, null));
  sec.append(el('p', 'livenote', 'Podíly jsou z domů, ne z lidí. Zdroje a datum najdete v Přehledu dat (Více).'));
  card({ kind: 'ctvrt', title: a.n, text: `${a.kind === 'mc' ? 'Městská část' : a.kod === 610003 ? 'Katastrální území, historické jádro města' : 'Katastrální území'}${a.note ? `, ${a.note}` : ''}`, rows: [['Obyvatelé (sčítání 2021)', fmtN(a.pop)], ['Rozloha', `${fmtN(a.ha)} ha`], ['Hustota', a.ha ? `${fmtN(a.pop / a.ha)} obyvatel na hektar` : ''], ['Domů v mapě', fmtN(a.b)]], extra: sec });
  fx.area = a.rings;
}
function showProject(p, more = []) {
  if (p.demol) { card({ kind: 'demolice', title: p.n || (p.g === 'grass' || p.g === 'paved' ? 'Zbouraná budova' : 'Zbořeniště'), lon: p.g[0][0].toFixed(5), lat: p.g[0][1].toFixed(5), projects: [p, ...more] }); fx.marker(...layers.projectPos(p)); return; }
  if (p.osm) {
    const sw = siteWeb[`site-${p.osmId}`] || {};
    const title = p.n ? (p.n === 'Demolice' ? 'Demolice · staveniště' : p.n) : sw.title || (softSite(p) ? `Oprava: ${SITE_KIND[p.kind]}` : 'Staveniště');
    card({ kind: 'staveniste', title, lon: p.g[0][0].toFixed(5), lat: p.g[0][1].toFixed(5), projects: [p, ...more] });
    fx.marker(...layers.projectPos(p)); // the crane (or the middle of a fenced-off playground), not a corner of the site
    return;
  }
  const key = `proj:${p.id}`, title = p.cb ? p.cb.t : p.n;
  const c = layers.correction(key);
  const lon = c && c.lon ? c.lon : p.g[0][0], lat = c && c.lon ? c.lat : p.g[0][1];
  // where the location comes from, and tools to move or confirm it
  const box = el('div', 'sec locate');
  box.append(el('h3', '', 'Poloha na mapě'));
  box.append(el('p', '', `Poloha: ${layers.positionInfo(p)}.`));
  // the marker blinks where the crane stands (under construction) or in the middle of the area (planned)
  if (!ADMIN) { card({ kind: 'projekt', title, lon, lat, projects: [p, ...more], extra: box }); fx.marker(...layers.projectPos(p)); return; }
  // [ADMIN] moving / confirming the position
  box.classList.add('admin-box');
  const btns = el('div', 'btns');
  const mk = (label, fn) => { const b = el('button', 'px-btn small', label); b.type = 'button'; b.onclick = fn; return b; };
  btns.append(mk(p.pt ? 'Přesunout na správné místo' : 'Přesunout popisek', () => startPlacing(key, title, () => showProject(p, more))));
  btns.append(mk('Potvrdit, že je správně', () => { layers.confirmPosition(key, title); toast('Poloha potvrzená (uloženo v tomto prohlížeči)'); showProject(p, more); }));
  if (layers.ownCorrections()[key]) btns.append(mk('Vrátit původní', () => { layers.resetPosition(key); showProject(p, more); }));
  box.append(btns);
  card({ kind: 'projekt', title, lon, lat, projects: [p, ...more], extra: box, link: placeSlug(title) });
  fx.marker(...layers.projectPos(p));
}
// ------------------------------------------------------------------ Dáme na vás (participatory budget)
const paroDay = iso => new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
const fmtKc = n => `${Math.round(n).toLocaleString('cs-CZ')} Kč`;
const darkCol = col => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(col || ''); if (!m) return false; const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16)); return 0.299 * r + 0.587 * g + 0.114 * b < 140; };
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
// what the phase of the year is called in the card
function paroPhaseName(p) {
  const ph = paro.phase();
  return ph === 'voting' ? 'návrh v hlasování' : ph === 'before' ? 'návrh před hlasováním' : ph === 'counting' ? 'hlasování skončilo, čeká na výsledky' : p.win ? 'vítězný projekt' : 'návrh, který nevyhrál';
}
// the card of a proposal: category, text, pictures, budget, the running vote and the link to the vote
async function showParo(p, fly = false, ms) {
  await paro.detail();
  const d = paro.detailOf(p), ph = paro.phase(), y = paro.data.year;
  const s = el('div', 'sec proj paro');
  s.append(el('h3', '', `Dáme na vás ${y} · ${paroPhaseName(p)}`));
  const chip = el('span', 'paro-cat', p.cat || 'návrh'); chip.style.background = p.col || '#f2c66d'; chip.style.color = darkCol(p.col) ? '#eef1e6' : '#1b2333';
  s.append(chip);
  if (d.imgs && d.imgs.length) s.append(gallery(basePics(d.imgs), p.n, 'Obrázek: navrhovatel, Dáme na vás (damenavas.brno.cz)'));
  if (d.anot) s.append(el('p', '', d.anot));
  if (d.txt && d.txt !== d.anot) s.append(el('p', 'paro-txt', d.txt));
  if (d.benefit) { const b = el('p', 'paro-txt'); b.append(el('strong', '', 'Přínos pro veřejnost: '), d.benefit); s.append(b); }
  if (d.items && d.items.length) {
    const det = el('details', 'paro-budget'); det.append(el('summary', '', `Rozpočet po položkách (celkem ${fmtKc(p.b)})`));
    det.append(rowsDl(d.items.map(([n, c]) => [n, fmtKc(c)])));
    s.append(det);
  }
  // the vote: the count of the last data run first, then the running count from the web (while the vote is on)
  const votes = el('p', 'livenote');
  const showVotes = (v, live) => { if (!v) return; votes.textContent = `${live ? 'Hlasy právě teď' : `Hlasy k ${new Date(v.at).toLocaleDateString('cs-CZ')}`}: ${v.plus} pro, ${v.minus} proti, bilance ${v.bal > 0 ? '+' : ''}${v.bal}${p.rank ? ` · ${p.rank}. místo` : ''}.`; };
  showVotes(d.votes, false);
  if (ph === 'voting') paro.liveVotes().then(m => { const lv = m && m.get(p.id); if (lv) showVotes(lv, true); });
  s.append(votes);
  if (ph === 'voting' && paro.data.voting) s.append(el('p', 'livenote', `Hlasovat může každý s trvalým pobytem v Brně, do ${paroDay(paro.data.voting.end)} ${new Date(paro.data.voting.end).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' })}.`));
  const btns = el('div', 'btns');
  btns.append(srcBtn(d.url || `${PARO_WEB}/project/${p.id}`, ph === 'voting' ? 'Detail a hlasování na damenavas.brno.cz' : 'Detail na damenavas.brno.cz'));
  if (p.city) { const b = el('button', 'src-btn inner', 'Ostatní návrhy pro celé Brno'); b.type = 'button'; b.onclick = () => showParoCity(); btns.append(b); }
  s.append(btns);
  s.append(el('span', 'credit', 'Zdroj: otevřená data města Brna (CC BY) a Dáme na vás, damenavas.brno.cz'));
  const rows = [['Kategorie', p.cat], ['Městská část', p.city ? 'celé Brno (bez jednoho konkrétního místa)' : p.mc], ['Navrhovatel', d.prop], ['Rozpočet', p.b ? fmtKc(p.b) : '']];
  paro.positions();
  card({ kind: 'paro', title: p.n, rows, lon: p.city ? undefined : p.lon.toFixed(5), lat: p.city ? undefined : p.lat.toFixed(5), extra: s, link: placeSlug(p.n) });
  if (!p.city) { if (fly) flyTo(p.X, p.Y, Math.max(1.5, view().z)); fx.marker(p.X, p.Y, ms); if (fly && matchMedia('(max-width: 640px)').matches) setPanelOpen(false); }
}
// the proposals for the whole city: a list in a card (they have no place on the map)
async function showParoCity() {
  await paro.load();
  const ph = paro.phase(), y = paro.data.year;
  const list = paro.data.items.filter(p => p.city && (ph !== 'results' || p.win)).sort((a, b) => a.n.localeCompare(b.n, 'cs'));
  const s = el('div', 'sec proj paro');
  s.append(el('h3', '', `Dáme na vás ${y} · ${ph === 'results' ? 'vítězné návrhy pro celé Brno' : 'návrhy pro celé Brno'}`));
  const ul = el('ul', 'places paro-list');
  for (const p of list) {
    const li = el('li'), btn = el('button', '', p.n); btn.type = 'button';
    const sw = el('span', 'paro-dot'); sw.style.background = p.col || '#f2c66d'; btn.prepend(sw);
    const sm = el('small', '', ` · ${p.cat}${p.b ? `, ${fmtKc(p.b)}` : ''}`); sm.style.color = 'var(--muted)'; btn.append(sm);
    btn.onclick = () => showParo(p);
    li.append(btn); ul.append(li);
  }
  s.append(ul);
  const btns = el('div', 'btns'); btns.append(srcBtn(ph === 'voting' ? `${PARO_WEB}/` : 'https://damenavas.brno.cz/', ph === 'voting' ? 'Hlasování na damenavas.brno.cz' : 'Dáme na vás')); s.append(btns);
  card({ kind: 'paro-brno', title: `Návrhy pro celé Brno`, text: `${plural(list.length, 'návrh', 'návrhy', 'návrhů')} participativního rozpočtu, které nemají jedno konkrétní místo: týkají se celého města (sítě pítek, stromy, programy pro seniory, …). Na mapě proto cedulku nemají.`, extra: s });
  if (matchMedia('(max-width: 640px)').matches) setPanelOpen(false);
}
// the layer panel follows the phase of the year: the label, the button of the city-wide proposals, and outside the
// vote the layer starts switched off
function updateParoPanel() {
  const lab = $('paroLabel'), btn = $('paroCity'), box = $('l-paro');
  if (!lab || !paro.data.voting) return;
  const ph = paro.phase(), v = paro.data.voting, y = paro.data.year;
  lab.textContent = ph === 'voting' ? `Dáme na vás ${y}: návrhy v hlasování (do ${paroDay(v.end)})` : ph === 'before' ? `Dáme na vás ${y}: návrhy před hlasováním (od ${paroDay(v.start)})` : ph === 'counting' ? `Dáme na vás ${y}: hlasování skončilo, výsledky ${paroDay(v.announcement)}` : `Dáme na vás ${y}: vítězné projekty`;
  const cw = paro.data.items.filter(p => p.city && (ph !== 'results' || p.win));
  if (btn) { btn.hidden = !cw.length; btn.textContent = `+${plural(cw.length, 'návrh', 'návrhy', 'návrhů')} pro celé Brno (bez místa na mapě)`; btn.onclick = () => showParoCity(); }
  if (ph !== 'voting' && box && box.checked && !updateParoPanel.touched) { box.checked = false; state.layers.paro = false; secCounts(); }
}
paro.load().then(updateParoPanel);
// placing mode: the next click on the map sets the new position
let placing = null;
function startPlacing(key, name, done) {
  placing = { key, name, done };
  toast(`Klikněte do mapy na správné místo: ${name}`);
  viewer.canvas.style.cursor = 'crosshair';
}
// screen point -> lon/lat on the hilly map (refined twice against the terrain)
function clickToLonLat(X, Y) {
  let [lon, lat] = imgToLonLat(X, Y);
  const [l0, a0] = imgToLonLat(0, 0);
  for (let i = 0; i < 4; i++) {
    const [x2, y2] = layers.llToImg(lon, lat);
    const [l1, a1] = imgToLonLat(X - x2, Y - y2); // the same pixel error expressed in lon/lat
    lon += l1 - l0; lat += a1 - a0;
  }
  return [lon, lat];
}
function downloadCorrections() {
  const data = { note: 'Opravy poloh a fasád z mapy Brno 2000.', created: new Date().toISOString(), items: layers.ownCorrections(), camdirs: cams.own(), facades: ownFacades() };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'corrections.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// a tram, trolleybus or bus: where it goes and its stops with times
function showVehicle(m) {
  const NAME = { tram: 'Tramvaj', trol: 'Trolejbus', bus: 'Autobus' };
  const hhmm = sec => { const s = ((sec % 86400) + 86400) % 86400; return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
  // The timetable (the trip, its route and stops) is loaded on demand on phones: until it is here, the card says so
  // and is drawn again once it arrives (the same vehicle, with its position of that moment).
  showVehicle.cur = m.id;
  const ready = layers.mhd.ready();
  if (!ready) layers.mhd.load().then(() => { if (showVehicle.cur === m.id && !$('card').hidden) showVehicle(layers.drawnVehicles().find(x => x.id === m.id) || m); });
  // a live vehicle is matched to its trip in the timetable; its real delay shifts the stop times
  const plan = m.live ? layers.matchPlan(m) : m;
  const delayMin = m.live ? Math.round(m.delay || 0) : null;
  const delayTxt = delayMin === null ? 'neznámé (vozidlo podle jízdního řádu)' : delayMin > 0 ? `+${delayMin} min (zpožděné)` : delayMin < 0 ? `${delayMin} min (jede napřed)` : 'včas';
  const it = plan ? layers.mhd.itinerary(plan) : [];
  if (m.live && it.length) {
    const now = (() => { const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).split(' ')[1].split(':').map(Number); return s[0] * 3600 + s[1] * 60 + s[2]; })();
    let nextSet = false;
    for (const o of it) { const exp = o.time + delayMin * 60; if (exp <= now) o.state = 'past'; else if (!nextSet) { o.state = 'next'; nextSet = true; } else o.state = 'later'; }
  }
  const next = it.find(o => o.state === 'next');
  const sec = el('div', 'sec itin');
  // "Nasednout": the map moves along with the vehicle, kept in the middle (dragging the map gets you off)
  const rideB = el('button', 'px-btn ride-btn', ride === m.id ? '■ Vystoupit' : '▶ Nasednout');
  rideB.type = 'button'; rideB.dataset.id = String(m.id); rideB.title = 'Mapa pojede s vozem, ten zůstane uprostřed';
  rideB.onclick = () => { if (ride === m.id) stopRide(); else startRide(m); };
  const rb = el('div', 'btns'); rb.append(rideB);
  sec.append(rb, el('h3', '', m.live ? 'Jízdní řád spoje a skutečnost' : 'Jízdní řád tohoto spoje'));
  if (it.length) {
    const ol = el('ol', 'itinerary');
    const reqSeen = new Set();
    for (const o of it) {
      const li = el('li', o.state);
      const st = el('span', 'st', o.name);
      // request stops as in printed timetables: × (all day) or × with "v noci" (only 22–5 h)
      if (o.reqKind) {
        const mk = el('span', `rq${o.req ? '' : ' off'}`, o.reqKind === 'n' ? '× v noci' : '×');
        mk.title = o.reqKind === 'n' ? `Zastávka na znamení jen v noci (22–5 h)${o.req ? '' : ', tento spoj tu zastaví vždy'}` : 'Zastávka na znamení: vystupte stisknutím tlačítka, na zastávce dejte řidiči znamení';
        st.append(' ', mk); reqSeen.add(o.reqKind);
      }
      li.append(el('span', 'tm', hhmm(o.time)), st);
      // a stop in the itinerary opens that stop's departures for this line
      if (o.num) { li.classList.add('link'); li.title = 'Odjezdy z této zastávky'; li.onclick = () => showStopByNum(o.num, m.line); }
      if (m.live && delayMin) li.append(el('span', `exp ${delayMin > 0 ? 'late' : 'early'}`, hhmm(o.time + delayMin * 60)));
      ol.append(li);
    }
    sec.append(ol);
    if (reqSeen.size) sec.append(el('p', 'livenote', `× zastávka na znamení: kdo chce vystoupit, stiskne tlačítko, kdo chce nastoupit, dá na zastávce řidiči znamení.${reqSeen.has('n') ? ' „× v noci“ platí jen 22–5 h.' : ''}`));
  } else sec.append(el('p', '', ready ? 'K tomuto vozidlu se nepodařilo najít spoj v jízdním řádu.' : 'Načítám jízdní řád…'));
  sec.append(el('span', 'credit', m.live
    ? 'Poloha a zpoždění: živý proud KORDIS JMK (data.brno.cz, CC BY). Jízdní řád IDS JMK © KORDIS JMK.'
    : 'Poloha podle jízdního řádu IDS JMK © KORDIS JMK. Živé polohy zapnete v menu Živá data → MHD → Živé polohy.'));
  const from = it.length ? it[0].name : '';
  const to = m.live ? layers.mhd.stopName(m.final) || (it.length ? it[it.length - 1].name : '') : m.hs || (it.length ? it[it.length - 1].name : '');
  card({ kind: 'vozidlo',
    title: `${NAME[m.type]} ${m.line} → ${to}`,
    rows: [
      ['Linka', `${m.line} (${NAME[m.type].toLowerCase()})`], ['Odkud', from], ['Kam', to],
      ['Poslední zastávka', m.live ? layers.mhd.stopName(m.last) : ''],
      ['Další zastávka', next ? `${next.name} v ${hhmm(next.time + (delayMin || 0) * 60)}` : ''],
      ['Zpoždění', delayTxt],
      ['Aktualizace', m.live && m.at ? new Date(m.at).toLocaleTimeString('cs-CZ') : ''],
      ['Nízkopodlažní', m.live ? (m.lowFloor ? 'ano' : 'ne') : ''],
      ['Vůz', m.live && m.vid ? [m.vid, m.idb, m.idc].filter(x => x > 0).map(x => `ev. č. ${x}`).join(' + ') : ''],
      ['Výluka', city.outagesForLine(m.line).map(o => o.title).slice(0, 3).join('; ') ? `linka má výluku: ${city.outagesForLine(m.line).map(o => o.title).slice(0, 3).join('; ')}` : ''],
      ['Souprava', m.live && m.vid ? (() => { const n = [m.vid, m.idb, m.idc].filter(x => x > 0).length; return `${n === 1 ? 'jeden vůz' : n === 2 ? 'dva spojené vozy' : 'tři spojené vozy'}, asi ${Math.round(setLength(m.type, [m.vid, m.idb, m.idc]).len)} m`; })() : ''],
    ],
    extra: sec,
  });
  layers.selectVehicle(m.id);
  lastLine = m.line;
  layers.setRoute(plan);
  setTimeout(() => { const n = document.querySelector('.itinerary li.next'); if (n) n.scrollIntoView({ block: 'nearest' }); }, 60);
}
// ------------------------------------------------------------------ a stop: departures, arrivals, timetable
let lastLine = null; // the line of the last vehicle opened — preselected at its stops
function showStopByNum(num, line) {
  const s = layers.mhd.stops()[num];
  if (!s) return;
  const [X, Y] = layers.llToImg(s[1], s[2]);
  flyTo(X, Y, Math.max(view().z, 1.1));
  showStop({ num: String(num), name: s[0], X, Y }, line);
}
function showStop(st, line = null) {
  const mhd = layers.mhd;
  // the departures need the timetable: the card opens at once and fills in when it has come
  showStop.cur = st;
  if (!mhd.ready()) mhd.load().then(() => { if (showStop.cur === st && !$('card').hidden) showStop(st, line); });
  const days = mhd.dayChoices();
  const ui = { tab: 'dep', line: null, day: 'today', trip: null }; // trip: the departure whose route is shown on the map
  const allToday = mhd.calls(st.num, days.today);
  const lines = [...new Set(mhd.calls(st.num, days.work).concat(allToday).map(c => c.line))].sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 999) - (parseInt(b.replace(/\D/g, '')) || 999) || a.localeCompare(b));
  if (line && lines.includes(line)) ui.line = line;
  const typeOfLine = l => { const c = allToday.find(x => x.line === l); return c ? c.type : 'bus'; };
  const hhmm = sec => { const s = ((sec % 86400) + 86400) % 86400; return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
  const badge = l => { const b = el('span', `lbadge t-${typeOfLine(l)}`, l); return b; };
  const box = el('div', 'sec stopbox');
  const render = () => {
    box.replaceChildren();
    // tabs
    const tabs = el('div', 'tabs');
    for (const [k, label] of [['dep', 'Odjezdy'], ['arr', 'Příjezdy'], ['tt', 'Jízdní řád']]) {
      const b = el('button', 'px-btn small', label); b.type = 'button'; b.setAttribute('aria-pressed', String(ui.tab === k));
      b.onclick = () => { ui.tab = k; render(); };
      tabs.append(b);
    }
    box.append(tabs);
    // line filter
    const lf = el('div', 'linefilter');
    const all = el('button', 'px-btn small', 'Všechny linky'); all.type = 'button'; all.setAttribute('aria-pressed', String(!ui.line));
    all.onclick = () => { ui.line = null; render(); };
    lf.append(all);
    for (const l of lines) {
      const b = el('button', `lbtn t-${typeOfLine(l)}`, l); b.type = 'button'; b.setAttribute('aria-pressed', String(ui.line === l));
      b.onclick = () => { ui.line = ui.line === l ? null : l; if (ui.tab === 'tt' && !ui.line) ui.line = l; render(); };
      lf.append(b);
    }
    box.append(lf);
    const delays = layers.liveDelays();
    const now = mhd.now().sec;
    if (ui.tab === 'dep' || ui.tab === 'arr') {
      // the next calls from now (today, and after midnight the early ones of tomorrow are not included)
      const arr = ui.tab === 'arr';
      const list = allToday.filter(c => (!ui.line || c.line === ui.line) && (arr ? !c.first : !c.last));
      const upcoming = list.filter(c => c.sec + (delays.get(c.trip) || 0) * 60 >= now - 60).slice(0, 25);
      const ol = el('ol', 'deps');
      if (!upcoming.length) ol.append(el('li', 'empty', 'Dnes už odsud nic nejede.'));
      for (const c of upcoming) {
        const d = delays.get(c.trip);
        const exp = c.sec + (d || 0) * 60;
        const li = el('li');
        const mins = Math.round((exp - now) / 60);
        li.append(el('span', 'tm', hhmm(c.sec)), badge(c.line), el('span', 'dir', `${arr ? '' : '→ '}${c.hs}`));
        const right = el('span', 'eta');
        if (d !== undefined) { right.append(el('span', `exp ${d > 0 ? 'late' : d < 0 ? 'early' : 'ok'}`, d ? `${hhmm(exp)} (${d > 0 ? '+' : ''}${d})` : 'včas')); }
        right.append(el('small', '', mins <= 0 ? 'teď' : `za ${mins} min`));
        li.append(right);
        // a click shows the route this departure takes (its stops with it), a second click hides it again
        li.classList.add('link'); li.classList.toggle('sel', ui.trip === c.trip); li.title = ui.trip === c.trip ? 'Skrýt trasu spoje' : 'Ukázat na mapě trasu tohoto spoje';
        li.onclick = () => { ui.trip = ui.trip === c.trip ? null : c.trip; layers.setRoute(ui.trip == null ? null : mhd.tripRoute(ui.trip)); render(); };
        ol.append(li);
      }
      box.append(ol);
      box.append(el('span', 'credit', 'Čas podle jízdního řádu; u vozidel, která právě jedou, je vedle skutečný očekávaný čas podle živé polohy (KORDIS JMK).'));
    } else {
      // the full timetable like the one on the stop pole: per direction, hours and minutes
      const dl = el('div', 'tabs');
      for (const k of ['today', 'work', 'sat', 'sun']) {
        const b = el('button', 'px-btn small', days[k].label); b.type = 'button'; b.setAttribute('aria-pressed', String(ui.day === k));
        b.onclick = () => { ui.day = k; render(); };
        dl.append(b);
      }
      box.append(dl);
      if (!ui.line) { ui.line = lines[0]; render(); return; }
      const calls = mhd.calls(st.num, days[ui.day]).filter(c => c.line === ui.line && !c.last);
      const dirs = [...new Set(calls.map(c => c.hs))];
      if (!calls.length) box.append(el('p', '', 'V tento den linka ze zastávky nejede.'));
      for (const dir of dirs) {
        const t = el('div', 'tt');
        t.append(el('h4', '', `Linka ${ui.line} → ${dir}`));
        const byHour = new Map();
        for (const c of calls.filter(c => c.hs === dir)) { const h = Math.floor((c.sec % 86400) / 3600); if (!byHour.has(h)) byHour.set(h, []); byHour.get(h).push(String(Math.floor((c.sec % 3600) / 60)).padStart(2, '0')); }
        const tbl = el('div', 'ttgrid');
        for (const [h, mins] of [...byHour.entries()].sort((a, b) => ((a[0] + 21) % 24) - ((b[0] + 21) % 24))) {
          tbl.append(el('span', 'hh', String(h)), el('span', 'mm', mins.join('  ')));
        }
        t.append(tbl);
        box.append(t);
      }
      box.append(el('span', 'credit', 'Jízdní řád IDS JMK © KORDIS JMK.'));
    }
  };
  render();
  if (!mhd.ready()) box.prepend(el('p', '', 'Načítám jízdní řád…'));
  // closures and diversions (IDS JMK) near this stop that touch its lines
  const ll = (layers.mhd.stops()[st.num] || []);
  const outs = ll.length ? city.outagesNear(ll[1], ll[2], lines, 400) : [];
  const wrap = el('div');
  for (const o of outs) { const n = el('button', 'outage-note', `⚠ Výluka: ${o.title} (linky ${o.lines.join(', ')})`); n.type = 'button'; n.onclick = () => showOutage(o); wrap.append(n); }
  wrap.append(box);
  card({ kind: 'zastavka', title: `Zastávka ${st.name}`, rows: [['Linky', lines.join(', ')]], extra: wrap });
  fx.marker(st.X, st.Y);
  layers.selectStop(st.num);
  // keep the departures fresh while the card is open
  clearInterval(showStop.timer);
  showStop.timer = setInterval(() => { if ($('card').hidden || !box.isConnected) { clearInterval(showStop.timer); layers.selectStop(null); if (ui.trip != null) layers.setRoute(null); return; } if (ui.tab !== 'tt') render(); }, 30000);
}

// ------------------------------------------------------------------ air quality station card
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
// a small line chart: points [[ms, value]], the "worse air" limit of the pollutant as a dashed line
function airChart(points, p, labelFmt) {
  const Wc = 300, Hc = 120, L = 30, B = 18, T = 8;
  const svg = svgEl('svg', { viewBox: `0 0 ${Wc} ${Hc}`, class: 'airchart', role: 'img' });
  const pts = points.filter(q => q[1] != null);
  if (pts.length < 2) { const t = svgEl('text', { x: Wc / 2, y: Hc / 2, 'text-anchor': 'middle', class: 'ax' }); t.textContent = 'Data nejsou k dispozici'; svg.append(t); return svg; }
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const lim = POLL[p].th[1]; // above this the air is "zhoršená"
  const max = Math.max(lim * 1.15, ...pts.map(q => q[1])) * 1.05;
  const X = t => L + ((t - t0) / (t1 - t0 || 1)) * (Wc - L - 4), Y = v => T + (1 - v / max) * (Hc - T - B);
  // coloured level bands in the background
  const th = [0, ...POLL[p].th, Infinity];
  for (let b = 1; b <= 6; b++) {
    const lo = th[b - 1], hi = Math.min(th[b], max);
    if (lo >= max) break;
    svg.append(svgEl('rect', { x: L, y: Y(hi), width: Wc - L - 4, height: Y(lo) - Y(hi), fill: LEVEL[b].c, opacity: 0.18 }));
  }
  svg.append(svgEl('line', { x1: L, x2: Wc - 4, y1: Y(lim), y2: Y(lim), class: 'lim' }));
  // line with gaps where data are missing
  let d = '', pen = false;
  for (const [t, v] of points) { if (v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
  svg.append(svgEl('path', { d, class: 'ln' }));
  const tx = (x, y, s, a = 'start') => { const e = svgEl('text', { x, y, 'text-anchor': a, class: 'ax' }); e.textContent = s; svg.append(e); };
  tx(L - 3, Y(0) + 3, '0', 'end'); tx(L - 3, Y(lim) + 3, String(lim), 'end');
  tx(L, Hc - 4, labelFmt(t0)); tx(Wc - 4, Hc - 4, labelFmt(t1), 'end');
  return svg;
}
// temperature of a private weather station over the last 24 hours: the line, a dashed 0 °C line and a blue band
// below it, so a night under zero is seen at a glance
function tempChart(points) {
  const Wc = 300, Hc = 120, L = 40, B = 18, T = 8;
  const svg = svgEl('svg', { viewBox: `0 0 ${Wc} ${Hc}`, class: 'airchart tempchart', role: 'img' });
  const vals = points.filter(q => q[1] != null).map(q => q[1]);
  if (vals.length < 2) { const t = svgEl('text', { x: Wc / 2, y: Hc / 2, 'text-anchor': 'middle', class: 'ax' }); t.textContent = 'Průběh teploty se teprve sbírá'; svg.append(t); return svg; }
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = Math.max(1, (Math.max(0, mx) - Math.min(0, mn)) * 0.12);
  const lo = Math.min(0, mn) - pad, hi = Math.max(0, mx) + pad; // 0 °C is always in the picture
  const X = t => L + ((t - t0) / (t1 - t0 || 1)) * (Wc - L - 6), Y = v => T + ((hi - v) / (hi - lo)) * (Hc - T - B);
  svg.append(svgEl('rect', { x: L, y: Y(0).toFixed(1), width: Wc - L - 6, height: (Y(lo) - Y(0)).toFixed(1), class: 'frost' }));
  svg.append(svgEl('line', { x1: L, x2: Wc - 6, y1: Y(0).toFixed(1), y2: Y(0).toFixed(1), class: 'zero' }));
  // line with gaps where an hour is missing, a dot per hour (blue below zero)
  let d = '', pen = false;
  for (const [t, v] of points) { if (v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
  svg.append(svgEl('path', { d, class: 'ln' }));
  for (const [t, v] of points) if (v != null) svg.append(svgEl('rect', { x: (X(t) - 1.5).toFixed(1), y: (Y(v) - 1.5).toFixed(1), width: 3, height: 3, class: v < 0 ? 'pt cold' : 'pt' }));
  const tx = (x, y, s, a = 'start') => { const e = svgEl('text', { x, y, 'text-anchor': a, class: 'ax' }); e.textContent = s; svg.append(e); };
  const deg = v => `${v.toFixed(1).replace('.', ',').replace('-', '−')} °`;
  tx(L - 3, Y(0) + 3, '0 °C', 'end');
  if (Math.abs(Y(mx) - Y(0)) > 9) tx(L - 3, Y(mx) + 3, deg(mx), 'end');
  if (Math.abs(Y(mn) - Y(0)) > 9 && Math.abs(Y(mn) - Y(mx)) > 9) tx(L - 3, Y(mn) + 3, deg(mn), 'end');
  // the hours along the bottom: every 6 hours of local time
  for (const [t] of points) { const h = new Date(t).getHours(); if (h % 6 === 0) { svg.append(svgEl('line', { x1: X(t).toFixed(1), x2: X(t).toFixed(1), y1: Hc - B, y2: Hc - B + 3, class: 'tick' })); tx(X(t).toFixed(1), Hc - 4, `${h}:00`, 'middle'); } }
  return svg;
}
async function showAir(s) {
  await air.load();
  const st = air.state(s);
  const lv = air.live(s.c);
  const comps = Object.keys(POLL).filter(p => s.comps.includes(p) || (st && st.vals[p] != null) || (lv && lv.series[p]));
  const time = st ? new Date(st.t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const sec = el('div', 'sec air');
  sec.append(el('h3', '', st && st.live ? 'Aktuální hodnoty (hodinový průměr)' : 'Poslední známé hodnoty'));
  if (st) {
    const tb = el('table', 'airvals');
    for (const p of comps) {
      const v = st.vals[p];
      if (v == null) continue;
      const b = bandOf(p, v);
      const tr = el('tr');
      const lvl = el('td'); const chip = el('span', 'lvl', b ? LEVEL[b].n : '–'); if (b) { chip.style.background = LEVEL[b].c; if (b >= 5) chip.style.color = '#fff'; } lvl.append(chip);
      tr.append(el('td', '', `${POLL[p].n}`), el('td', 'num', `${Math.round(v * 10) / 10} µg/m³`), lvl);
      tr.title = POLL[p].long;
      tb.append(tr);
    }
    sec.append(tb);
    // what to do now, and what the measured substances are
    if (st.band) { const adv = el('p', 'air-advice'); adv.style.borderColor = LEVEL[st.band].c; adv.append(el('b', '', 'Co dělat: '), ADVICE[st.band]); sec.append(adv); }
    const ex = el('details', 'air-explain'); ex.append(el('summary', '', 'Co znamenají zkratky (PM10, NO₂…)'));
    for (const p of comps) if (POLL[p].what) { const d = el('p'); d.append(el('b', '', `${POLL[p].n} – ${POLL[p].long}: `), POLL[p].what); ex.append(d); }
    ex.append(el('p', 'livenote', 'Hodnoty jsou v mikrogramech na metr krychlový (µg/m³), hodinové průměry. Úrovně podle evropského indexu kvality ovzduší (EEA). Při smogové situaci vydává upozornění ČHMÚ.'));
    sec.append(ex);
    sec.append(el('p', 'livenote', `Měřeno ${time}${st.live ? '' : ' (živá data teď nejsou k dispozici, ukazuji poslední hodnoty z otevřených dat ČHMÚ)'}.`));
  } else sec.append(el('p', '', s.live ? 'Aktuální hodnoty teď nejsou k dispozici (stanice posílá data jen občas nebo má výpadek).' : 'Tato stanice měří, ale její hodnoty nejsou volně dostupné v otevřených datech ČHMÚ ani u Evropské agentury pro životní prostředí. Proto je její světlo šedé.'));
  // charts: last week (hourly) and since the start of the year (daily means)
  const charts = el('div', 'sec air');
  charts.append(el('h3', '', 'Grafy'));
  const chips = el('div', 'chips2');
  const box = el('div');
  let cur = (st && st.culprit && comps.includes(st.culprit)) ? st.culprit : comps[0];
  const fmtD = t => new Date(t).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  function render() {
    chips.replaceChildren(...comps.map(p => { const b = el('button', 'px-btn', POLL[p].n); b.type = 'button'; b.setAttribute('aria-pressed', String(p === cur)); b.title = POLL[p].long; b.onclick = () => { cur = p; render(); }; return b; }));
    box.replaceChildren();
    // week: live series from the EEA (13 days, last 7 shown) or the prepared ČHMÚ hours
    const weekAgo = Date.now() - 7 * 864e5;
    let wk = lv && lv.series[cur] ? lv.series[cur].filter(q => q[0] >= weekAgo) : [];
    if (wk.length < 24 && s.hour && s.hour.v[cur]) { const h0 = Date.parse(s.hour.start + ':00:00Z'); wk = s.hour.v[cur].map((v, i) => [h0 + i * 36e5, v]).filter(q => q[0] >= weekAgo); }
    // fill missing hours so gaps show as gaps
    if (wk.length) { const m = new Map(wk.map(q => [q[0], q[1]])); const out = []; for (let t = wk[0][0]; t <= wk[wk.length - 1][0]; t += 36e5) out.push([t, m.has(t) ? m.get(t) : null]); wk = out; }
    box.append(el('p', 'label', `Poslední týden · ${POLL[cur].long} (hodinové hodnoty, µg/m³)`), airChart(wk, cur, fmtD));
    if (s.day && s.day.v[cur]) {
      const d0 = Date.parse(s.day.start + 'T00:00:00Z');
      const yr = s.day.v[cur].map((v, i) => [d0 + i * 864e5, v]);
      box.append(el('p', 'label', `Od ${new Date(d0).toLocaleDateString('cs-CZ')} · denní průměry (µg/m³)`), airChart(yr, cur, t => new Date(t).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: '2-digit' })));
    } else box.append(el('p', 'livenote', 'Delší historie této stanice v otevřených datech ČHMÚ není.'));
    box.append(el('p', 'livenote', 'Barevné pásy: úrovně evropského indexu kvality ovzduší (EEA). Čárkovaná čára: od této hodnoty je ovzduší zhoršené.'));
  }
  if (comps.length) { render(); charts.append(chips, box); }
  const wrap = el('div'); wrap.append(sec, charts);
  const src = el('div', 'sec');
  src.append(el('p', 'credit', `Zdroj: ČHMÚ (měření), živá data přes Evropskou agenturu pro životní prostředí (EEA); historie: otevřená data ČHMÚ, staženo ${air.updated()}.`));
  wrap.append(src);
  card({ kind: 'ovzdusi',
    title: `${s.n} · kvalita ovzduší`,
    text: st && st.band ? `Ovzduší je teď ${LEVEL[st.band].n}${st.band >= 3 ? ` – nejhorší je ${POLL[st.culprit].long}` : ''}.` : '',
    rows: [['Stanice', s.kind ? `${s.kind}` : ''], ['Síť', s.net], ['Měří', s.comps.map(p => POLL[p] ? POLL[p].n : p).join(', ')]],
    lon: s.lon, lat: s.lat, extra: wrap,
    buttons: [
      { href: 'https://opendata.chmi.cz/air_quality/', label: 'Otevřená data ČHMÚ' },
      { href: 'https://airindex.eea.europa.eu/AQI/index.html', label: 'Evropský index kvality ovzduší' },
    ],
  });
}
// webcam: a preview in the card (picture refreshed while the card is open, or an embedded player)
function showCam(g) {
  // several cameras on one spot: chips to switch between their views
  const views = g.views || [g];
  const wrap = el('div');
  const chips = el('div', 'chips2');
  const body = el('div');
  const dirBox = el('div', 'sec camdir');
  let cur = 0;
  const pick = i => {
    cur = i;
    chips.replaceChildren(...views.map((v, j) => { const b = el('button', 'px-btn', views.length > 4 ? String(j + 1) : v.view.replace(/^.*?(pohled|směr)/, '$1')); b.type = 'button'; b.title = v.view; b.setAttribute('aria-pressed', String(j === cur)); b.onclick = () => pick(j); return b; }));
    body.replaceChildren(camView({ ...views[i], name: g.name }));
    cams.select(g, i);
    renderDir();
  };
  // which way the camera looks: shown as a cone in the map, can be corrected here
  const COMPASS = ['sever', 'severovýchod', 'východ', 'jihovýchod', 'jih', 'jihozápad', 'západ', 'severozápad'];
  function renderDir() {
    const v = views[cur];
    const d = cams.dirOf(v);
    dirBox.replaceChildren(el('h3', '', 'Kam se kamera dívá'));
    dirBox.append(el('p', '', `Na ${COMPASS[Math.round(d / 45) % 8]} (${Math.round(d)}°) – ${cams.dirSrcOf(v)}. Žlutá výseč v mapě ukazuje záběr.`));
    if (!ADMIN) return;
    // [ADMIN] tuning: move the camera, turn it, make the view wider / narrower, longer / shorter
    const adm = el('div', 'admin-box');
    adm.append(el('p', 'livenote', `Záběr ${Math.round(cams.fovOf(v))}° široký, ${Math.round(cams.reachOf(g, v))} m daleko.`));
    const btns = el('div', 'btns');
    const done = (msg) => { renderDir(); updateCorrCount(); if (msg) toast(msg); };
    const mk = (label, fn, title) => { const b = el('button', 'px-btn small', label); b.type = 'button'; if (title) b.title = title; b.onclick = fn; btns.append(b); return b; };
    const pickMap = (hint, fn) => { placing = { pick: (lon, lat) => fn(lon, lat) }; toast(hint); viewer.canvas.style.cursor = 'crosshair'; };
    mk('Přesunout kameru', () => pickMap('Klikněte do mapy na místo, kde kamera skutečně je.', (lon, lat) => { cams.setFix(v, { lon, lat }); done('Poloha kamery je uložená v tomto prohlížeči.'); }), 'Další klik do mapy určí, kde kamera stojí');
    mk('Kam se dívá (klik)', () => pickMap('Klikněte do mapy na místo, na které se kamera dívá. Výseč tam natočí i protáhne.', (lon, lat) => { const [dir, dist] = cams.dirTo(g, v, lon, lat); cams.setFix(v, { dir, reach: dist }); done('Směr a délka záběru jsou uložené v tomto prohlížeči.'); }), 'Další klik do mapy určí směr i délku záběru');
    mk('⟲ 15°', () => { cams.setFix(v, { dir: d - 15 }); done(); }, 'Otočit doleva');
    mk('⟳ 15°', () => { cams.setFix(v, { dir: d + 15 }); done(); }, 'Otočit doprava');
    mk('Užší', () => { cams.setFix(v, { fov: cams.fovOf(v) - 10 }); done(); }, 'Zúžit záběr o 10°');
    mk('Širší', () => { cams.setFix(v, { fov: cams.fovOf(v) + 10 }); done(); }, 'Rozšířit záběr o 10°');
    mk('Kratší', () => { cams.setFix(v, { reach: cams.reachOf(g, v) * 0.75 }); done(); }, 'Zkrátit záběr');
    mk('Delší', () => { cams.setFix(v, { reach: cams.reachOf(g, v) * 1.33 }); done(); }, 'Prodloužit záběr');
    if (cams.own()[v.id] !== undefined) mk('Vrátit původní', () => { cams.setFix(v, null); done(); });
    adm.append(btns);
    dirBox.append(adm);
  }
  if (views.length > 1) wrap.append(chips);
  wrap.append(body, dirBox);
  card({ kind: 'kamera',
    title: g.name,
    rows: [['Provozovatel', g.source], ['Kamer na místě', views.length > 1 ? String(views.length) : '']],
    lon: g.lon, lat: g.lat, extra: wrap,
    buttons: g.page ? [{ href: g.page, label: 'Stránka kamery' }] : [],
  });
  pick(0); // after the card opened (opening a card clears the previous selection)
}
function camView(c) {
  const sec = el('div', 'sec cam');
  sec.append(el('h3', '', c.view || 'Náhled kamery'));
  clearInterval(showCam.timer);
  if (c.kind === 'image') {
    const im = el('img'); im.alt = c.name; im.referrerPolicy = 'no-referrer'; im.className = 'campic';
    zoomable(im, 'snímek kamery');
    const stamp = el('p', 'livenote', 'Načítám…');
    const reload = () => { const u = new URL(c.url); u.searchParams.set('_', Date.now()); im.src = u.href; };
    im.onload = () => { stamp.textContent = `Obrázek načten ${new Date().toLocaleTimeString('cs-CZ')}${c.refresh_s ? `, obnovuje se každých ${Math.max(10, c.refresh_s)} s` : ''}.`; };
    im.onerror = () => { stamp.textContent = 'Kamera teď obrázek neposílá. Zkuste stránku kamery.'; };
    reload();
    showCam.timer = setInterval(() => { if ($('card').hidden || !im.isConnected) { clearInterval(showCam.timer); return; } reload(); }, Math.max(10, c.refresh_s || 60) * 1000);
    sec.append(im, stamp);
  } else if (c.kind === 'iframe') {
    // (YouTube players need to know which page they are on, so the referrer is kept here)
    const f = el('iframe'); f.src = c.url; f.className = 'camframe'; f.title = c.name; f.loading = 'lazy'; f.allow = 'autoplay; fullscreen; encrypted-media'; f.referrerPolicy = 'strict-origin-when-cross-origin';
    sec.append(f);
  } else sec.append(el('p', '', 'Tato kamera se dá sledovat jen na své vlastní stránce, otevřete ji tlačítkem „Stránka kamery“.'));
  return sec;
}
// private weather station: values, and the station's own page where it has one
function showMeteo(s) {
  const v = meteo.values(s);
  const sec = el('div', 'sec cam');
  const fmt = (x, u, d = 1) => (x == null || !Number.isFinite(x) ? '' : `${x.toFixed(d).replace('.', ',')} ${u}`);
  const DIRS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
  sec.append(el('h3', '', s.sc ? 'Aktuální hodnoty' : 'Poslední hodnoty (stahované jednou za hodinu)'));
  if (v) sec.append(rowsDl([['Teplota', fmt(v.t, '°C')], ['Vlhkost', fmt(v.h, '%', 0)], ['Tlak (na hladinu moře)', fmt(v.p, 'hPa', 1)], ['Vítr', v.w != null ? `${fmt(v.w, 'm/s')}${v.w > 0 ? ' od ' + DIRS[Math.round(v.wd / 45) % 8] : ''}` : ''], ['Srážky dnes', fmt(v.r, 'mm')], ['Změřeno', v.at ? new Date(v.at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '']]));
  else sec.append(el('p', '', 'Stanice teď hodnoty neposílá.'));
  // the temperature of the last 24 hours (data/meteo-history.json: one value an hour, collected by the feed)
  const hb = el('div');
  hb.append(el('p', 'label', 'Teplota za posledních 24 hodin'), el('p', 'livenote', 'Načítám…'));
  sec.append(hb);
  meteo.series(s, 24).then(pts => {
    const vals = pts.filter(q => q[1] != null);
    hb.replaceChildren(el('p', 'label', 'Teplota za posledních 24 hodin'));
    if (vals.length < 2) { hb.append(el('p', 'livenote', 'Průběh teploty se teprve sbírá: hodnoty se ukládají jednou za hodinu.')); return; }
    hb.append(tempChart(pts));
    const mn = vals.reduce((a, q) => (q[1] < a[1] ? q : a)), mx = vals.reduce((a, q) => (q[1] > a[1] ? q : a));
    const hm = t => new Date(t).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
    const cold = vals.filter(q => q[1] < 0).length;
    hb.append(el('p', 'livenote', `Nejméně ${fmt(mn[1], '°C')} (${hm(mn[0])}), nejvíce ${fmt(mx[1], '°C')} (${hm(mx[0])}). ${cold ? `Pod nulou ${cold} z ${vals.length} hodin.` : 'Pod nulu teplota neklesla.'} Hodinové hodnoty do ${hm(pts[pts.length - 1][0])}; čárkovaná čára a modrý pás: 0 °C a mráz.`));
  });
  if (s.embed) {
    sec.append(el('p', 'label', 'Stránka stanice (živé hodnoty a grafy)'));
    const f = el('iframe'); f.src = s.embed; f.className = 'camframe meteoframe'; f.title = s.name; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer';
    sec.append(f);
  }
  sec.append(el('p', 'credit', `Soukromá meteostanice, údaje bez záruky. Zdroj: ${s.src}${s.src === 'Sensor.Community' ? ' (otevřená data, ODbL)' : ''}.`));
  card({ kind: 'meteo', title: `${s.name} · meteostanice`, rows: [['Síť', s.src]], lon: s.lat ? s.lon : undefined, lat: s.lat, extra: sec, buttons: [{ href: s.page, label: s.src === 'Sensor.Community' ? 'Na mapě Sensor.Community' : 'Stránka stanice' }] });
}
// an enclosure in the zoo: who lives there, and the zoo's pages
function showZooPen(pen) {
  const sec = el('div', 'sec');
  sec.append(el('h3', '', 'Kdo tu bydlí'));
  sec.append(rowsDl(pen.animals.map(a => [a.name, `${a.n} na mapě`])));
  sec.append(el('p', 'livenote', 'Zvířata na mapě se přes den procházejí a pasou, v noci polehávají a jen občas se projdou. Výběhy a cesty jsou podle OpenStreetMap a mapy zoo; kolik zvířat tu je doopravdy, řekne zoo.'));
  sec.append(el('p', 'credit', `Zdroj: přispěvatelé OpenStreetMap (ODbL), stav k ${czDay(zoo.updated())}.`));
  const wp = pen.animals[0].wp;
  if (pen.X != null) fx.marker(pen.X, pen.Y);
  card({ kind: 'zoo', title: `${pen.n} · Zoo Brno`, rows: [['Část zoo', pen.n]], extra: sec, buttons: [{ href: 'https://www.zoobrno.cz/', label: 'Web zoo' }, ...(wp ? [{ href: `https://cs.wikipedia.org/wiki/${encodeURIComponent(wp.replace(/ /g, '_'))}`, label: `${wp} na Wikipedii` }] : [])] });
}
// Velký městský okruh: one card for the whole line
// a planned tram line (data.brno.cz)
function showTramPlan() {
  const d = tramplan.data();
  const s = el('div', 'sec');
  s.append(el('p', '', 'Nová nebo prodloužená tramvajová trať, kterou město plánuje. Data neříkají, kdy se postaví; některé tratě jsou teprve ve studii.'));
  s.append(el('span', 'credit', `Zdroj: ${d ? d.source : 'data.brno.cz'} (stav k ${d ? d.updated.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ') : '–'}). Celkem asi ${Math.round(tramplan.lengthKm())} km plánovaných tratí.`));
  card({ kind: 'tramtrat', title: 'Plánovaná tramvajová trať', text: 'Velký dopravní záměr', extra: s });
  tramplan.select(true);
}
function showVmo() {
  const d = vmo.data();
  const sec = el('div', 'sec');
  sec.append(el('h3', '', 'Stav úseků na mapě'));
  const ul = el('ul', 'vmolegend');
  const present = new Set((d ? d.sections : []).map(s => s.s));
  for (const [k, S] of Object.entries(VMO_STYLE)) {
    if (!present.has(k)) continue;
    const li = el('li');
    const sw = el('span', 'vmoswatch'); sw.style.borderTop = `${Math.max(3, S.w)}px ${S.dash.length ? (S.dash[0] <= 2 ? 'dotted' : 'dashed') : 'solid'} ${S.c}`;
    li.append(sw, el('span', '', S.label));
    ul.append(li);
  }
  sec.append(ul);
  sec.append(el('p', '', 'Okruh je postavený na západě a severu města: od Pisárek přes Žabovřeskou, Královopolský a Husovický tunel až k Tomkovu náměstí a Rokytově. Na východě a jihu zatím silnice I/42 vede provizorně městskými ulicemi; zbývající úseky (tunel Vinohrady, Černovice, Brno-jih, tunel Červený kopec) jsou v přípravě.'));
  if (d && d.note) sec.append(el('p', 'livenote', `Stav úseků: ${d.note} Trasa podle OpenStreetMap (${d.updated}).`));
  const parts = (layers.proj.list || []).filter(p => /^VMO\b|Velký městský okruh/.test(p.n));
  layers.selectVehicle(null);
  card({ kind: 'vmo',
    title: 'Velký městský okruh (VMO)',
    rows: [['Silnice', 'I/42'], ['Investor', 'Ředitelství silnic a dálnic ČR a statutární město Brno']],
    projects: [layers.proj.vmo, ...parts].filter(Boolean),
    extra: sec,
    buttons: [
      { href: 'https://cobude.brno.cz/projekt/velky-mestsky-okruh/', label: 'VMO na cobude.brno.cz' },
      { href: 'https://www.rsd.cz/mapova-aplikace', label: 'Stavby ŘSD (mapová aplikace)' },
      { href: 'https://www.mestsky-okruh-brno.cz/', label: 'mestsky-okruh-brno.cz' },
      { href: 'https://www.openstreetmap.org/search?query=Velk%C3%BD%20m%C4%9Bstsk%C3%BD%20okruh%20Brno', label: 'Na OpenStreetMap' },
    ],
  });
  vmo.select(true);
}
// ------------------------------------------------------------------ GO TO BRNO, monuments, events, closures, small things
// Cultural monuments, drawn without extra symbols: the roof of a listed building gets a thin gold outline
// (from about 3 m per pixel, when the buildings around are loaded); a monument that is not a building
// (statue, cross, fountain) is a small gold dot from 2 m per pixel. Off by default — the building card always
// says whether the building is a monument.
const monBld = new Map(); // monument -> building entry (or false = none) once its chunk is loaded
function monumentBuilding(m) {
  if (monBld.has(m) && monBld.get(m) !== null) return monBld.get(m);
  const cx = Math.floor(m.X / CH), cy = Math.floor(m.Y / CH);
  const list = chunk(cx, cy);
  if (!list) { monBld.set(m, null); return null; }
  // the building the point is in, otherwise the nearest one within ~10 m (points often sit on the street in front)
  let found = false, bd = 10;
  const segDist = (p, x, y) => { let d = Infinity; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const ax = p[j], ay = p[j + 1], dx = p[i] - ax, dy = p[i + 1] - ay, L2 = dx * dx + dy * dy || 1; const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); d = Math.min(d, Math.hypot(ax + dx * f - x, (ay + dy * f - y) * 2)); } return d; };
  for (const b of list) {
    const p = b[0];
    if (Math.abs(p[0] - m.X) > 300 || Math.abs(p[1] - m.Y) > 300) continue;
    const hp = b[1] || 0;
    if (inPoly(p, m.X, m.Y - hp)) { found = b; break; } // footprint = the roof outline moved down by the height
    const d = segDist(p, m.X, m.Y - hp);
    if (d < bd) { bd = d; found = b; }
  }
  monBld.set(m, found);
  return found;
}
// Is an image point hidden behind a building? A building covers the point when its roof outline (stored) or a
// wall below it is drawn over the point: the point lies inside the roof outline moved down by 0..height.
const occCache = new Map();
// a big building that surely covers a tram or a bus behind it: at least 6 m tall (twice the vehicle),
// a footprint of at least 60 m², not a shelter, garage, shed or greenhouse
const SMALL_KIND = /přístřeš|garáž|kůln|skleník|zastáv|kiosk|stánek|altán/i;
function bigBuilding(b) {
  if (b.big === undefined) {
    const p = b[0]; let a = 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
    const m2 = (Math.abs(a) / 2) * 2 / (GEO.A * GEO.A); // image px (Y is half a metre) -> m²
    b.big = (b[7] || 0) >= 6 && m2 >= 60 && !SMALL_KIND.test(b[4] || '');
  }
  return b.big;
}
// big = only big buildings hide the point (used for public transport)
// The buildings of a chunk by cells of OCC px (absolute image coordinates), each building in every cell its
// roof outline moved down by its height touches: the occlusion test looks at one cell instead of every building
// of nine chunks (hundreds of tests a frame: every car and vehicle on the screen)
const OCC = 64;
const occKey = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);
function occIndex(list) {
  if (list.occ) return list.occ;
  const idx = new Map();
  for (const b of list) {
    const p = b[0], hp = b[1] || 0;
    if (!b.bb) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } b.bb = [x0, x1, y0, y1]; }
    const gx0 = Math.floor(b.bb[0] / OCC), gx1 = Math.floor(b.bb[1] / OCC), gy0 = Math.floor(b.bb[2] / OCC), gy1 = Math.floor((b.bb[3] + hp) / OCC);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) { const k = occKey(gx, gy); let a = idx.get(k); if (!a) idx.set(k, a = []); a.push(b); }
  }
  list.occ = idx;
  return idx;
}
function occludedAt(X, Y, big = false) {
  const key = `${ROT}|${big ? 1 : 0}|${X >> 1}|${Y >> 1}`;
  const c = occCache.get(key);
  if (c !== undefined) return c;
  const cx = Math.floor(X / CH), cy = Math.floor(Y / CH);
  let ready = true, hit = false;
  for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
    const list = chunk(cx + dx, cy + dy);
    if (!list) { ready = false; continue; }
    const cell = occIndex(list).get(occKey(Math.floor(X / OCC), Math.floor(Y / OCC)));
    if (!cell) continue;
    for (const b of cell) {
      if (big && !bigBuilding(b)) continue;
      const p = b[0], hp = b[1] || 0;
      if (X < b.bb[0] || X > b.bb[1] || Y < b.bb[2] || Y > b.bb[3] + hp) continue;
      const step = Math.max(0.7, hp / 8);
      for (let d = 0; d <= hp + 0.01; d += step) if (inPoly(p, X, Y - d)) { hit = true; break; }
      if (hit) break;
    }
  }
  if (ready || hit) { occCache.set(key, hit); if (occCache.size > 50000) occCache.clear(); }
  return hit;
}
layers.setOccluder((X, Y) => occludedAt(X, Y, true)); // trams, trolleybuses, buses: only behind big buildings
fx.occluder = occludedAt; // the moving cars hide behind buildings too
function drawMonuments(ctx, v) {
  if (v.z < 0.65) return;
  if (!city.data.monuments.length) { city.loadMonuments(); return; }
  city.positions();
  const W = ctx.canvas.width, Hh = ctx.canvas.height;
  ctx.save();
  for (const m of city.data.monuments) {
    const x = v.ox + m.X * v.k, y = v.oy + m.Y * v.k;
    if (x < -200 || y < -200 || x > W + 200 || y > Hh + 200) continue;
    const b = monumentBuilding(m);
    if (b) {
      for (const q of piecesOf(b)) {
        const p = q[0]; // (the stored outline is already the roof)
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 2) { const px = v.ox + p[i] * v.k, py = v.oy + p[i + 1] * v.k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath();
        ctx.fillStyle = 'rgba(230,193,90,.12)'; ctx.fill();
        ctx.strokeStyle = 'rgba(230,193,90,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    } else if (b === false && v.z >= 1) {
      ctx.fillStyle = '#1b2333'; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
      ctx.fillStyle = '#e6c15a'; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    }
  }
  ctx.restore();
}
// GO TO BRNO block in a card (under Wikipedia). The datasets are CC BY with the request to credit
// www.gotobrno.cz; their licence does not mention the photos, so the photo is a link, not a picture.
// the author's pixel portrait
function gotobrnoSection(p) {
  const s = el('div', 'sec gotobrno');
  s.append(el('h3', '', 'GO TO BRNO'));
  if (p.t) { const txt = p.t.length > 900 ? `${p.t.slice(0, 900).replace(/\s+\S*$/, '')}…` : p.t; for (const para of txt.split('\n')) if (para) s.append(el('p', '', para)); }
  s.append(rowsDl([['Adresa', p.addr], ['Otevírací doba', p.hours], ['Vstupenky', p.tickets]]));
  const btns = el('div', 'btns');
  if (isUrl(p.url)) btns.append(srcBtn(p.url, 'Stránka místa na gotobrno.cz'));
  if (isUrl(p.img)) btns.append(srcBtn(p.img, 'Fotka na gotobrno.cz'));
  if (isUrl(p.web) && p.web !== p.url) btns.append(srcBtn(p.web, 'Web místa'));
  s.append(btns, el('span', 'credit', 'Zdroj: www.gotobrno.cz (TIC BRNO), otevřená data města Brna, CC BY.'));
  return s;
}
async function showPlace(p) {
  await city.detail();
  card({ kind: 'gotobrno', title: p.n, lon: p.lon, lat: p.lat, extra: gotobrnoSection(p), link: placeSlug(p.n) });
  fx.marker(p.X, p.Y);
}
const fmtDay = t => new Date(t).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
const fmtRange = (a, b) => (!b || fmtDay(a) === fmtDay(b) ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`);
async function showEvent(e) {
  await city.detail();
  const s = el('div', 'sec gotobrno');
  s.append(el('h3', '', 'Akce · GO TO BRNO'));
  if (e.t) s.append(el('p', '', e.t.length > 700 ? `${e.t.slice(0, 700).replace(/\s+\S*$/, '')}…` : e.t));
  const btns = el('div', 'btns');
  if (isUrl(e.url)) btns.append(srcBtn(e.url, 'Akce na gotobrno.cz'));
  if (isUrl(e.tickets)) btns.append(srcBtn(e.tickets, 'Vstupenky'));
  if (isUrl(e.img)) btns.append(srcBtn(e.img, 'Foto: GO TO BRNO'));
  s.append(btns, el('span', 'credit', 'Zdroj: www.gotobrno.cz (TIC BRNO), otevřená data města Brna, CC BY.'));
  // the leaf on the map stands for every event at this place (today and this week): the others are listed here
  const wrap = el('div'); wrap.append(s);
  const here = city.eventsIn('week').filter(o => o !== e && o.lon != null && e.lon != null && Math.hypot((o.lon - e.lon) * 72765, (o.lat - e.lat) * 111200) < 15).sort((a, b) => a.from - b.from);
  if (here.length) {
    const h = el('div', 'sec gotobrno');
    h.append(el('h3', '', 'Další akce na tomto místě'));
    const ol = el('ol', 'evt-list');
    for (const o of here) {
      const li = el('li'), b = el('button', 't-event evt-city'); b.type = 'button';
      const txt = el('span', '', o.n); txt.append(el('small', 'when', fmtRange(o.from, o.to)), el('small', '', o.cats.join(', ')));
      b.append(el('span', '', '★'), txt); b.onclick = () => showEvent(o);
      li.append(b); ol.append(li);
    }
    h.append(ol); wrap.append(h);
  }
  card({ kind: 'akce', title: e.n, rows: [['Kdy', fmtRange(e.from, e.to)], ['Kde', e.addr], ['Kategorie', e.cats.join(', ')], ['Vstupenky', e.ticketsInfo]], lon: e.lon, lat: e.lat, extra: wrap });
  if (e.X != null) fx.marker(e.X, e.Y);
}
function showOutage(o) {
  const s = el('div', 'sec');
  s.append(el('h3', '', o.type === 'Z' ? 'Přesunutá zastávka' : 'Výluka nebo odklon'));
  for (const para of (o.text || '').split('\n')) if (para) s.append(el('p', '', para));
  s.append(el('span', 'credit', 'Zdroj: IDS JMK, KORDIS JMK (mapa.idsjmk.cz), otevřená data města Brna.'));
  card({ kind: 'vyluka', title: o.title, rows: [['Linky', o.lines.join(', ')], ['Platí', `${o.from ? new Date(o.from).toLocaleString('cs-CZ') : ''} – ${o.to ? new Date(o.to).toLocaleString('cs-CZ') : 'do odvolání'}`], ['Místo', o.place]], lon: o.lon, lat: o.lat, extra: s, buttons: [{ href: 'https://mapa.idsjmk.cz/', label: 'Mapa výluk IDS JMK' }] });
  fx.marker(o.X, o.Y);
}
const SMALL = { tree: ['Památný strom', 'Památné stromy města Brna'], fountain: ['Pítko', 'Pítka města Brna'], view: ['Vyhlídka', 'Vyhlídkové body (ÚAP Brno)'], pool: ['Koupání', 'Plavecká sportoviště STAREZ a další'],
  art: ['Socha, pomník', 'Objekty drobné architektury (Sochařské Brno)'], cross: ['Kříž, boží muka', 'Objekty drobné architektury (Sochařské Brno)'], plaque: ['Pamětní deska', 'Objekty drobné architektury (Sochařské Brno)'] };
const SMALL_PHOTO = { tree: 'pasport zeleně', art: 'pasport drobné architektury', cross: 'pasport drobné architektury', plaque: 'pasport drobné architektury' };
function showLupa(p) {
  const s = el('div', 'sec lupa');
  s.append(el('h3', '', 'Brno pod lupou'));
  if (p.note) s.append(el('p', '', p.note));
  if (isUrl(p.url)) { const a = el('a', 'px-btn lupa-more', 'Víc na Brno pod lupou ›'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; const b = el('div', 'btns'); b.append(a); s.append(b); }
  card({ kind: 'lupa', title: p.name || LUPA[p.kind].title, text: LUPA[p.kind].title, lon: p.lon, lat: p.lat, extra: s });
  fx.marker(p.X, p.Y);
}
async function showSmall(o) {
  await mediaReady();
  const s = el('div', 'sec');
  const sp = SMALL_PHOTO[o.k] ? picsOf([o.img]) : [];
  if (sp.length) s.append(picImg(sp[0], o.n, `Foto: Statutární město Brno, ${SMALL_PHOTO[o.k]}`, 'campic'), el('span', 'credit', `Foto: Statutární město Brno, ${SMALL_PHOTO[o.k]} (gis.brno.cz)`));
  if (o.d) s.append(el('p', '', o.d));
  const btns = el('div', 'btns');
  if (isUrl(o.img)) btns.append(srcBtn(o.img, SMALL_PHOTO[o.k] ? 'Fotka v plné velikosti' : 'Fotka pítka'));
  if (isUrl(o.web)) btns.append(srcBtn(o.web, o.k === 'tree' ? 'Ústřední seznam ochrany přírody' : /encyklopedie\.brna\.cz/.test(o.web) ? 'Encyklopedie dějin města Brna' : 'Web'));
  s.append(btns, el('span', 'credit', `Zdroj: ${SMALL[o.k][1]}, otevřená data města Brna (data.brno.cz), CC BY.`));
  card({ kind: 'drobnost', title: o.n, text: SMALL[o.k][0], lon: o.lon, lat: o.lat, extra: s });
}
function monumentSection(m) {
  const s = el('div', 'sec monument');
  const tag = el('span', 'mon-tag', 'Kulturní památka');
  s.append(tag);
  // picture of the monument from Wikidata (a Wikimedia Commons file, our copy; a link to its author and licence)
  const mp = m.img ? picsOf([commonsFile(m.img)]) : [];
  if (mp.length) {
    const im = picImg(mp[0], m.n, 'Foto: Wikimedia Commons');
    const cr = el('a', '', 'Foto: Wikimedia Commons (autor a licence)'); cr.href = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(m.img)}`; cr.target = '_blank'; cr.rel = 'noopener';
    const c = el('span', 'credit'); c.append(cr);
    s.append(im, c);
  }
  s.append(el('p', '', `${m.n} · rejstříkové číslo ÚSKP ${m.uskp}`));
  const btns = el('div', 'btns');
  btns.append(srcBtn(m.pk ? `https://pamatkovykatalog.cz/soupis/podle-relevance/1/seznam/?katCislo=${encodeURIComponent(m.pk)}` : `https://pamatkovykatalog.cz/uskp/podle-relevance/1/seznam/?uskp=${encodeURIComponent(m.uskp)}`, 'Památkový katalog'));
  btns.append(srcBtn(`https://www.wikidata.org/wiki/${m.wd}`, 'Wikidata'));
  s.append(btns, el('span', 'credit', 'Údaje o památce: Wikidata (CC0), Národní památkový ústav.'));
  return s;
}
function showMonument(m) { card({ kind: 'pamatka', title: m.n, text: 'Kulturní památka', lon: m.lon, lat: m.lat, extra: monumentSection(m) }); fx.marker(m.X, m.Y); }
// a themed route: stops one by one
// the tour: one stop every few seconds; any move of the map, a click or closing the card stops it
const tour = { r: null, i: 0, timer: null };
function stopTour() { if (tour.timer) { clearTimeout(tour.timer); tour.timer = null; toast('Prohlídka zastavena'); } tour.r = null; }
function playTour(r, from = 0) {
  stopTour();
  if (!from) track('Nástroj', { nastroj: 'prehrat-trasu', hodnota: r.theme });
  tour.r = r; tour.i = from;
  const step = () => {
    if (tour.r !== r) return;
    showRouteStop(r, tour.i, true);
    tour.i++;
    if (tour.i >= r.stops.length) { tour.timer = null; tour.r = null; toast('Konec trasy'); return; }
    tour.timer = setTimeout(step, 10000); // (the flight takes about 3 s, then time to look and read)
  };
  step();
}
for (const ev of ['canvas-drag', 'canvas-scroll', 'canvas-pinch']) viewer.addHandler(ev, () => { if (tour.r) stopTour(); });
// to the next stop of a route: zoom out so that both places are in view, fly over, then zoom in close
// on the stop (when it is already near on the screen, just zoom in)
let flight = 0;
const STOP_Z = 3; // about 0.7 m per pixel: the building and its surroundings fill the screen
function flyToStop(X, Y) {
  const id = ++flight;
  const v = view(), cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
  const [cx, cy] = screenToImg(cw / 2, ch / 2);
  const d = Math.hypot(X - cx, Y - cy);
  if (d * v.k < Math.min(cw, ch) * 0.35) { flyTo(X, Y, STOP_Z); return; }
  const zOut = Math.max(0.12, Math.min(v.z, 1, ((0.55 * Math.min(cw, ch)) / d) * S));
  flyTo((cx + X) / 2, (cy + Y) / 2, zOut);
  setTimeout(() => { if (id === flight) flyTo(X, Y, STOP_Z); }, 1500);
}
// a Wikipedia tag near a route stop with a similar name (for its photo and text)
function wikiNear(st) {
  const words = s => norm(s || '').replace(/[^a-z0-9 ]+/g, ' ').split(' ');
  // (words that only say the kind of place do not count: "Kostel sv. Michala" is not "Kostel sv. Jakuba")
  const KIND = new Set(['kostel', 'namesti', 'divadlo', 'muzeum', 'park', 'vila', 'hotel', 'galerie', 'pavilon', 'brana', 'kaple', 'ulice', 'brno', 'brne', 'brnenske', 'brnenska', 'narodni', 'mestske', 'stezka', 'naucna']);
  const sw = words(st.n).filter(w => w.length > 3 && !KIND.has(w));
  let best = null, bd = 150;
  for (const w of data.wikiPois) {
    const d = Math.hypot(w[2] - st.X, (w[3] - st.Y) * 2);
    if (d >= bd) continue;
    const ww = words(w[0]);
    if (sw.some(a => ww.some(b => b.length > 3 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5)))))) { best = w; bd = d; }
  }
  return best;
}
function showRouteStop(r, i, fromTour = false) {
  if (!fromTour && tour.r) stopTour();
  const st = r.stops[i];
  city.setRoute(r, i);
  flyToStop(st.X, st.Y); fx.marker(st.X, st.Y);
  const p = city.placeNear(st.lon, st.lat, st.n, 150);
  // no GO TO BRNO photo: the photo and text from Wikipedia, when the stop has an article
  const w = p && isUrl(p.img) ? null : wikiNear(st);
  const wrap = el('div');
  const nav = el('div', 'btns routenav');
  const mk = (label, j) => { const b = el('button', 'px-btn small', label); b.type = 'button'; b.disabled = j < 0 || j >= r.stops.length; b.onclick = () => showRouteStop(r, j); return b; };
  nav.append(mk('‹ Předchozí', i - 1), el('span', 'routepos', `${i + 1} / ${r.stops.length}`), mk('Další ›', i + 1));
  if (fromTour) { const stop = el('button', 'px-btn small', '■ Zastavit prohlídku'); stop.type = 'button'; stop.onclick = () => stopTour(); nav.append(stop); }
  wrap.append(nav);
  if (p) wrap.append(gotobrnoSection(p));
  else {
    const s = el('div', 'sec gotobrno'); s.append(el('h3', '', r.theme));
    if (isUrl(r.img) && !w) { const b = el('div', 'btns'); b.append(srcBtn(r.img, 'Fotka k tématu na gotobrno.cz')); s.append(b); }
    if (r.t) s.append(el('p', '', r.t.length > 600 ? `${r.t.slice(0, 600).replace(/\s+\S*$/, '')}…` : r.t));
    s.append(el('span', 'credit', 'Zdroj: www.gotobrno.cz (TIC BRNO), otevřená data města Brna, CC BY.'));
    wrap.append(s);
  }
  card({ kind: 'trasa', title: `${i + 1}. ${st.n}`, text: `Trasa ${r.theme}`, rows: [['Adresa', st.addr]], lon: st.lon, lat: st.lat, extra: wrap, wiki: w ? w[1] : undefined });
  city.setRoute(r, i); // (opening a card does not clear the route)
  renderRouteList();
}
const WORK_TITLE = { leseni: 'Lešení na chodníku', kontejner: 'Kontejner na ulici', havarie: 'Oprava havárie', pripojka: 'Výkop pro přípojku', kolektor: 'Stavba kolektoru', tram: 'Oprava tramvajové trati', cyklo: 'Stavba cyklostezky', voda: 'Výkop: kanalizace a vodovod', plyn: 'Výkop: plynovod', optika: 'Výkop: optický kabel', stavba: 'Zábor u stavby', oprava: 'Oprava' };
const WORK_KIND = { uplna: 'úplná uzavírka', castecna: 'částečná uzavírka (zábor chodníku nebo jízdního pruhu)', smer: 'uzavírka jednoho směru' };
const czd = d => (d ? d.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ') : '');
function showWork(c) {
  let head = c.kind === 'uplna' ? 'Uzavřeno' : c.kind === 'smer' ? 'Uzavřen jeden směr' : WORK_TITLE[c.cat] || 'Zábor chodníku nebo vozovky';
  if (c.soon) head = c.kind === 'uplna' ? `Uzavře se od ${czd(c.from)}` : c.kind === 'smer' ? `Jeden směr se uzavře od ${czd(c.from)}` : `Od ${czd(c.from)}: ${head.toLowerCase()}`;
  const what = c.kind === 'uplna' && WORK_TITLE[c.cat] ? `${WORK_TITLE[c.cat].toLowerCase()}: ${c.n}` : c.n;
  card({ kind: 'vykop',
    title: `${head} · ${c.street}${c.usek ? ` ${c.usek}` : ''}`,
    text: `${what ? what + '. ' : ''}Město povolilo ${WORK_KIND[c.kind]}${c.soon ? ` od ${czd(c.from)}` : ''} do ${czd(c.to)}. Je to povolení na celé období, ne nutně každý den práce; co se tu právě děje, nejlépe ukáže fotka ulice nebo cesta kolem.`,
    rows: [
      ['Co se děje', c.n], ['Omezení', cap(WORK_KIND[c.kind]) + (c.mhd ? ', s výlukou MHD' : '')], [c.soon ? 'Začne' : 'Povoleno', c.soon ? `${czd(c.from)} (do ${czd(c.to)})` : `${czd(c.from)} – ${czd(c.to)}`],
      ['Vlastní uzavírka', c.uz ? `${czd(c.uz[0])} – ${czd(c.uz[1])}` : ''], ['Investor', c.inv], ['Provedení', [c.how, c.where].filter(Boolean).join(', ')],
      ['Délka úseku', c.len ? `${c.len} m` : ''],
      ['Potvrzuje i', c.ndic ? `NDIC (${c.ndic.issuer || 'úřad'}): ${c.ndic.kind || 'omezení'}, ${czd(c.ndic.from)} – ${czd(c.ndic.to)}` : 'jen souhlas města (koordinace výkopových prací)'],
      ['Zdroj', 'Koordinace výkopových prací, Odbor investic MMB'],
    ],
    buttons: [{ href: 'https://gis.brno.cz/mapa/kvp-uzavirky/', label: 'Mapa koordinace výkopů (město)' }],
    lon: c.lon.toFixed(5), lat: c.lat.toFixed(5),
  });
}
function showWorkPoint(q) {
  card({ kind: 'vykop',
    title: `${cap(q.kind || 'Dopravní omezení')}${q.planned ? ` od ${czd(q.from)}` : ''} · ${q.place || 'Brno'}`,
    text: `${q.txt || ''}${q.planned ? ` Teprve se chystá, začne ${czd(q.from)}.` : ''}`.trim(),
    rows: [['Platí', `${czd(q.from)} – ${czd(q.to)}`], ['Kategorie', q.cls], ['Vydal', q.issuer], ['Zdroj', 'NDIC (ŘSD ČR – JSDI), zrcadlí GIS města Brna']],
    buttons: [{ href: 'https://www.dopravniinfo.cz/', label: 'dopravniinfo.cz' }],
    lon: q.lon.toFixed(5), lat: q.lat.toFixed(5),
  });
}
function showTraffic(tr) {
  const time = t => new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  if (tr.work) { showWork(tr.work); return; }
  if (tr.workPoint) { showWorkPoint(tr.workPoint); return; }
  if (tr.closure) {
    const c = tr.closure;
    const open = c.open ? c.open.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ') : '';
    card({ kind: 'doprava',
      title: `Uzavřeno · ${c.n || 'úsek silnice'}`,
      text: `${c.tunnel ? 'Tunel je' : c.bridge ? 'Most je' : 'Úsek je'} uzavřený kvůli stavbě nebo rekonstrukci, auta ho objíždí — proto bývají okolo kolony.`,
      rows: [['Otevření plánováno', open || 'neuvedeno'], ['Upraveno v OSM', c.edited ? c.edited.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ') : ''], ['Potvrzuje i', c.confirmedBy || 'jen OpenStreetMap (upraveno za poslední rok)'], ['Zdroj', tr.source]],
      lon: c.p[0].toFixed(5), lat: c.p[1].toFixed(5),
    });
    return;
  }
  if (tr.alert) {
    const a = tr.alert;
    const kind = a.type === 'ROAD_CLOSED' ? 'Uzavírka' : a.type === 'ACCIDENT' ? 'Nehoda' : 'Překážka na silnici';
    card({ kind: 'doprava', title: `${kind}${a.street ? ` · ${a.street}` : ''}`, text: a.note || '', rows: [['Nahlášeno', time(a.t)], ['Zdroj', 'Waze, otevřená data města Brna']], lon: a.lon.toFixed(5), lat: a.lat.toFixed(5) });
  } else {
    const j = tr.jam;
    const lvl = ['', 'mírné zpomalení', 'zpomalení', 'kolona', 'velká kolona', 'stojí'][j.level] || 'kolona';
    card({ kind: 'doprava', title: `${cap(lvl)}${j.street ? ` · ${j.street}` : ''}`, rows: [['Rychlost', j.speed != null ? `${Math.round(j.speed)} km/h` : ''], ['Zdržení', j.delay > 0 ? `${Math.round(j.delay / 60)} min` : ''], ['Délka', j.len ? `${Math.round(j.len)} m` : ''], ['Aktualizace', time(j.t)], ['Zdroj', 'Waze, otevřená data města Brna']] });
  }
}
// places linked to Wikipedia that are not buildings (parks, statues, churches drawn as points…)
function wikiPoiAt(sx, sy) {
  const rects = (fx.wikiRects || []).concat(fx.landmarkRects || []);
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (sx >= r[0] && sx <= r[2] && sy >= r[1] && sy <= r[3]) return r[4];
  }
  return null;
}
function showWikiPoi(p) {
  if (p[6]) { showPlace(p[6]); return; }
  if (p[5]) { showProject(p[5].proj); fx.marker(p[2], p[3]); return; }
  const story = p[4] && data.stories.find(s => s.n === p[0]);
  if (story) { openStory(story); return; }
  const [lon, lat] = imgToLonLat(p[2], p[3]);
  card({ kind: 'wiki', title: p[0], rows: [], lon: lon.toFixed(5), lat: lat.toFixed(5), wiki: p[1], projects: projByWiki(p[1]), link: placeSlug(p[0]) });
  fx.marker(p[2], p[3]);
}
// closing the card also clears what it highlighted: the building, and a vehicle with its route
$('cardClose').onclick = () => {
  if (location.hash.startsWith('#misto/')) history.replaceState(null, '', location.pathname + location.search);
  stopTour(); $('card').hidden = true; fx.selected = null; fx.area = null; fx.markerOff(); layers.selectVehicle(null); layers.selectStop(null); cams.select(null); vmo.select(false); tramplan.select(false); lastLine = null; };

// ------------------------------------------------------------------ places and stories
ready.then(() => {
  const ul = $('places');
  for (const s of data.stories) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = s.n; btn.setAttribute('aria-label', s.n);
    btn.onclick = () => openStory(data.stories.find(x => x.n === s.n) || s);
    li.append(btn); ul.append(li);
  }
  fx.prepareLights();
  // apply a shared view only once the map image is open (opening resets the view)
  if (opened) restoreFromHash();
  else viewer.addOnceHandler('open', () => setTimeout(restoreFromHash, 0));
});
// A few places open with a fitting mood (idea borrowed from Tiny Prague's camera presets).
const PRESETS = {
  'Hvězdárna a planetárium Brno': { night: 100 },
  'Mahenovo divadlo': { night: 100 },
  'Hády': { night: 50 },
  'Arboretum Mendelovy univerzity': { season: 'spring' },
  'Brněnská přehrada': { season: 'summer' },
  'Koupaliště Riviéra': { season: 'summer' },
};
function openStory(s) {
  const p = PRESETS[s.n];
  if (p) {
    if (p.season) setSeason(p.season);
    if (p.night !== undefined) { $('realTime').checked = false; setNight(p.night); }
  }
  flyTo(s.X, s.Y, Math.max(isPhone() ? 4 : 5, view().z)); // never zoom out when already closer
  fx.marker(s.X, s.Y);
  card({ kind: 'pribeh', title: s.n, text: s.t, rows: [['Co to je', s.d]], lon: s.lon, lat: s.lat, wiki: s.w, projects: projByWiki(s.w), link: placeSlug(s.n) });
  if (matchMedia('(max-width: 640px)').matches) setPanelOpen(false);
}

// ------------------------------------------------------------------ search
let index = null;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function loadIndex() {
  if (index) return index;
  const d = await load('search.json');
  index = [];
  for (const s of data.stories) index.push({ n: s.n, k: 'místo', X: s.X, Y: s.Y, story: s });
  for (const [n, k, X, Y] of d.p) index.push({ n, k, X, Y });
  for (const [n, k, X, Y] of d.s) index.push({ n, k, X, Y });
  for (const [n, k, X, Y] of d.a) index.push({ n, k, X, Y });
  // districts, quarters and localities (the labels of the map): found by name, shown from above
  for (const l of data.labels || []) index.push({ n: l.n, k: l.r === 1 ? 'čtvrť' : l.r === 2 ? 'část města' : 'lokalita', X: l.X, Y: l.Y, far: l.r === 1 ? 0.3 : l.r === 2 ? 0.6 : 1 });
  // the proposals of Dáme na vás (the city-wide ones have no position: the card opens without a flight)
  await paro.load(); paro.positions();
  for (const p of paro.data.items) if (paro.shown(p) || p.city) index.push({ n: p.n, k: p.city ? 'návrh Dáme na vás · celé Brno' : 'návrh Dáme na vás', X: p.city ? NaN : p.X, Y: p.city ? NaN : p.Y, paro: p });
  for (const it of index) it.q = norm(it.n);
  return index;
}
// How close a found thing is shown (z: 2 = one screen pixel per metre): a house or an address close enough to tell it
// from its neighbours, a church or a museum a little less, a street as a whole, a district or a quarter from above
// (the phone shows a third of the width of a desktop window, so it flies a step less close)
function zoomFor(it) {
  if (it.far) return it.far;
  const phone = isPhone();
  if (it.k === 'ulice') return phone ? 1.2 : 2;
  if (it.k === 'adresa') return phone ? 6 : 8;
  return phone ? 5 : 6;
}
let results = [];
async function search(q) {
  const ul = $('results');
  const nq = norm(q.trim());
  if (nq.length < 2) { ul.replaceChildren(); results = []; return; }
  const idx = await loadIndex();
  const starts = [], inner = [];
  for (const it of idx) {
    const p = it.q.indexOf(nq);
    if (p === 0) starts.push(it); else if (p > 0 && (it.q[p - 1] === ' ' || it.q[p - 1] === '.' || nq.length > 3)) inner.push(it);
    if (starts.length > 20) break;
  }
  // one result per place: the same name within ~150 m is a duplicate (e.g. a story and the building)
  const uniq = [];
  for (const it of [...starts, ...inner]) { if (!uniq.some(u => u.q === it.q && Math.hypot(u.X - it.X, (u.Y - it.Y) * 2) < 150 * GEO.A)) uniq.push(it); if (uniq.length >= 8) break; }
  // the whole name typed: that place first, and a district or a street before a building of the same name
  // ("Bystrc" is the quarter, "Česká" the street); the rest keep their order
  const rank = it => (it.q !== nq ? 9 : it.far ? 0 : it.k === 'ulice' ? 1 : 2);
  uniq.sort((a, b) => rank(a) - rank(b));
  results = uniq;
  ul.replaceChildren(...results.map((it, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    if (i === 0) b.classList.add('on');
    const span = document.createElement('span'); span.textContent = it.n;
    const small = document.createElement('small'); small.textContent = it.k;
    b.append(span, small);
    b.onclick = () => pick(it);
    li.append(b);
    return li;
  }));
}
function pick(it) {
  track('Hledání', { dotaz: $('q').value.toLowerCase(), vysledek: it.story ? 'pribeh' : it.paro ? 'paro' : it.k });
  $('results').replaceChildren();
  $('q').value = it.n;
  card.fromSearch = Date.now(); // the card opened from the search keeps the name in the field
  if (it.story) { openStory(it.story); return; }
  if (it.paro) { showParo(it.paro, true); return; }
  flyTo(it.X, it.Y, zoomFor(it));
  fx.marker(it.X, it.Y);
  const [lon, lat] = imgToLonLat(it.X, it.Y);
  card({ kind: 'hledani', title: it.n, rows: [['Typ', cap(it.k)]], lon: lon.toFixed(5), lat: lat.toFixed(5) });
  if (matchMedia('(max-width: 640px)').matches) setPanelOpen(false);
}
let st;
$('q').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => search(e.target.value), 120); });
$('q').addEventListener('focus', () => loadIndex());
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { if (results[0]) pick(results[0]); else if ($('q').value.trim()) track('Hledání', { dotaz: $('q').value.toLowerCase(), vysledek: 'nic' }); } if (e.key === 'Escape') $('results').replaceChildren(); });

// ------------------------------------------------------------------ seasons
let seasonBusy = 0;
// buttons, snow option and effects of a season (the map tiles are switched in setSeason)
function seasonUi(s) {
  document.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === s)));
  const snow = document.querySelector('[data-w="snow"]');
  const snowOk = s === 'autumn' || s === 'winter';
  snow.disabled = !snowOk;
  if (!snowOk && state.weather === 'snow') setWeather('clear');
  fx.setSeason(s);
  lookUi();
}
function setSeason(s, immediate = false) {
  if (!SEASONS.includes(s)) return;
  state.season = s;
  seasonUi(s);
  const ticket = ++seasonBusy;
  const old = viewer.world.getItemAt(0);
  if (old && old.source && String(old.source.tilesUrl || '').includes(`/tiles/r${ROT}/${s}/`)) return;
  viewer.addTiledImage({
    tileSource: tilesUrl(s),
    index: viewer.world.getItemCount(),
    opacity: 1,
    success: ev => {
      const item = ev.item;
      const done = () => {
        if (ticket !== seasonBusy) { viewer.world.removeItem(item); return; }
        // everything but the new season goes (the old season, and the detail layer, which detailReset lays back
        // over the new one in its colours)
        for (let i = viewer.world.getItemCount() - 1; i >= 0; i--) { const it = viewer.world.getItemAt(i); if (it !== item) viewer.world.removeItem(it); }
        detailReset();
      };
      if (immediate || item.getFullyLoaded()) done();
      else item.addOnceHandler('fully-loaded-change', done);
    },
  });
}
// choosing a season by hand switches off 'as in Brno now'
document.querySelectorAll('[data-s]').forEach(b => (b.onclick = () => { track('Nástroj', { nastroj: 'rocni-obdobi', hodnota: b.dataset.s }); $('realTime').checked = false; setSeason(b.dataset.s); }));

// ------------------------------------------------------------------ time of day
function setNight(v) {
  state.night = v / 100;
  $('night').value = v;
  fx.setNight(state.night);
  lookUi();
  dayUi();
}
$('night').addEventListener('input', e => { $('realTime').checked = false; setDayLock(false, true); setNight(+e.target.value); });
$('night').addEventListener('change', e => track('Nástroj', { nastroj: 'denni-doba', hodnota: e.target.value >= 75 ? 'noc' : e.target.value >= 25 ? 'soumrak' : 'den' })); // (once, when the slider is let go)
// ------------------------------------------------------------------ the day switch
// Shown only while the map is dark (dusk, night) or held in daylight: "Ukázat den" keeps the real season, weather,
// clock and live data and only lights the map up; "Jako teď" lets the real time of day back.
function dayUi() {
  const b = $('dayBtn');
  if (!b) return;
  b.hidden = !(state.night > 0 || dayLock);
  b.setAttribute('aria-pressed', String(dayLock));
  b.querySelector('.i').textContent = dayLock ? '☾' : '☀';
  b.querySelector('.l').textContent = dayLock ? 'Jako teď' : 'Ukázat den';
  b.title = dayLock
    ? 'Mapa je ve dne, i když je v Brně tma. Kliknutím zpět podle skutečné denní doby.'
    : 'V Brně se stmívá nebo je noc: kliknutím ukážete mapu za denního světla. Roční období, počasí, čas i živá data zůstanou skutečné.';
}
function setDayLock(on, quiet = false) {
  dayLock = on;
  try { if (on) localStorage.setItem('izo-day', '1'); else localStorage.removeItem('izo-day'); } catch { /* private mode */ }
  if (quiet) { dayUi(); return; }
  $('realTime').checked = true;
  realTime();
}
$('dayBtn').onclick = () => { track('Nástroj', { nastroj: 'ukazat-den', hodnota: dayLock ? 'vyp' : 'zap' }); setDayLock(!dayLock); };
function realTime() {
  lookUi();
  if (!$('realTime').checked) return;
  if (state.season !== seasonOf()) setSeason(seasonOf()); // the real season too
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  const h = now.getHours() + now.getMinutes() / 60;
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const dayLen = 12.2 + 4.1 * Math.sin(((doy - 80) / 365) * 2 * Math.PI);
  const rise = 12.6 - dayLen / 2, set = 12.6 + dayLen / 2;
  let v;
  if (h >= rise + 1 && h <= set - 1) v = 0;
  else if (h > set - 1 && h < set) v = ((h - (set - 1)) / 1) * 50;
  else if (h >= set && h < set + 1) v = 50 + (h - set) * 50;
  else if (h >= rise - 1 && h < rise) v = 100 - (h - (rise - 1)) * 50;
  else if (h >= rise && h < rise + 1) v = 50 - (h - rise) * 50;
  else v = 100;
  setNight(dayLock ? 0 : Math.round(v));
}
$('realTime').addEventListener('change', realTime);
$('realTime').addEventListener('change', e => track('Nástroj', { nastroj: 'jako-ted', hodnota: e.target.checked ? 'zap' : 'vyp' }));
setInterval(realTime, 60000);
seasonUi(state.season);
realTime(); // on by default: the map starts as it is in Brno now

// ------------------------------------------------------------------ weather
function setWeather(w) {
  state.weather = w;
  // with live weather on, no button is 'chosen': the buttons are dimmed and the real state is written below them
  const live = $('liveWeather').checked;
  $('weather').classList.toggle('is-live', live);
  document.querySelectorAll('[data-w]').forEach(b => b.setAttribute('aria-pressed', String(!live && b.dataset.w === w)));
  if (!live) $('weatherLiveNote').hidden = true;
  fx.setWeather(w);
  lookUi();
}
// cloud cover for weather chosen by hand: "Jasno" is a truly clear sky, the others keep a few clouds
const manualCloud = w => (w === 'clear' ? 0 : 0.5);
document.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => { track('Nástroj', { nastroj: 'pocasi', hodnota: b.dataset.w }); $('liveWeather').checked = false; liveWeather(); setWeather(b.dataset.w); fx.cloud = manualCloud(b.dataset.w); }));

// ------------------------------------------------------------------ live weather (Open-Meteo)
let weatherTimer = null, weatherAt = 0, weatherRun = () => {};
async function liveWeather() {
  clearInterval(weatherTimer); weatherTimer = null;
  lookUi();
  if (!$('liveWeather').checked) { fx.cloud = manualCloud(state.weather || 'clear'); fx.precip = -1; fx.wind = 0; $('weatherNow').hidden = true; setWeather(state.weather || 'clear'); return; }
  const run = async () => {
    weatherAt = Date.now();
    try {
      const w = await fetchWeather();
      fx.cloud = w.cloud; fx.precip = w.precip; fx.wind = w.wind;
      document.querySelector('[data-w="snow"]').disabled = false;
      setWeather(w.kind);
      $('weatherNow').hidden = false;
      $('weatherNow').textContent = `Teď v Brně: ${Math.round(w.temp)} °C, ${w.sky}, oblačnost ${Math.round(w.cloud * 100)} %${w.precip ? `, srážky ${w.precip} mm/h` : ''} · předpověď ›`;
      $('weatherLiveNote').hidden = false;
      $('weatherLiveNote').textContent = `Podle skutečnosti: ${w.sky}, ${Math.round(w.temp)} °C. Tlačítkem přepnete na ruční volbu.`;
      $('fcTileIcon').textContent = ICON(w.code ?? 1, w.day ?? 1); $('fcTileTemp').textContent = `${Math.round(w.temp)} °C`;
    } catch { $('weatherNow').hidden = false; $('weatherNow').textContent = 'Počasí se teď nenačetlo, zkusím to znovu.'; }
  };
  weatherRun = run;
  await run();
  weatherTimer = setInterval(run, 10 * 60e3);
}
$('liveWeather').addEventListener('change', liveWeather);
$('liveWeather').addEventListener('change', e => track('Nástroj', { nastroj: 'pocasi-zive', hodnota: e.target.checked ? 'zap' : 'vyp' }));
liveWeather();
// ------------------------------------------------------------------ weather forecast panel
// the forecast panel (charts, 16 days, pollen) loads after the map; forecastReady resolves with it
let forecast = null;
const forecastReady = import('./forecast.js').then(({ createForecast }) => (forecast = createForecast({
  base: BASE, el,
  // a forecast hour chosen in the panel: the map shows its clouds, rain / snow and time of day
  onPreview: p => {
    clearInterval(weatherTimer); weatherTimer = null;
    $('liveWeather').checked = false; $('realTime').checked = false;
    fx.cloud = p.cloud; fx.precip = p.precip; fx.wind = p.wind;
    if (p.kind === 'snow') document.querySelector('[data-w="snow"]').disabled = false;
    setWeather(p.kind); setNight(p.night);
    $('fcPillText').textContent = `Předpověď: ${p.label}`; $('fcPill').hidden = false;
  },
  onNow: () => backToNow(),
})));
function backToNow() {
  $('fcPill').hidden = true;
  $('liveWeather').checked = true; $('realTime').checked = true;
  liveWeather(); realTime();
}
$('fcPillNow').onclick = backToNow;
// ------------------------------------------------------------------ look of the map (the switch at the bottom right)
// "Jako teď": season, time of day and weather as in Brno now. "Pořád léto": a clear summer day, nothing else changes:
// the clock, vehicles, traffic and the weather figures stay live (the picture is a backdrop, like a satellite view).
function isSummerLook() { return !$('realTime').checked && !$('liveWeather').checked && state.season === 'summer' && state.night === 0 && state.weather === 'clear'; }
// (lookUi.ready: the stored look is written only after start-up, so the start-up itself does not wipe it)
function lookUi() {
  if (!$('lookSummer')) return;
  const summer = isSummerLook();
  const live = $('realTime').checked && $('liveWeather').checked;
  const btn = $('lookSummer');
  lookUi.state = summer ? 'summer' : live ? 'live' : 'custom';
  btn.dataset.look = lookUi.state;
  btn.setAttribute('aria-pressed', String(summer));
  btn.title = summer
    ? 'Pořád léto: mapa je v létě, ve dne a bez mraků. Čas, MHD, doprava i počasí v číslech jsou dál skutečné. Kliknutím zpět jako teď v Brně.'
    : live
      ? 'Jako teď v Brně: roční období, denní doba a počasí podle skutečnosti. Kliknutím ukážete mapu za jasného letního dne, čas a živá data zůstanou skutečné.'
      : 'Vzhled nastavený ručně (záložka Vzhled), čas na mapě stojí. Kliknutím ukážete mapu za jasného letního dne.';
  tickClock(); // the hands of the watch follow the state
  if (lookUi.ready) try { if (summer) localStorage.setItem('izo-look', 'summer'); else localStorage.removeItem('izo-look'); } catch { /* private mode */ }
}
function setLook(mode) {
  if (mode !== 'summer') { backToNow(); return; }
  clearInterval(weatherTimer); weatherTimer = null;
  $('fcPill').hidden = true;
  $('realTime').checked = false; $('liveWeather').checked = false;
  setSeason('summer'); setNight(0);
  fx.cloud = 0; fx.precip = -1; fx.wind = 0;
  $('weatherNow').hidden = true;
  setWeather('clear');
  // said once: the picture changed, the live data did not
  try {
    if (!localStorage.getItem('izo-look-toast')) { toast('Mapa teď vypadá jako letní den. Čas, MHD, doprava i počasí v číslech jsou dál skutečné.', 5000); localStorage.setItem('izo-look-toast', '1'); }
  } catch { toast('Mapa teď vypadá jako letní den. Čas, MHD, doprava i počasí v číslech jsou dál skutečné.', 5000); }
}
$('lookSummer').onclick = () => { track('Nástroj', { nastroj: 'porad-leto', hodnota: isSummerLook() ? 'vyp' : 'zap' }); setLook(isSummerLook() ? 'now' : 'summer'); };
// the chosen look survives a reload (a shared link with its own season or time wins, it is restored later)
try { if (localStorage.getItem('izo-look') === 'summer') setLook('summer'); } catch { /* private mode */ }
lookUi.ready = true; lookUi();
// the weather tile opens a short overview beside the map (now, next hours, 5 days); the full forecast
// with charts, 16 days, pollen, the half-year outlook and ČHMÚ texts is one click further
function setFcOpen(open) {
  if (open && $('fcPop').hidden) track('Panel', { co: 'predpoved' });
  $('fcPop').hidden = !open;
  $('fcTile').setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (!$('card').hidden) $('cardClose').click();
  if (!$('events').hidden) setEventsOpen(false);
  if (isPhone()) setTab(null);
  forecastReady.then(f => f.renderShort($('fcPopBody'), openForecastFull));
}
function openForecast() { setFcOpen(true); }
async function openForecastFull() { track('Panel', { co: 'predpoved-cela' }); setFcOpen(false); $('fcDlg').showModal(); await (await forecastReady).render($('fcBody')); }
$('weatherNow').onclick = openForecast;
$('fcTile').onclick = () => setFcOpen($('fcPop').hidden);
$('fcPopClose').onclick = () => setFcOpen(false);
$('fcClose').onclick = () => $('fcDlg').close();
// ČHMÚ warnings for Brno: a strip at the top and items in the timeline (again when the feed brings a new file)
function renderAlertBar() {
  const al = forecast.alerts();
  const bar = $('alertBar');
  bar.hidden = !al.length;
  if (!al.length) return;
  const a = al[0];
  bar.replaceChildren(el('b', '', `⚠ ${a.event}`), el('span', '', ` – výstraha ČHMÚ pro Brno${al.length > 1 ? ` (+${al.length - 1})` : ''}`));
  bar.onclick = openForecastFull;
}
forecastReady.then(f => f.loadOff()).then(() => { renderAlertBar(); renderEvents(); });
// a feed file was reloaded on a page left open (src/feed.js): the canvas and the lists once more
window.addEventListener('feed-refresh', e => {
  if (e.detail.includes('weather') && forecast) renderAlertBar();
  renderEvents();
  if (!$('aktual').hidden) renderAktualne();
  try { viewer.forceRedraw(); } catch { /* not open yet */ }
});
layers.traffic.onStatus = t => { $('trafficNow').hidden = false; $('trafficNow').textContent = t; $('trafficNow').title = layers.traffic.tip || ''; renderEvents(); };

// ------------------------------------------------------------------ location corrections
function updateCorrCount() { // [ADMIN]
  if (!ADMIN || !$('corrCount')) return;
  const n = Object.keys(layers.ownCorrections()).length + Object.keys(cams.own()).length + Object.keys(ownFacades()).length;
  $('corrCount').textContent = n ? `Máte ${n} ${n === 1 ? 'opravu' : n < 5 ? 'opravy' : 'oprav'}.` : '';
  $('corrDownload').disabled = !n;
}
if (ADMIN) $('corrDownload').onclick = downloadCorrections; // [ADMIN]
updateCorrCount();

// ------------------------------------------------------------------ events timeline (right column)
function setEventsOpen(open) {
  if (open && $('events').hidden) track('Panel', { co: 'akce' });
  if (open && !$('card').hidden) $('cardClose').click();
  if (open && isPhone()) setTab(null); // on phones one sheet at a time
  if (open) { $('fcPop').hidden = true; $('fcTile').setAttribute('aria-expanded', 'false'); if (!$('aktual').hidden) setAktOpen(false); }
  $('events').hidden = !open;
  $('evtToggle').setAttribute('aria-pressed', String(open));
  if (open) renderEvents();
}
$('evtToggle').onclick = () => setEventsOpen($('events').hidden);
$('cardBack').onclick = () => { $('cardClose').click(); setEventsOpen(true); };
// timeline tabs: traffic (Waze, closures, public transport) / what is on in the city (GO TO BRNO events)
state.evtTab = 'city'; state.evtRange = 'today'; state.evtCat = ''; // (the city events first, the traffic one click further)
document.querySelectorAll('#evtTabs [data-t]').forEach(b => (b.onclick = () => {
  state.evtTab = b.dataset.t;
  document.querySelectorAll('#evtTabs [data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('evtFilter').hidden = state.evtTab !== 'city';
  renderEvents();
}));
document.querySelectorAll('#evtRange [data-r]').forEach(b => (b.onclick = () => {
  state.evtRange = b.dataset.r;
  document.querySelectorAll('#evtRange [data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderEvents();
}));
$('evtCat').onchange = () => { state.evtCat = $('evtCat').value; renderEvents(); };
function renderCityEvents() {
  const ol = $('evtList');
  ol.replaceChildren();
  if (!city.data.events.length) { ol.append(el('li', 'sep', 'Načítám…')); city.load().then(renderEvents); return; }
  if ($('evtCat').options.length <= 1) for (const c of city.categories()) $('evtCat').append(Object.assign(document.createElement('option'), { value: c, textContent: c }));
  const list = city.eventsIn(state.evtRange, state.evtCat);
  // an offer that runs for more than two weeks (guided tours "until 31. 12." etc.) is a standing offer, not an event
  const longRun = e => (e.to || e.from) - e.from > 14 * 864e5;
  const dated = list.filter(e => !longRun(e)), standing = list.filter(longRun);
  const item = (e, target) => {
    const li = el('li'), b = el('button', 't-event evt-city'); b.type = 'button';
    const txt = el('span', '', e.n);
    const when = e.to && fmtDay(e.to) !== fmtDay(e.from) ? (e.from < dayStart() ? `do ${fmtDay(e.to)}` : `${fmtDay(e.from)} – ${fmtDay(e.to)}`) : fmtDay(e.from);
    txt.append(el('small', 'when', when), el('small', '', [e.cats.join(', '), e.addr].filter(Boolean).join(' · ')));
    b.append(el('span', '', '★'), txt);
    b.onclick = () => { if (e.X != null) { flyTo(e.X, e.Y, Math.max(1.2, view().z)); fx.marker(e.X, e.Y); } card.fromEvents = Date.now(); showEvent(e); };
    li.append(b); target.append(li);
  };
  ol.append(el('li', 'sep', state.evtRange === 'today' ? 'Dnes' : state.evtRange === 'week' ? 'Dnes a tento týden' : 'Akce s datem'));
  if (!dated.length) ol.append(el('li', 'sep', 'Žádné akce s konkrétním datem'));
  for (const e of dated.slice(0, 120)) item(e, ol);
  if (standing.length) {
    const li = el('li'), det = el('details', 'evt-standing');
    det.append(el('summary', '', `Stálá nabídka (${standing.length})`));
    const inner = el('ol', 'evt-list');
    for (const e of standing.slice(0, 80)) item(e, inner);
    det.append(inner); li.append(det); ol.append(li);
  }
  ol.append(el('li', 'sep', 'Zdroj: GO TO BRNO (www.gotobrno.cz), otevřená data města Brna'));
}
// ------------------------------------------------------------------ Aktuálně: what is topical in the city right now (right column)
// A short list of notes, each with a date, a title, a line of text, a link and a theme — the layer whose points
// the map lights up while the note is chosen: the icons half again as big with a pulsing ring, drawn at any zoom
// and never folded into a cluster, every other icon half see-through. The notes are a list here for now
// (data/aktualne.json once there are more of them); the texts of the vote follow its phase in data/paro.json.
function aktualneItems() {
  const out = [];
  const pd = paro.data, ph = paro.phase(), v = pd.voting;
  if (v) {
    const n = pd.items.filter(p => paro.shown(p)).length, nc = pd.items.filter(p => p.city).length;
    const endT = new Date(v.end).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
    const text = ph === 'voting' ? `Hlasování o návrzích participativního rozpočtu běží do ${paroDay(v.end)} ${endT}. Hlasovat může každý s trvalým pobytem v Brně. V mapě je ${plural(n, 'návrh', 'návrhy', 'návrhů')} s místem${nc ? ` a ${plural(nc, 'návrh', 'návrhy', 'návrhů')} pro celé město je v panelu Vrstvy` : ''}.`
      : ph === 'before' ? `Návrhy letošního ročníku jsou v mapě, hlasování začíná ${paroDay(v.start)}.`
      : ph === 'counting' ? `Hlasování skončilo, výsledky budou ${paroDay(v.announcement)}. V mapě jsou všechny návrhy, které šly do hlasování.`
      : `Vítězné projekty letošního hlasování: ${plural(n, 'projekt', 'projekty', 'projektů')} s místem v mapě.`;
    out.push({ id: 'paro', when: ph === 'voting' ? `Hlasování do ${paroDay(v.end)}` : ph === 'before' ? `Od ${paroDay(v.start)}` : ph === 'counting' ? `Výsledky ${paroDay(v.announcement)}` : 'Výsledky', title: `Dáme na vás ${pd.year}: ${ph === 'voting' ? 'hlasujte o nápadech pro Brno' : ph === 'results' ? 'vítězné projekty' : 'návrhy pro Brno'}`, text, focus: 'paro', layer: 'paro', link: [PARO_WEB, ph === 'voting' ? 'Hlasovat na damenavas.cz' : 'damenavas.cz'] });
  }
  const ev = city.eventsIn('week').filter(e => e.X != null), today = city.eventsIn('today').filter(e => e.X != null);
  out.push({ id: 'events', when: 'Tento týden', title: 'Akce ve městě', text: ev.length ? `${plural(today.length, 'akce dnes', 'akce dnes', 'akcí dnes')}, ${plural(ev.length, 'akce', 'akce', 'akcí')} do konce týdne s místem v mapě (GO TO BRNO). Lístek kalendáře stojí tam, kde se akce koná.` : 'Načítám akce GO TO BRNO…', focus: 'events', layer: 'events', more: ['Seznam akcí', () => setEventsOpen(true)] });
  return out;
}
function renderAktualne() {
  const ol = $('aktList');
  ol.replaceChildren();
  for (const it of aktualneItems()) {
    const li = el('li', state.focus === it.focus ? 'on' : '');
    li.append(el('span', 'when', it.when), el('h3', '', it.title), el('p', '', it.text));
    const btns = el('div', 'btns');
    if (it.focus) {
      const b = el('button', 'px-btn small', state.focus === it.focus ? 'Zrušit zvýraznění' : 'Zvýraznit v mapě'); b.type = 'button';
      b.setAttribute('aria-pressed', String(state.focus === it.focus));
      b.onclick = () => setFocus(state.focus === it.focus ? null : it.focus);
      btns.append(b);
    }
    if (it.more) { const b = el('button', 'px-btn small', it.more[0]); b.type = 'button'; b.onclick = it.more[1]; btns.append(b); }
    if (it.link) { const a = el('a', 'px-btn small', it.link[1]); a.href = it.link[0]; a.target = '_blank'; a.rel = 'noopener'; btns.append(a); }
    li.append(btns); ol.append(li);
  }
}
// the points of a theme (image coordinates): to see whether any is in view
function focusPoints(f) {
  if (f === 'paro') { paro.positions(); return paro.data.items.filter(p => paro.shown(p) && p.X != null).map(p => [p.X, p.Y]); }
  if (f === 'events') return city.eventsIn('week').filter(e => e.X != null).map(e => [e.X, e.Y]);
  return [];
}
function setFocus(f) {
  state.focus = f;
  if (f) {
    // the layer of the theme on (the switch in Vrstvy follows), and a view with its points when none is on the screen
    const box = $(`l-${f}`);
    if (box && !box.checked) setLayer(f, true);
    const v = view(), cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
    const pts = focusPoints(f);
    if (pts.length && !pts.some(([X, Y]) => { const x = v.ox + X * v.k, y = v.oy + Y * v.k; return x >= 0 && y >= 0 && x <= cw && y <= ch; })) goHome();
  }
  $('aktToggle').toggleAttribute('data-focus', !!f);
  $('aktToggle').title = f ? 'Aktuálně: v mapě je zvýrazněné téma (tady se zvýraznění ruší)' : 'Aktuálně: co je v Brně právě teď aktuální, se zvýrazněním v mapě';
  if (!$('aktual').hidden) renderAktualne();
}
function setAktOpen(open) {
  if (open && $('aktual').hidden) track('Panel', { co: 'aktualne' });
  if (open && !$('card').hidden) $('cardClose').click();
  if (open && isPhone()) setTab(null); // on phones one sheet at a time
  if (open) { $('fcPop').hidden = true; $('fcTile').setAttribute('aria-expanded', 'false'); if (!$('events').hidden) setEventsOpen(false); }
  $('aktual').hidden = !open;
  $('aktToggle').setAttribute('aria-pressed', String(open));
  if (open) { renderAktualne(); Promise.all([paro.load(), city.load()]).then(() => { if (!$('aktual').hidden) renderAktualne(); }); }
}
$('aktToggle').onclick = () => setAktOpen($('aktual').hidden);
$('aktClose').onclick = () => setAktOpen(false);

// themed routes (GO TO BRNO)
// the card of a whole route: its introduction and a button to walk it stop by stop
function showRouteIntro(r) {
  const s = el('div', 'sec gotobrno');
  s.append(el('h3', '', 'Tematická trasa · GO TO BRNO'));
  if (r.t) s.append(el('p', '', r.t.length > 700 ? `${r.t.slice(0, 700).replace(/\s+\S*$/, '')}…` : r.t));
  const btns = el('div', 'btns');
  const go = el('button', 'px-btn', `Začít trasu: 1. ${r.stops[0].n}`); go.type = 'button'; go.onclick = () => showRouteStop(r, 0);
  const play = el('button', 'px-btn', '▶ Přehrát trasu'); play.type = 'button'; play.title = 'Mapa sama proletí zastávky jednu po druhé; zastavíte ji kliknutím nebo posunem mapy'; play.onclick = () => playTour(r);
  btns.append(play);
  btns.append(go);
  if (isUrl(r.img)) btns.append(srcBtn(r.img, 'Foto: GO TO BRNO'));
  s.append(btns, el('span', 'credit', 'Zdroj: www.gotobrno.cz (TIC BRNO), otevřená data města Brna, CC BY. Pořadí zastávek je seřazené jako jedna procházka.'));
  card({ kind: 'trasa-uvod', title: r.theme, text: `${r.stops.length} zastávek`, extra: s });
  city.setRoute(r, -1);
}
function renderRouteList() {
  const R = city.route().r;
  const ol = $('routeStops');
  ol.replaceChildren();
  if (!R) return;
  R.stops.forEach((s, i) => {
    const li = el('li'), b = el('button', '', `${i + 1}. ${s.n}`); b.type = 'button';
    if (i === city.route().i) b.setAttribute('aria-current', 'step');
    b.onclick = () => showRouteStop(R, i);
    li.append(b); ol.append(li);
  });
}
city.load().then(() => {
  for (const r of city.data.routes) $('routeSel').append(Object.assign(document.createElement('option'), { value: r.theme, textContent: `${r.theme} (${r.stops.length})` }));
});
$('routeSel').onchange = () => {
  const r = city.data.routes.find(x => x.theme === $('routeSel').value) || null;
  if (r) track('Nástroj', { nastroj: 'trasa', hodnota: r.theme });
  city.setRoute(r, -1);
  renderRouteList();
  if (r) showRouteIntro(r);
  if (r) {
    // show the whole route
    const xs = r.stops.map(s => s.X), ys = r.stops.map(s => s.Y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const vw = $('map').clientWidth || 1000;
    flyTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min(1.4, Math.max(0.12, (1.1 * vw) / Math.max(200, w, h * 1.8))));
  }
};
$('evtClose').onclick = () => setEventsOpen(false);
function renderEvents() {
  const T = layers.traffic.data;
  const items = [];
  if (T) {
    for (const a of T.alerts) items.push({ t: a.t, kind: a.type === 'ROAD_CLOSED' ? 'closed' : a.type === 'ACCIDENT' ? 'accident' : 'hazard', icon: a.type === 'ROAD_CLOSED' ? '⛔' : '⚠', title: a.type === 'ROAD_CLOSED' ? 'Uzavírka' : a.type === 'ACCIDENT' ? 'Nehoda' : 'Překážka na silnici', place: a.street, lon: a.lon, lat: a.lat, open: () => showTraffic({ alert: a }) });
    for (const j of T.jams) if (j.level >= 3) items.push({ t: j.t, kind: 'jam', icon: '🚗', title: j.level >= 4 ? 'Velká kolona' : 'Kolona', place: `${j.street || ''}${j.delay > 0 ? ` · +${Math.round(j.delay / 60)} min` : ''}`, lon: j.path[Math.floor(j.path.length / 2)][0], lat: j.path[Math.floor(j.path.length / 2)][1], open: () => showTraffic({ jam: j }) });
  }
  // public transport closures and diversions valid now (IDS JMK), only those in the map
  try { for (const o of city.outagesNow()) if (o.X != null && Math.abs(o.lon - 16.606) < 0.2 && Math.abs(o.lat - 49.201) < 0.13) items.push({ t: o.from || Date.now(), kind: 'outage', icon: '🚌', title: `Výluka: ${o.title}`, place: `linky ${o.lines.join(', ')}${o.to ? ` · do ${fmtDay(o.to)}` : ''}`, lon: o.lon, lat: o.lat, open: () => showOutage(o) }); } catch { /* not loaded yet */ }
  let wAlerts = []; try { wAlerts = forecast ? forecast.alerts() : []; } catch { /* forecast panel not set up yet */ }
  for (const a of wAlerts) items.push({ t: Date.parse(a.onset) || Date.now(), kind: 'alert', icon: '⚡', title: `Výstraha: ${a.event}`, place: a.expires ? `do ${new Date(a.expires).toLocaleString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'ČHMÚ', lon: 16.608, lat: 49.195, open: () => openForecastFull() });
  items.sort((a, b) => b.t - a.t);
  $('evtCount').textContent = items.length ? String(items.length) : '';
  if ($('events').hidden) return;
  if (state.evtTab === 'city') { renderCityEvents(); return; }
  const ol = $('evtList');
  ol.replaceChildren();
  const hhmm = t => new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const add = (it, time) => {
    const li = el('li'), b = el('button', `t-${it.kind}`);
    b.type = 'button';
    const txt = el('span', '', it.title);
    if (it.place) txt.append(el('small', '', it.place));
    b.append(el('span', 'tm', time), el('span', '', it.icon), txt);
    b.onclick = () => {
      const [X, Y] = layers.llToImg(it.lon, it.lat);
      flyTo(X, Y, Math.max(1.2, view().z)); fx.marker(X, Y); card.fromEvents = Date.now(); it.open();
    };
    li.append(b); ol.append(li);
  };
  if (!items.length) ol.append(el('li', 'sep', T ? 'Žádné nové události' : 'Načítám…'));
  for (const it of items.slice(0, 60)) add(it, hhmm(it.t));
  // long-term closures (no time — they last weeks or months)
  const C = layers.clos();
  if (C && C.items.length) {
    ol.append(el('li', 'sep', 'Dlouhodobé uzavírky'));
    const seen = new Set();
    for (const c of C.items) {
      const name = c.n || 'úsek silnice';
      if (seen.has(name)) continue;
      seen.add(name);
      add({ kind: 'long', icon: '⛔', title: name, place: c.open ? `do ${c.open.split('-').reverse().map(x => x.replace(/^0/, '')).join('. ')}` : 've výstavbě', lon: c.p[0], lat: c.p[1], open: () => showTraffic({ closure: c, source: C.source }) }, '');
    }
  }
  const W = state.layers.works && layers.works();
  if (W) {
    const seen = new Set(C ? C.items.map(c => c.n) : []);
    const full = W.items.filter(w => w.kind === 'uplna' && !w.osm).sort((a, b) => (b.len || 0) - (a.len || 0)); // the longer closures first
    for (const soon of [false, true]) {
      const list = full.filter(w => !!w.soon === soon).slice(0, soon ? 20 : 50);
      if (!list.length) continue;
      ol.append(el('li', 'sep', soon ? 'Chystané uzavírky (povolené městem)' : 'Uzavírky povolené městem'));
      for (const w of list) {
        const name = w.n || `${w.street} ${w.usek}`.trim();
        if (seen.has(name)) continue;
        seen.add(name);
        add({ kind: 'long', icon: '🚧', title: name, place: `${w.street}${soon ? ` · od ${czd(w.from)}` : ''} · do ${czd(w.to)}`, lon: w.lon, lat: w.lat, open: () => showWork(w) }, '');
      }
    }
  }
}
// public transport: live positions (KORDIS stream) or the timetable
function setMhdMode(mode) {
  state.mhdMode = mode;
  document.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.m === mode)));
  if (mode === 'live') layers.live.start(); else layers.live.stop();
  updateMhdNote();
}
function updateMhdNote() {
  const L = layers.live;
  $('mhdNow').textContent = state.mhdMode === 'live'
    ? (L.alive() ? `Živě: ${L.count()} vozidel MHD (KORDIS JMK).` : 'Připojuji živé polohy… mezitím jezdí vozidla podle jízdního řádu.')
    : 'Vozidla jezdí podle platného jízdního řádu IDS JMK.';
}
document.querySelectorAll('[data-m]').forEach(b => (b.onclick = () => { if (b.dataset.m !== state.mhdMode) track('Vrstva', { vrstva: 'mhd-zive', stav: b.dataset.m === 'live' ? 'zap' : 'vyp' }); setMhdMode(b.dataset.m); }));
setMhdMode('live');
setInterval(updateMhdNote, 5000);

// ------------------------------------------------------------------ city projects list
// the list is filled the first time its section is opened
function fillProjects() {
  if (fillProjects.done) return;
  if (!layers.proj.list) { setTimeout(fillProjects, 400); return; }
  fillProjects.done = true;
  $('projUpdated').textContent = `Data k ${layers.proj.updated.split('-').reverse().join('. ')}.`;
  const ul = $('projList');
  const items = layers.proj.cobude.slice().sort((a, b) => a.t.localeCompare(b.t, 'cs'));
  for (const c of items) {
    const li = el('li'), btn = el('button', '', c.t);
    btn.setAttribute('aria-label', c.t);
    btn.type = 'button';
    const p = layers.proj.list.find(q => q.cb && q.cb.url === c.url);
    if (!p) { const sm = el('small', '', ' · celé město'); sm.style.color = 'var(--muted)'; btn.append(sm); }
    btn.onclick = () => {
      if (p) {
        const [X, Y] = layers.llToImg(p.g[0][0], p.g[0][1]);
        flyTo(X, Y, Math.max(1.1, view().z)); fx.marker(X, Y); showProject(p);
      } else card({ kind: 'cobude', title: c.t, projects: [{ id: c.url, n: c.t, cb: c }] });
      if (matchMedia('(max-width: 640px)').matches) setPanelOpen(false);
    };
    li.append(btn); ul.append(li);
  }
}
$('liveBox').addEventListener('toggle', () => { if ($('liveBox').open) fillProjects(); });

// ------------------------------------------------------------------ layers
// (zoo is not in the list: it has no switch in the page and is always drawn)
// One way in for every switch of a layer: the tick in Vrstvy, the quick tiles (src/quick.js) and Aktuálně all go through
// setLayer, so the state, the tick and the level dots always agree.
let quick = null; // the quick tiles, made below
function setLayer(k, on) {
  on = !!on;
  const box = $(`l-${k}`);
  if (box) box.checked = on;
  else if (!(k in state.layers)) return;
  state.layers[k] = on;
  if (k === 'labels') $('map').classList.toggle('nolabels', !on);
  if (k === 'hover' && !on) fx.hover = null;
  if (k === 'paro') updateParoPanel.touched = true;
  if (!on && state.focus === k) setFocus(null); // the theme of Aktuálně goes with its layer
  secCounts();
  if (quick) quick.render();
}
for (const k of ['labels', 'traffic', 'hover', 'jams', 'closures', 'works', 'names', 'building', 'planCity', 'planPrivate', 'bigplans', 'paro', 'mhd', 'mhdStops', 'mhdOutages', 'air', 'cams', 'meteo', 'pano', 'events', 'monuments', 'people', 'pitka', 'wc', 'stin', 'kose', 'smView', 'smPool', 'smTree', 'smArt', 'smCross', 'smPlaque']) {
  const box = $(`l-${k}`);
  if (!box) { state.layers[k] = false; continue; } // (not in this version of the page, or commented out for now)
  state.layers[k] = box.checked; // (the page and the state start the same; the ticks in index.html are the truth)
  box.addEventListener('change', e => { track('Vrstva', { vrstva: k, stav: e.target.checked ? 'zap' : 'vyp' }); setLayer(k, e.target.checked); });
}
$('map').classList.toggle('nolabels', !state.layers.labels);
// the time range of the events layer (the radios under Akce in Vrstvy; level 1–3 of the Akce tile)
function setEventsRange(r) {
  state.eventsRange = r;
  document.querySelectorAll('input[name="evr"]').forEach(x => (x.checked = x.value === r));
  if (quick) quick.render();
}
document.querySelectorAll('input[name="evr"]').forEach(r => r.addEventListener('change', () => { if (r.checked) setEventsRange(r.value); }));
// The sections of the Vrstvy pane: each summary shows how much of the section is on ("3/6", or the name of the
// datová mapa chosen); which sections are open is remembered in this browser.
function secCounts() {
  document.querySelectorAll('#pane-layers .lsec').forEach(sec => {
    const cnt = sec.querySelector(':scope > summary > .cnt');
    if (!cnt) return;
    const radios = [...sec.querySelectorAll('input[type="radio"]')];
    if (radios.length && !sec.querySelector('input[type="checkbox"]')) { const on = radios.find(r => r.checked && r.value); cnt.textContent = on ? on.parentElement.textContent.trim() : 'vypnuto'; cnt.classList.toggle('off', !on); return; }
    const boxes = [...sec.querySelectorAll('input[type="checkbox"]')], on = boxes.filter(b => b.checked).length;
    cnt.textContent = `${on}/${boxes.length}`;
    cnt.classList.toggle('off', !on);
  });
}
secCounts();
document.querySelectorAll('#pane-layers .lsec').forEach(sec => {
  const key = `izo-sec-${sec.dataset.sec}`;
  try { const v = localStorage.getItem(key); if (v !== null) sec.open = v === '1'; } catch { /* private mode */ }
  sec.addEventListener('toggle', () => { try { localStorage.setItem(key, sec.open ? '1' : '0'); } catch { /* private mode */ } });
});

// ------------------------------------------------------------------ rychlé přepínače skupin vrstev (src/quick.js)
// the pixel icons in place of the font glyphs of the tiles, the tabs and the zoom buttons; then the tiles themselves
placePxIcons();
quick = createQuick({ state, setLayer, setEventsRange, mount: $('quick'), shown, onStep: (key, level) => track('Přepínač', { skupina: key, uroven: level }) });

// ------------------------------------------------------------------ datové mapy
// One quantity painted over the city (src/datamap.js): the map goes grey, the roofs and the ground get the colour
// of their band. Time stands at day while it is on (the colours would not read at night); cars and people hide.
let dmSaved = null; // the time setting from before the map was switched on
function setDatamap(key) {
  key = DATAMAPS[key] ? key : null;
  const was = state.datamap;
  state.datamap = key;
  datamap.set(key);
  fx.setDatamap(!!key);
  document.querySelectorAll('input[name="dm"]').forEach(r => (r.checked = r.value === (key || '')));
  secCounts();
  if (key && !was) { dmSaved = { realTime: $('realTime').checked, night: $('night').value }; $('realTime').checked = false; setNight(0); }
  if (!key && was && dmSaved) { if (dmSaved.realTime) { $('realTime').checked = true; realTime(); } else setNight(+dmSaved.night); dmSaved = null; }
  if (!key && $('dmTip')) $('dmTip').hidden = true;
}
document.querySelectorAll('input[name="dm"]').forEach(r => {
  r.addEventListener('change', () => { if (!r.checked) return; if (r.value !== (state.datamap || '')) track('Vrstva', { vrstva: `dm-${r.value || state.datamap}`, stav: r.value ? 'zap' : 'vyp' }); setDatamap(r.value); });
  r.addEventListener('click', () => { if (r.value && r.value === state.datamap) datamap.all(); }); // the map already on: all its classes again
});
// the legend of the map shown: a click on a class switches it off or on (the last lit one stays lit),
// "jen" shows that class alone; a click on the name of the map lights all of them again
function dmLegend() {
  const box = $('dmLegend');
  if (!box) return;
  const def = datamap.def();
  box.hidden = !def;
  box.replaceChildren();
  if (!def) return;
  const lit = datamap.lit(), allLit = lit.every(Boolean);
  const ul = el('ul', 'dm-classes');
  def.classes.forEach((c, i) => {
    const li = el('li', 'dm-row'), b = el('button', 'dm-class');
    b.type = 'button';
    const sw = el('span', 'dm-sw'); sw.style.background = c.c;
    b.append(sw, document.createTextNode(c.n));
    b.setAttribute('aria-pressed', String(lit[i]));
    b.classList.toggle('dim', !lit[i]);
    b.title = lit[i] ? 'Kliknutím tuto třídu schováte' : 'Kliknutím tuto třídu zase ukážete';
    b.onclick = () => { if (!datamap.toggle(i)) toast('Aspoň jedna třída musí zůstat zapnutá; mapu vypnete volbou Vypnuto.'); };
    const solo = el('button', 'dm-only', 'jen');
    solo.type = 'button'; solo.title = `Ukázat jen ${c.n}`; solo.setAttribute('aria-label', `Ukázat jen ${c.n}`);
    solo.onclick = () => datamap.solo(i);
    li.append(b, solo); ul.append(li);
  });
  const when = datamap.updated ? `, data k ${datamap.updated.split('-').reverse().join('. ')}` : '';
  const hint = el('p', 'livenote dm-hint', allLit ? 'Kliknutím třídu schováte, „jen“ ukáže jen tu jednu.' : `Kliknutím na název mapy (${def.n}) rozsvítíte zase všechny třídy.`);
  box.append(ul, hint, el('p', 'livenote', `${def.what} Zdroj: ${def.source}${when}.`));
}
datamap.onChange(dmLegend);
// the value under the cursor: of the building under it, otherwise of the ground
function dmTip(sx, sy, X, Y) {
  const tip = $('dmTip');
  if (!tip) return;
  if (!state.datamap) { tip.hidden = true; return; }
  let v = 0;
  if (hover) {
    const cx = Math.floor(hover[0][0] / CH), cy = Math.floor(hover[0][1] / CH);
    for (let dx = -1; dx <= 1 && !v; dx++) for (let dy = -1; dy <= 1 && !v; dy++) {
      const list = chunk(cx + dx, cy + dy), i = list ? list.indexOf(hover) : -1;
      if (i >= 0) v = datamap.valueOf(`${cx + dx}_${cy + dy}`, i);
    }
  } else v = datamap.valueAt(X, Y);
  const txt = datamap.text(v);
  if (!txt) { tip.hidden = true; return; }
  tip.textContent = txt; tip.hidden = false;
  tip.style.left = `${Math.round(sx + 14)}px`; tip.style.top = `${Math.round(sy - 30)}px`;
}

// ------------------------------------------------------------------ panel, menu, dialogs
// tabs: each opens one pane under the search (on phones a sheet above the bottom bar); the open tab closes it
let openTab = null;
function setTab(t) {
  if (t && t !== openTab) track('Panel', { co: t });
  openTab = t;
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.tab === t)));
  for (const p of document.querySelectorAll('#panel .pane')) p.hidden = p.id !== `pane-${t}`;
  document.body.classList.toggle('pane-open', !!t);
  if (t && isPhone()) { if (!$('card').hidden) $('cardClose').click(); if (!$('events').hidden) setEventsOpen(false); if (!$('aktual').hidden) setAktOpen(false); $('fcPop').hidden = true; }
  if (t === 'explore' && $('liveBox').open) fillProjects();
}
document.querySelectorAll('#tabs [data-tab]').forEach(b => (b.onclick = () => setTab(openTab === b.dataset.tab ? null : b.dataset.tab)));
document.querySelectorAll('#panel .pane-close').forEach(b => (b.onclick = () => setTab(null)));
addEventListener('keydown', e => { if (e.key === 'Escape' && openTab && !document.querySelector('dialog[open]')) setTab(null); });
// (older callers: closing the panel = closing the open pane, and on phones the fold-outs under the search too)
function setPanelOpen(open) { if (!open) { setTab(null); if (isPhone()) document.querySelectorAll('#panel .quick details[open]').forEach(d => (d.open = false)); } }
function setPw() { document.documentElement.style.setProperty('--pw', `${$('panel').offsetWidth}px`); }
setPw();
addEventListener('resize', setPw);
$('fold').onclick = () => {
  const folded = document.body.classList.toggle('folded');
  $('fold').textContent = folded ? '›' : '‹';
  $('fold').setAttribute('aria-expanded', String(!folded));
  $('fold').setAttribute('aria-label', folded ? 'Vysunout panel' : 'Zasunout panel');
  $('fold').title = folded ? 'Vysunout panel' : 'Zasunout panel';
};
$('help').onclick = () => { track('Panel', { co: 'napoveda' }); $('helpDlg').showModal(); };
// the sections of the panel that open by themselves (details): which ones people unfold
for (const [id, co] of [['placesBox', 'pribehy'], ['liveBox', 'projekty'], ['legendBox', 'legenda']]) { const d = $(id); if (d) d.addEventListener('toggle', () => { if (d.open) track('Panel', { co }); }); }
{ const d = document.querySelector('#panel details.about'); if (d) d.addEventListener('toggle', () => { if (d.open) track('Panel', { co: 'jak-vzniklo' }); }); }
$('helpClose').onclick = () => $('helpDlg').close();

// ------------------------------------------------------------------ overview of all data in the map
let datasets = null;
const MODE = { live: ['živě', 'm-live'], regular: ['obnovováno', 'm-regular'], snapshot: ['stav k datu', 'm-snapshot'] };
const fmtNum = n => (n == null ? '–' : n.toLocaleString('cs-CZ'));
const czDay = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('cs-CZ') : '');
function renderData() {
  const q = $('dataSearch').value.trim().toLowerCase();
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const qn = norm(q);
  const list = datasets.filter(d => !qn || norm([d.name, d.what, d.owner, d.licence, d.note, MODE[d.mode][0], d.unit].join(' ')).includes(qn));
  const by = $('dataSort').value;
  const order = { live: 0, regular: 1, snapshot: 2 };
  list.sort((a, b) => by === 'name' ? a.name.localeCompare(b.name, 'cs')
    : by === 'date' ? (order[a.mode] - order[b.mode]) || (b.date || '').localeCompare(a.date || '')
      : by === 'mode' ? (order[a.mode] - order[b.mode]) || a.name.localeCompare(b.name, 'cs')
        : (b.count ?? -1) - (a.count ?? -1) || a.name.localeCompare(b.name, 'cs'));
  // highlight the searched words
  const hi = (text, cls) => {
    const e = el('span', cls);
    const t = text || '';
    if (!qn) { e.textContent = t; return e; }
    const i = norm(t).indexOf(qn);
    if (i < 0) { e.textContent = t; return e; }
    e.append(t.slice(0, i), el('mark', '', t.slice(i, i + qn.length)), t.slice(i + qn.length));
    return e;
  };
  $('dataRows').replaceChildren(...list.map(d => {
    const tr = el('tr');
    const c1 = el('td'); c1.append(hi(d.name, 'dname'), el('br'), hi(d.what, 'dwhat'));
    const c2 = el('td'); c2.append(hi(d.owner, ''), el('br'), hi(d.licence ? `Licence: ${d.licence}` : '', 'dnote'));
    if (d.links && d.links.length) { const l = el('div', 'dlinks'); for (const [label, href] of d.links) { const a = el('a', '', `${label} ↗`); a.href = href; a.target = '_blank'; a.rel = 'noopener'; l.append(a); } c2.append(l); }
    const c3 = el('td', 'num'); c3.append(el('span', '', fmtNum(d.count)), el('br'), el('span', 'dnote', d.unit || ''));
    const c4 = el('td'); const [mt, mc] = MODE[d.mode]; c4.append(el('span', mc, mt));
    if (d.date) c4.append(el('br'), el('span', 'dnote', czDay(d.date)));
    if (d.note) c4.append(el('br'), el('span', 'dnote', d.note));
    tr.append(c1, c2, c3, c4);
    return tr;
  }));
  $('dataCount').textContent = `${list.length} z ${datasets.length} datových sad.`;
}
async function openData(e) {
  if (e) e.preventDefault();
  track('Panel', { co: 'data' });
  if (!datasets) { try { datasets = await loadShared('datasets.json'); } catch { datasets = []; } }
  renderData();
  if ($('helpDlg').open) $('helpDlg').close();
  $('dataDlg').showModal();
}
$('dataOpen').onclick = openData;
$('dataOpen2').onclick = openData;
$('dataClose').onclick = () => $('dataDlg').close();
$('dataSearch').addEventListener('input', () => datasets && renderData());
$('dataSort').addEventListener('change', () => datasets && renderData());
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });
$('fbShare').addEventListener('click', () => { track('Sdílení', { co: 'pohled', jak: 'facebook' }); $('fbShare').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`; });

// ------------------------------------------------------------------ controls
$('zin').onclick = () => { touched = true; viewer.viewport.zoomBy(1.6); };
$('zout').onclick = () => { touched = true; viewer.viewport.zoomBy(1 / 1.6); };
$('home').onclick = () => { track('Nástroj', { nastroj: 'domu' }); goHome(); };
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function shareUrl() {
  const c = viewer.viewport.getCenter(true);
  const v = view();
  const [lon, lat] = imgToLonLat(c.x * GEO.W, c.y * GEO.W);
  const mpp = (1 / GEO.A / v.k).toFixed(2);
  const extra = [state.season !== 'summer' ? state.season : '', state.night ? Math.round(state.night * 100) : '', state.weather !== 'clear' ? state.weather : isSummerLook() ? 'leto' : '', ROT ? `r${ROT}` : '', state.datamap ? `d${state.datamap}` : ''];
  while (extra.length && extra[extra.length - 1] === '') extra.pop();
  return `${location.origin}${location.pathname}#@${lat.toFixed(5)},${lon.toFixed(5)},${mpp}${extra.length ? ',' + extra.join(',') : ''}`;
}
async function share() {
  const url = shareUrl();
  track('Sdílení', { co: 'pohled', jak: navigator.share && matchMedia('(max-width: 640px)').matches ? 'share' : 'schranka' });
  history.replaceState(null, '', url);
  try {
    if (navigator.share && matchMedia('(max-width: 640px)').matches) await navigator.share({ title: 'Brno 2000', url });
    else { await navigator.clipboard.writeText(url); toast('Odkaz na tento pohled je zkopírovaný'); }
  } catch { toast('Odkaz je v adresním řádku'); }
}
$('share').onclick = share;
$('mShare').onclick = share;
// "Vila Tugendhat" -> "vila-tugendhat"
function placeSlug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
// open a place from its link: stories, Wikipedia tags, GO TO BRNO places, city projects
async function openPlaceLink(slug) {
  await ready; await city.load();
  for (let i = 0; i < 40 && !(layers.proj.list && data.wikiPois.length); i++) await new Promise(r => setTimeout(r, 250));
  // from a link the reader has not seen the map yet: closer than from the list (1 px = 1 m) and the marker stays longer
  const Z = isPhone() ? 5 : 6, ZP = 3, MS = 7000;
  card.fromLink = true; // the card counts as opened from a link (src/stats.js)
  const story = data.stories.find(s => placeSlug(s.n) === slug);
  if (story) { openStory(story); flyTo(story.X, story.Y, Math.max(Z, view().z)); fx.marker(story.X, story.Y, MS); return; }
  const w = data.wikiPois.find(p => placeSlug(p[0]) === slug);
  if (w) { flyTo(w[2], w[3], Math.max(Z, view().z)); showWikiPoi(w); fx.marker(w[2], w[3], MS); return; }
  city.positions();
  const pl = city.data.places.find(p => placeSlug(p.n) === slug);
  if (pl) { flyTo(pl.X, pl.Y, Math.max(Z, view().z)); showPlace(pl); fx.marker(pl.X, pl.Y, MS); return; }
  const pr = (layers.proj.list || []).find(p => placeSlug(p.cb ? p.cb.t : p.n) === slug);
  if (pr) { const [X, Y] = layers.llToImg(pr.g[0][0], pr.g[0][1]); flyTo(X, Y, Math.max(ZP, view().z)); showProject(pr); fx.marker(X, Y, MS); return; }
  await paro.load(); paro.positions();
  const pa = paro.data.items.find(p => placeSlug(p.n) === slug);
  if (pa) { if (!pa.city) flyTo(pa.X, pa.Y, Math.max(ZP, view().z)); showParo(pa, false, MS); return; }
  card.fromLink = false;
  track('Chyba', { co: 'misto-nenalezeno', detail: slug });
  toast('Místo z odkazu jsem nenašel');
}
// a #misto/ link pasted or clicked while the map is already open
window.addEventListener('hashchange', () => { if (/^#misto\//.test(location.hash)) restoreFromHash(); });
function restoreFromHash() {
  const lm = location.hash.match(/^#misto\/([a-z0-9-]+)/);
  if (lm) { openPlaceLink(lm[1]); return; }
  const m = location.hash.match(/^#@([\d.]+),([\d.]+),([\d.]+)(?:,(\w*))?(?:,(\d*))?(?:,(\w*))?(?:,(?:r(\d))?)?(?:,d(\w+))?/);
  if (!m) return;
  // (older shared links may carry a rotation: the map now always has north up)
  const [X, Y] = lonLatToImg(+m[2], +m[1]);
  flyTo(X, Y, 2 / +m[3], true);
  restoreRest(m);
}
function restoreRest(m) {
  if (m[4] || m[5]) $('realTime').checked = false; // a shared view keeps its own season and time
  if (m[4]) setSeason(m[4], true);
  if (m[5]) setNight(+m[5]);
  if (m[6] === 'leto') setLook('summer'); // a shared clear summer day
  else if (m[6]) setWeather(m[6]);
  if (m[8] && DATAMAPS[m[8]]) setDatamap(m[8]); // a shared datová mapa (…,dhluk)
}

// ------------------------------------------------------------------ rotation
const ROT_NAMES = ['sever', 'východ', 'jih', 'západ'];
let rotating = false;
async function rotateTo(r, keep) {
  if (rotating) return;
  rotating = true;
  // keep the same place and zoom on screen
  const v = view();
  const c = viewer.viewport.getCenter(true);
  const [lon, lat] = keep ? [keep[0], keep[1]] : imgToLonLat(c.x * GEO.W, c.y * GEO.W);
  const z = keep ? keep[2] : v.z;
  const wasHome = !touched;
  ROT = r;
  chunks.clear(); chunkAttrs.clear(); index = null; hover = null; fx.hover = null; fx.selected = null;
  lazyReset();
  await loadData();
  fx.resetTraffic(); fx.prepareLights();
  setSeason(state.season, false);
  if (wasHome && !keep) goHome(true);
  else { const [X, Y] = lonLatToImg(lon, lat); flyTo(X, Y, z, true); }
  toast(`Nahoře je ${ROT_NAMES[ROT]}`);
  rotating = false;
}
const rotate = d => rotateTo((ROT + d + 4) % 4);
// (the map has only the north-up view; rotating was removed to save rendering time and disk space)
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
});

// ------------------------------------------------------------------ minimap
const mini = $('mini');
const mctx = mini.getContext('2d');
const miniImgs = {};
function miniImg(s) {
  const key = `r${ROT}/${s}`;
  if (!miniImgs[key]) { const im = new Image(); im.src = `${MEDIA}tiles/${key}/mini.webp`; miniImgs[key] = im; }
  return miniImgs[key];
}
SEASONS.forEach(miniImg);
// north arrow in the top right corner of the minimap
function drawNorth() {
  const cx = mini.width - 13, cy = 13;
  const ang = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][ROT]; // where north points on screen
  mctx.fillStyle = 'rgba(27,35,51,.85)';
  mctx.fillRect(cx - 11, cy - 11, 22, 22);
  mctx.save();
  mctx.translate(cx, cy); mctx.rotate(ang + Math.PI / 2);
  mctx.fillStyle = '#c9583b';
  mctx.beginPath(); mctx.moveTo(0, -9); mctx.lineTo(5, 2); mctx.lineTo(-5, 2); mctx.closePath(); mctx.fill();
  mctx.fillStyle = '#eef1e6';
  mctx.beginPath(); mctx.moveTo(0, 9); mctx.lineTo(5, 2); mctx.lineTo(-5, 2); mctx.closePath(); mctx.fill();
  mctx.restore();
  mctx.fillStyle = '#eef1e6'; mctx.font = '700 9px "Atkinson Hyperlegible", sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  const lx = cx + Math.cos(ang) * 0, ly = cy + Math.sin(ang) * 0;
  void lx; void ly;
}
const MS = mini.width / GEO.W;
function drawMini() {
  mctx.fillStyle = '#1b2333';
  mctx.fillRect(0, 0, mini.width, mini.height);
  const im = miniImg(state.season);
  mctx.imageSmoothingEnabled = true;
  if (im.complete && im.naturalWidth) mctx.drawImage(im, 0, (mini.height - GEO.H * MS) / 2, mini.width, GEO.H * MS);
  const b = viewer.viewport.getBounds(true);
  const x0 = b.x * GEO.W * MS, y0 = b.y * GEO.W * MS + (mini.height - GEO.H * MS) / 2;
  mctx.strokeStyle = '#f2c66d';
  mctx.lineWidth = 2;
  mctx.strokeRect(Math.round(x0) + 1, Math.round(y0) + 1, Math.round(b.width * GEO.W * MS) - 2, Math.round(b.height * GEO.W * MS) - 2);
  const k = view().k;
  const m = 1 / GEO.A / k;
  drawNorth();
  if (!Number.isFinite(m) || m <= 0) { $('scale').textContent = ''; } else $('scale').textContent = `1 px = ${m >= 10 ? Math.round(m) : m >= 1 ? m.toFixed(1).replace('.', ',') : m.toFixed(2).replace('.', ',')} m`;
}
let dragging = false;
function miniPan(e) {
  const r = mini.getBoundingClientRect();
  const mx = ((e.clientX - r.left) / r.width) * mini.width, my = ((e.clientY - r.top) / r.height) * mini.height - (mini.height - GEO.H * MS) / 2;
  viewer.viewport.panTo(new OpenSeadragon.Point(mx / MS / GEO.W, my / MS / GEO.W));
}
mini.addEventListener('pointerdown', e => { dragging = true; mini.setPointerCapture(e.pointerId); miniPan(e); });
mini.addEventListener('pointermove', e => dragging && miniPan(e));
mini.addEventListener('pointerup', () => (dragging = false));

// ------------------------------------------------------------------ frame loop
let opened = false;
viewer.addHandler('open', () => {
  if (opened) return; // later opens are season / rotation swaps
  opened = true;
  if (!touched) goHome(true);
  $('loading').hidden = true;
});
// ------------------------------------------------------------------ riding along with a vehicle
// The map moves with the vehicle; a small box at the top right shows the next stops and "Vystoupit".
// Places on the way can be opened meanwhile; moving the map pauses following (the box offers "K vozu",
// following comes back by itself after 15 s).
let ride = null, rideAt = 0, ridePaused = 0, rideTimer = null, rideFollowAt = 0;
const pragueSec = () => { const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).split(' ')[1].split(':').map(Number); return s[0] * 3600 + s[1] * 60 + s[2]; };
const hhmmSec = sec => { const s = ((sec % 86400) + 86400) % 86400; return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
function startRide(m) {
  if (geo.mode === 'follow') { geo.mode = 'on'; geoUi(); }
  ride = m.id; rideAt = performance.now(); ridePaused = 0;
  track('Nástroj', { nastroj: 'nasednout', hodnota: m.line });
  layers.setRide(m.id);
  if (view().z < 1.5) { const p = layers.selectedPos(); if (p) flyTo(p[0], p[1], 2); }
  $('rideBox').hidden = false;
  $('rbTitle').textContent = `Linka ${m.line}`;
  renderRideBox();
  clearInterval(rideTimer); rideTimer = setInterval(renderRideBox, 2000);
  rideBtns();
}
function stopRide(quiet = false) {
  if (!ride) return;
  ride = null; layers.setRide(null);
  clearInterval(rideTimer); rideTimer = null;
  $('rideBox').hidden = true;
  rideBtns();
  if (!quiet) toast('Vystoupili jste');
}
function rideBtns() { document.querySelectorAll('.ride-btn').forEach(b => (b.textContent = ride && b.dataset.id === String(ride) ? '■ Vystoupit' : '▶ Nasednout')); }
// the next stops of the ridden vehicle with expected times (live delay included)
function renderRideBox() {
  const m = layers.rideVehicle();
  if (!m) return;
  const plan = m.live ? layers.matchPlan(m) : m;
  const it = plan ? layers.mhd.itinerary(plan) : [];
  const d = m.live ? Math.round(m.delay || 0) : 0, now = pragueSec();
  const to = m.live ? layers.mhd.stopName(m.final) || (it.length ? it[it.length - 1].name : '') : m.hs || (it.length ? it[it.length - 1].name : '');
  $('rbTitle').textContent = `Linka ${m.line} → ${to}`;
  $('rbDelay').textContent = m.live ? (d > 0 ? `zpoždění +${d} min` : d < 0 ? `napřed ${-d} min` : 'jede včas') : 'podle jízdního řádu';
  $('rbDelay').className = `rb-delay ${d >= 6 ? 'd3' : d >= 3 ? 'd2' : d >= 1 ? 'd1' : ''}`;
  const next = it.filter(o => o.time + d * 60 > now - 20).slice(0, 4);
  $('rbStops').replaceChildren(...(next.length ? next : [null]).map(o => {
    const li = el('li');
    if (!o) { li.textContent = 'Konečná'; return li; }
    const name = el('span', 'st', o.name);
    if (o.req) { const x = el('span', 'rq', '×'); x.title = 'Zastávka na znamení'; name.append(' ', x); }
    li.append(el('span', 'tm', hhmmSec(o.time + d * 60)), name);
    if (o.num) { li.classList.add('link'); li.title = 'Odjezdy z této zastávky'; li.onclick = () => showStopByNum(o.num, m.line); }
    return li;
  }));
  $('rbBack').hidden = !ridePaused;
}
$('rbStop').onclick = () => stopRide();
$('rbBack').onclick = () => { ridePaused = 0; $('rbBack').hidden = true; };
$('rbTitle').onclick = () => { const m = layers.rideVehicle(); if (m) showVehicle(m); };
function followRide(v) {
  if (ridePaused && Date.now() - ridePaused > 15000) { ridePaused = 0; $('rbBack').hidden = true; }
  const p = layers.ridePos();
  if (!p || performance.now() - p[2] > 6000) { if (performance.now() - rideAt > 6000) { stopRide(true); toast('Vůz zmizel z mapy, vystupujeme'); } return; }
  if (ridePaused) return;
  const cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
  // on a phone the card covers the bottom: keep the vehicle in the middle of the part above it
  let sy = ch / 2;
  if (isPhone() && !$('card').hidden) sy = Math.max(70, $('card').getBoundingClientRect().top / 2 + 30);
  const tx = p[0], ty = p[1] + (ch / 2 - sy) / v.k;
  // How often to follow depends on the zoom (v.k = screen px per metre): zoomed in, the vehicle moves fast
  // on the screen, so every frame; zoomed out it creeps by fractions of a pixel, and moving the map that
  // often makes the pixel-art map twitch, so then less often (up to 3 s), with a short glide, and only once
  // the vehicle is a few pixels off. Steps are always whole screen pixels (no shimmering of the pixels).
  const every = Math.max(0, Math.min(3000, 600 / v.k - 300)); // ms: ≤0.5 m/px every frame, 1 m/px 0.3 s, 2 m/px 0.9 s, 4 m/px 2.1 s
  const dead = every === 0 ? 1 : Math.min(12, 2 / v.k); // px the vehicle may drift before the map follows
  const now = performance.now();
  if (now - rideFollowAt < every) return;
  const c = viewer.viewport.getCenter(every > 0 ? false : true); // (while gliding: from where the glide ends)
  const cx0 = c.x * GEO.W, cy0 = c.y * GEO.W;
  const dx = Math.round((tx - cx0) * v.k), dy = Math.round((ty - cy0) * v.k);
  if (Math.hypot(dx, dy) < dead) return;
  rideFollowAt = now;
  viewer.viewport.panTo(new OpenSeadragon.Point((cx0 + dx / v.k) / GEO.W, (cy0 + dy / v.k) / GEO.W), every === 0);
}
viewer.addHandler('canvas-drag', () => { if (ride) { ridePaused = Date.now(); $('rbBack').hidden = false; } });

// ------------------------------------------------------------------ my position (GPS)
// first tap: find me and show me on the map; second tap: follow me (the map moves after me when I have moved,
// every 20 s on foot and every few seconds in a car); third tap: off. Dragging the map stops following, the dot stays.
// While the dot is on, the trail behind me is kept: the last 5 minutes, at most 1 km on foot and up to 3 km by
// car (the limit is 5 minutes of the pace of the last two minutes), fading out with age and distance.
const geo = { watch: null, pos: null, mode: 'off', first: false, centeredAt: 0, centerPos: null, trail: [], zoomHint: false };
const inBrno = (lon, lat) => lon > 16.41 && lon < 16.80 && lat > 49.075 && lat < 49.33;
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 72765, (a[1] - b[1]) * 111200);
const TRAIL_T = 300000, TRAIL_MIN = 1000, TRAIL_MAX = 3000;
function geoUi() {
  const b = $('locate');
  b.setAttribute('aria-pressed', String(geo.mode !== 'off'));
  b.classList.toggle('follow', geo.mode === 'follow');
  b.title = geo.mode === 'off' ? 'Moje poloha' : geo.mode === 'on' ? 'Sledovat moji polohu' : 'Vypnout polohu';
}
// a new fix: on the trail only when I have moved (a standing GPS wanders 10–20 m), bad and jumping fixes dropped
function trailAdd(lon, lat, acc, t) {
  if (acc > 50) return;
  const tr = geo.trail, last = tr[tr.length - 1];
  let d = 0, gap = '';
  if (last) {
    d = distM([lon, lat], [last.lon, last.lat]);
    const dt = (t - last.t) / 1000;
    if (d < Math.max(5, acc / 2)) return;
    if (dt > 0 && d / dt > 42) return; // over 150 km/h: a jump between fixes, not a ride
    if (dt > 120) { gap = 'break'; d = 0; } // the phone slept: the trail starts afresh, the old piece fades away
    else if (dt > 30) gap = 'dash'; // a tunnel: bridged with a dashed line
  }
  const [X, Y] = layers.llToImg(lon, lat);
  tr.push({ lon, lat, t, X, Y, d, gap });
  trailTrim(t);
}
// pace (m/s) of the last two minutes, from the trail itself (the speed from the GPS is missing on many phones)
function trailPace(now) {
  const tr = geo.trail;
  let s = 0, t0 = now;
  for (let i = tr.length - 1; i > 0 && now - tr[i].t < 120000; i--) { s += tr[i].d; t0 = tr[i - 1].t; }
  return s / Math.max(30, (now - t0) / 1000);
}
const trailLimit = now => Math.max(TRAIL_MIN, Math.min(TRAIL_MAX, trailPace(now) * TRAIL_T / 1000));
function trailTrim(now) {
  const tr = geo.trail;
  while (tr.length && now - tr[0].t > TRAIL_T) tr.shift();
  const lim = trailLimit(now);
  let s = 0;
  for (let i = tr.length - 1; i > 0; i--) { s += tr[i].d; if (s > lim) { tr.splice(0, i); break; } }
}
// where I am heading, from the last 100 m of the trail: a unit vector in image coordinates, or null when standing
function trailHeading() {
  const tr = geo.trail, h = tr[tr.length - 1];
  if (!h) return null;
  let s = 0, i = tr.length - 1;
  while (i > 0 && s < 100 && !tr[i].gap) { s += tr[i].d; i--; }
  if (s < 30) return null;
  const dx = h.X - tr[i].X, dy = h.Y - tr[i].Y, n = Math.hypot(dx, dy);
  return n ? [dx / n, dy / n] : null;
}
// centre the map on me; in a car (ahead = true) a bit ahead of me, so the road ahead is on the screen and the trail behind
function centerMe(z, ahead = false) {
  let [X, Y] = layers.llToImg(geo.pos[0], geo.pos[1]);
  const hd = ahead ? trailHeading() : null;
  if (hd) {
    const v = view(), off = 0.18 * Math.min(viewer.container.clientWidth, viewer.container.clientHeight) / v.k;
    X += hd[0] * off; Y += hd[1] * off;
  }
  flyTo(X, Y, z ?? view().z);
  geo.centeredAt = Date.now(); geo.centerPos = geo.pos.slice(0, 2);
}
function geoStart() {
  if (!('geolocation' in navigator)) { toast('Tento prohlížeč polohu nezjistí'); return; }
  geo.mode = 'on'; geo.first = true; geo.trail = []; geoUi();
  toast('Zjišťuji polohu…');
  geo.watch = navigator.geolocation.watchPosition(p => {
    geo.pos = [p.coords.longitude, p.coords.latitude, p.coords.accuracy || 30];
    trailAdd(geo.pos[0], geo.pos[1], geo.pos[2], Date.now());
    if (!geo.first) return;
    geo.first = false;
    if (!inBrno(geo.pos[0], geo.pos[1])) { track('Chyba', { co: 'poloha-mimo-brno' }); toast('Jste mimo mapu Brna'); return; }
    centerMe(Math.max(2, view().z));
    toast('Tady jste. Dalším klepnutím zapnete sledování polohy.');
  }, err => { track('Chyba', { co: err.code === 1 ? 'poloha-odmitnuta' : 'poloha-nezjistena' }); toast(err.code === 1 ? 'Přístup k poloze je v prohlížeči zakázaný' : 'Polohu se nepodařilo zjistit'); geoStop(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function geoStop() { if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch); geo.watch = null; geo.mode = 'off'; geo.pos = null; geo.trail = []; geoUi(); }
$('locate').onclick = () => {
  track('Nástroj', { nastroj: 'poloha', hodnota: geo.mode === 'off' ? 'zapnout' : geo.mode === 'on' ? 'sledovat' : 'vypnout' });
  if (geo.mode === 'off') geoStart();
  else if (geo.mode === 'on') {
    geo.mode = 'follow'; geoUi(); if (ride) stopRide(true);
    if (geo.pos && inBrno(geo.pos[0], geo.pos[1])) centerMe();
    toast('Sleduji vaši polohu: když se pohnete, mapa se posune (pěšky po 20 s, v autě po pár sekundách)');
  } else { geoStop(); toast('Poloha vypnutá'); }
};
// following: how often the map moves after me depends on my pace (20 s on foot, 10 s on a bike, 4 s in a car)
setInterval(() => {
  const now = Date.now();
  trailTrim(now);
  if (geo.mode !== 'follow' || !geo.pos || !geo.centerPos || !inBrno(geo.pos[0], geo.pos[1])) return;
  const pace = trailPace(now), car = pace > 5.5;
  const every = car ? 4000 : pace > 2.5 ? 10000 : 20000;
  if (now - geo.centeredAt < every || distM(geo.pos, geo.centerPos) <= 15) return;
  centerMe(undefined, car);
  if (pace > 8 && view().z > 2.5 && !geo.zoomHint) { geo.zoomHint = true; toast('Pro jízdu autem mapu raději oddalte'); }
}, 2000);
viewer.addHandler('canvas-drag', () => { if (geo.mode === 'follow') { geo.mode = 'on'; geoUi(); toast('Sledování polohy vypnuto, tečka zůstává'); } });
// [ADMIN] GPS at the desk: ?sim=pesky | kolo | auto swaps the GPS for a ride from Náměstí Svobody along Koliště
// to the station and back (a fix a second with a few metres of jitter; by car with a 40 s tunnel after half a minute)
// and switches following on, so the trail and the map following can be tried without leaving the chair.
const simGps = ADMIN && new URLSearchParams(location.search).get('sim');
if (simGps) {
  const WP = [[16.6083, 49.1951], [16.6080, 49.1978], [16.6115, 49.1988], [16.6148, 49.1976], [16.6168, 49.1948], [16.6160, 49.1912], [16.6128, 49.1886], [16.6090, 49.1895], [16.6075, 49.1925]];
  const mps = { pesky: 1.5, kolo: 5, auto: 14 }[simGps] || 1.5;
  let seg = 0, s = 0, cb = null, tick = 0;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: ok => { cb = ok; return 1; }, clearWatch: () => (cb = null), getCurrentPosition: ok => cb && ok } });
  setInterval(() => {
    if (!cb) return;
    let step = mps;
    while (step > 0) { const a = WP[seg], b = WP[(seg + 1) % WP.length], L = distM(a, b), rest = L - s; if (step < rest) { s += step; step = 0; } else { step -= rest; seg = (seg + 1) % WP.length; s = 0; } }
    const a = WP[seg], b = WP[(seg + 1) % WP.length], f = s / distM(a, b);
    tick++;
    if (mps > 8 && tick > 30 && tick < 70) return; // the tunnel
    const j = () => (Math.random() - 0.5) * 6;
    cb({ coords: { longitude: a[0] + (b[0] - a[0]) * f + j() / 72765, latitude: a[1] + (b[1] - a[1]) * f + j() / 111200, accuracy: 8 + Math.random() * 6, speed: mps, heading: null }, timestamp: Date.now() });
  }, 1000);
  setTimeout(() => { geoStart(); geo.mode = 'follow'; geoUi(); toast(`Simulace GPS: ${simGps} (${Math.round(mps * 3.6)} km/h)`); }, 1500);
}
// the trail behind me (fading with age and with the distance behind me), then the blue dot with the accuracy circle
function drawMe(ctx, v, t) {
  if (!geo.pos) return;
  const tr = geo.trail;
  if (tr.length > 1) {
    const now = Date.now(), lim = trailLimit(now);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let behind = 0;
    for (let i = tr.length - 1; i > 0; i--) {
      const p = tr[i], q = tr[i - 1];
      if (p.gap === 'break') continue; // the piece before the phone slept stays, fading on its own
      behind += p.d;
      const a = 1 - Math.max((now - p.t) / TRAIL_T, behind / lim);
      if (a <= 0) break;
      ctx.strokeStyle = `rgba(47,128,237,${(0.85 * a).toFixed(3)})`;
      ctx.lineWidth = 1.5 + 3.5 * a;
      ctx.setLineDash(p.gap === 'dash' ? [6, 6] : []);
      ctx.beginPath(); ctx.moveTo(v.ox + q.X * v.k, v.oy + q.Y * v.k); ctx.lineTo(v.ox + p.X * v.k, v.oy + p.Y * v.k); ctx.stroke();
    }
    ctx.restore();
  }
  const [X, Y] = layers.llToImg(geo.pos[0], geo.pos[1]);
  const x = v.ox + X * v.k, y = v.oy + Y * v.k, r = geo.pos[2] * GEO.A * v.k;
  if (r > 8 && r < 4000) { ctx.fillStyle = 'rgba(66,153,255,.15)'; ctx.strokeStyle = 'rgba(66,153,255,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, r, r / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  const pulse = 9 + 4 * Math.sin(t / 300);
  if (geo.mode === 'follow') { ctx.strokeStyle = 'rgba(66,153,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, pulse + 6, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f80ed'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
}

// ------------------------------------------------------------------ phones: sheets resized by their handle,
// the top and bottom bars folded into a corner
function sheetDrag(sheet, close) {
  const g = sheet.querySelector(':scope > .grab');
  if (!g) return;
  let y0 = 0, h0 = 0, on = false;
  g.addEventListener('pointerdown', e => { if (!isPhone()) return; on = true; y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; g.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  g.addEventListener('pointermove', e => {
    if (!on) return;
    const h = Math.max(40, Math.min(innerHeight * 0.88, h0 + (y0 - e.clientY)));
    sheet.style.maxHeight = 'none'; sheet.style.height = `${Math.round(h)}px`;
  });
  const end = () => {
    if (!on) return; on = false; sheet.style.transition = '';
    if (sheet.getBoundingClientRect().height < 90) { sheet.style.height = ''; sheet.style.maxHeight = ''; close(); } // pulled down: closed
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
}
sheetDrag($('card'), () => $('cardClose').click());
sheetDrag($('events'), () => setEventsOpen(false));
sheetDrag($('aktual'), () => setAktOpen(false));
sheetDrag($('fcPop'), () => setFcOpen(false));
document.querySelectorAll('#panel .pane').forEach(p => sheetDrag(p, () => setTab(null)));
function setBarMin(which, min) {
  document.body.classList.toggle(which, min);
  try { localStorage.setItem(`izo-${which}`, min ? '1' : ''); } catch { /* private mode */ }
}
$('topMin').onclick = () => setBarMin('top-min', true);
$('topMax').onclick = () => setBarMin('top-min', false);
$('tabsMin').onclick = () => { setTab(null); setBarMin('tabs-min', true); };
$('tabsMax').onclick = () => setBarMin('tabs-min', false);
try { if (localStorage.getItem('izo-top-min')) document.body.classList.add('top-min'); if (localStorage.getItem('izo-tabs-min')) document.body.classList.add('tabs-min'); } catch { /* private mode */ }

// until the person moves the map, keep the start view fitted to the window
for (const ev of ['canvas-drag', 'canvas-scroll', 'canvas-pinch', 'canvas-double-click']) viewer.addHandler(ev, () => (touched = true));
viewer.addHandler('resize', () => { if (!touched && viewer.world.getItemCount()) goHome(true); });
let lastSize = '', pendingHome = false, lastDraw = -1e9, lastViewKey = '', covered = false, coveredAt = -1e9;
const SHEETS = [$('card'), $('events'), $('fcPop'), ...document.querySelectorAll('#panel .pane')].filter(Boolean);
function mapCovered() {
  if (!isPhone()) return false;
  if (document.querySelector('dialog[open]')) return true;
  return SHEETS.some(s => !s.hidden && s.getBoundingClientRect().height >= innerHeight * 0.75);
}
function frame(t) {
  if (viewer.world.getItemCount()) {
    const cwid = viewer.container.clientWidth, chei = viewer.container.clientHeight;
    const size = `${cwid}x${chei}`;
    if (size !== lastSize) { if (lastSize) pendingHome = true; lastSize = size; }
    if (pendingHome) {
      const cs = viewer.viewport.getContainerSize();
      if (Math.round(cs.x) === cwid && Math.round(cs.y) === chei) { pendingHome = false; if (!touched) goHome(true); }
    }
    const v = view();
    $('map').classList.toggle('far', v.z < 0.6);
    if (ride) followRide(v);
    refreshProjectTags();
    // The overlay (clouds, traffic, people, labels…) is a full-screen canvas: every redraw costs the browser more
    // than the drawing itself, so it is redrawn at the full rate only while the view moves (on phones and with
    // "reduce motion" at most 30 fps), and while it stands still 10 fps far out (only the clouds drift there),
    // 20 fps on phones and 30 fps otherwise when zoomed in (vehicles, people, rain).
    const key = `${v.ox}|${v.oy}|${v.k}|${lastSize}`;
    const moved = key !== lastViewKey;
    const wait = moved ? (CALM ? 32 : 0) : v.z < 0.18 ? 100 : CALM ? 50 : 33;
    // on a phone a card, a pane or a dialog pulled up over the map hides it: nothing is drawn under it
    if (t - coveredAt > 400) { coveredAt = t; const c = mapCovered(); if (covered && !c) lastViewKey = ''; covered = c; }
    if (!covered && t - lastDraw >= wait) {
      lastViewKey = key; lastDraw = t;
      fx.draw(t, v);
      drawMini();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// the service worker (src/sw.js): the page and its data from the cache on a repeat visit; built site only
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {}));
// back in the tab (or the phone woke up): fit the canvas again and redraw
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // the tab is hidden (another app on the phone, another tab): the stream of vehicle positions and the traffic
    // polling stop, so they do not use data in the background; the frame loop stops on its own
    layers.live.stop();
    if (layers.traffic.timer) { clearInterval(layers.traffic.timer); layers.traffic.timer = null; }
    return;
  }
  if (state.mhdMode === 'live') layers.live.start(); // (the traffic polling restarts from the next draw of its layer)
  if (weatherTimer && Date.now() - weatherAt > 10 * 60e3) weatherRun(); // the 10-minute timer was frozen with the tab
  window.dispatchEvent(new Event('resize'));
  try { viewer.forceRedraw(); } catch { /* not open yet */ }
});

// ------------------------------------------------------------------ current date and time in Brno
// the pixel watch in the clock: a hand of `len` pixels from the centre towards one of 12 positions
// (function declarations: the first tick comes from lookUi during start-up, before this part of the file runs)
function handPath(k, len) { const a = (k / 12) * 2 * Math.PI; let d = ''; for (let t = 1; t <= len; t++) d += `M${Math.floor(5.5 + t * Math.sin(a))} ${Math.floor(5.5 - t * Math.cos(a))}h1v1h-1z`; return d; }
function calmMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
function tickClock() {
  const now = new Date();
  const date = now.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const c = $('clockText');
  const wd = now.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'short' });
  const dm = now.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' });
  const yr = now.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', year: 'numeric' });
  const d = el('small', '', `${wd} ${dm}`); d.append(el('span', 'y', ` ${yr}`));
  c.replaceChildren(d, el('b', 'hm', time.slice(0, 5)), el('span', 's', time.slice(5)));
  $('clock').title = `${date} ${time}: aktuální datum a čas v Brně, k nim se vztahují živá data (počasí, doprava, MHD)`;
  // the watch beside it: the short hand shows the real hour; the long hand steps every 2 seconds (a turn in 24 s) while
  // the map runs as in Brno now, stands still when the look is set by hand, and with reduced motion only moves every 5 minutes
  if ($('clkH')) {
    const [hh, mm, ss] = time.split(':').map(Number);
    $('clkH').setAttribute('d', handPath(Math.round((hh % 12) + mm / 60) % 12, 2));
    const live = (lookUi.state || 'live') === 'live';
    $('clkM').setAttribute('d', handPath(!live ? 0 : calmMotion() ? Math.floor(mm / 5) : Math.floor(ss / 2) % 12, 4));
  }
}
tickClock();
setInterval(tickClock, 1000);
