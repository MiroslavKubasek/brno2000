// Map layers fed from data in lon/lat: live traffic, public transport (timetable) and
// city projects. A small elevation grid places them correctly on the hilly map in every rotation.
import { fetchTraffic } from './live.js';
import { createMhd } from './mhd.js';
import { createMhdLive } from './mhdlive.js';
import { drawCar, drawTransit, pickKind, setLength, CAR_COLORS, VAN_COLORS, TRUCK_CABS, SIZE } from './vehicles.js';
const TOUCH = matchMedia('(pointer: coarse)').matches || /[?&]touch\b/.test(location.search); // phones and tablets: fingers, not a mouse (?touch: to see it on a desktop)
import { fetchData, watchFeed, RELOAD } from './feed.js';

export function createLayers({ base, GEO, rotation, state, routes }) {
  const KX = Math.cos((GEO.LAT0 * Math.PI) / 180) * 111320, KY = 110574;
  let dem = null;
  fetch(`${base}data/dem.json`).then(r => r.json()).then(d => {
    const raw = atob(d.d), a = new Int16Array(raw.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = (raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
    dem = { n: d.n, step: d.step, r: d.r, a };
    stamp++;
  });
  const elevAt = (x, y) => {
    if (!dem) return 250;
    let fx = (x + dem.r) / dem.step, fy = (dem.r - y) / dem.step;
    fx = Math.max(0, Math.min(dem.n - 1.001, fx)); fy = Math.max(0, Math.min(dem.n - 1.001, fy));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * dem.n + i, A = dem.a;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + dem.n] * (1 - u) + A[k + dem.n + 1] * u) * v;
  };
  const rotXY = (x, y) => { const r = rotation(); return r === 0 ? [x, y] : r === 1 ? [-y, x] : r === 2 ? [-x, -y] : [y, -x]; };
  const llToImg = (lon, lat) => {
    const x = (lon - GEO.LON0) * KX, y = (lat - GEO.LAT0) * KY;
    const z = elevAt(x, y);
    const [u, w] = rotXY(x, y);
    return [(u + GEO.R) * GEO.A, ((GEO.R - w) * GEO.A) / 2 - (z - GEO.Z0) * GEO.V + GEO.TOP];
  };
  let stamp = 0; // changes when the rotation or the elevation grid changes
  let lastRot = -1;
  const fresh = () => { if (lastRot !== rotation()) { lastRot = rotation(); stamp++; } return stamp; };

  // ------------------------------------------------------------ traffic (live)
  const ALERT_Z = 2 / 14; // v.z at 14 m per pixel (m/px = 2 / v.z): accident icons and closures appear only closer than this
  let occluder = null; // (X, Y) -> is this image point hidden behind a building? (set by the page)
  const traffic = { data: null, img: null, imgStamp: -1, timer: null, status: '', onStatus: null };
  async function refreshTraffic() {
    try {
      traffic.data = await fetchTraffic();
      traffic.imgStamp = -1;
      const closed = traffic.data.alerts.filter(a => a.type === 'ROAD_CLOSED').length;
      const acc = traffic.data.alerts.filter(a => a.type === 'ACCIDENT').length;
      const t = new Date(traffic.data.at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      const sk = traffic.data.skipped || {};
      const nsk = (sk.closure || 0) + (sk.local || 0) + (sk.other || 0);
      // Czech plural: 1 kolona, 2–4 kolony, 5+ kolon; zero items are left out
      const pl = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
      const parts = [traffic.data.jams.length && pl(traffic.data.jams.length, 'kolona', 'kolony', 'kolon'), closed && pl(closed, 'uzavírka', 'uzavírky', 'uzavírek'), acc && pl(acc, 'nehoda', 'nehody', 'nehod')].filter(Boolean);
      traffic.status = `Doprava ${t}: ${parts.length ? parts.join(', ') : 'bez kolon a nehod'}${nsk ? ` (${nsk} nevěrohodných hlášení skryto)` : ''}`;
      traffic.tip = nsk ? `Skrytá hlášení kolon z Waze: ${sk.closure || 0} jsou ve skutečnosti uzavírky, ${sk.local || 0} krátká zdržení v klidných ulicích, ${sk.other || 0} bez zdržení nebo mimo silnice.` : '';
    } catch { traffic.status = 'Živá doprava se teď nenačetla, zkusím to znovu.'; }
    traffic.onStatus && traffic.onStatus(traffic.status);
  }
  function trafficImg() {
    if (!traffic.data) return null;
    if (traffic.imgStamp !== fresh()) {
      traffic.img = {
        jams: traffic.data.jams.map(j => ({ ...j, pts: j.path.flatMap(([lon, lat]) => llToImg(lon, lat)) })),
        alerts: traffic.data.alerts.map(a => { const [X, Y] = llToImg(a.lon, a.lat); return { ...a, X, Y }; }),
      };
      traffic.imgStamp = stamp;
      // cells covered by a jam: free-flowing cars are not drawn there
      const grid = new Set(), C = 24;
      for (const j of traffic.img.jams) {
        for (let i = 0; i + 3 < j.pts.length; i += 2) {
          const ax = j.pts[i], ay = j.pts[i + 1], bx = j.pts[i + 2], by = j.pts[i + 3];
          const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (C / 2)) + 1;
          for (let q = 0; q <= n; q++) grid.add(`${Math.floor((ax + ((bx - ax) * q) / n) / C)}_${Math.floor((ay + ((by - ay) * q) / n) / C)}`);
        }
      }
      traffic.grid = grid;
    }
    return traffic.img;
  }
  const WC = 32; // grid cell in image px (= metres)
  let wideGrid = null, wideSrc = null;
  const wideRoads = () => {
    const R = routes ? routes() : null;
    if (!R || !R.length) return null;
    if (wideSrc !== R) {
      wideSrc = R; wideGrid = new Map();
      for (const r of R) {
        if (!r[3]) continue;
        const p = r[1], seg = { w: r[3], ow: r[2] || 0 };
        for (let i = 0; i + 3 < p.length; i += 2) {
          const sg = [p[i], p[i + 1], p[i + 2], p[i + 3], seg];
          const x0 = Math.floor((Math.min(p[i], p[i + 2]) - 20) / WC), x1 = Math.floor((Math.max(p[i], p[i + 2]) + 20) / WC);
          const y0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - 20) / WC), y1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + 20) / WC);
          for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
            const k = `${gx}_${gy}`;
            const a = wideGrid.get(k); if (a) a.push(sg); else wideGrid.set(k, [sg]);
          }
        }
      }
    }
    return wideGrid;
  };
  // 0 = one row there; 1 = two lanes this way on a two-way road; 2 = two lanes on a one-way road (the point X, Y with
  // the direction of travel dx, dy, both in image px of the current rotation)
  const wideAt = (grid, X, Y, dx, dy) => {
    const cell = grid.get(`${Math.floor(X / WC)}_${Math.floor(Y / WC)}`);
    if (!cell) return 0;
    let best = 0, bd = 16 * GEO.A; // within 16 m of the road axis (the Waze line and the OSM line are drawn apart)
    for (const [ax, ay, bx, by, seg] of cell) {
      const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1;
      const cos = (ex * dx + ey * dy) / L;
      if (Math.abs(cos) < 0.8) continue; // not the same road direction
      const t = Math.max(0, Math.min(1, ((X - ax) * ex + (Y - ay) * ey) / (L * L)));
      const d = Math.hypot(ax + ex * t - X, ay + ey * t - Y);
      if (d >= bd) continue;
      const w = cos > 0 ? seg.w & 1 : seg.w & 2;
      bd = d; best = w ? (seg.ow ? 2 : 1) : 0;
    }
    return best;
  };
  // the lanes of a whole jam: two rows only when nearly the whole stretch runs on a known two-lane road
  const jamWide = j => {
    const grid = wideRoads();
    if (!grid) return 0;
    if (j.wideG === grid) return j.wide;
    let n = 0, hits = 0, ow = 0;
    const step = 20 * GEO.A;
    for (let i = 0; i + 3 < j.pts.length; i += 2) {
      const ax = j.pts[i], ay = j.pts[i + 1], ex = j.pts[i + 2] - ax, ey = j.pts[i + 3] - ay, L = Math.hypot(ex, ey) || 1;
      const dx = ex / L, dy = ey / L, m = Math.max(1, Math.round(L / step));
      for (let q = 0; q < m; q++) {
        const f = (q + 0.5) / m, w = wideAt(grid, ax + ex * f, ay + ey * f, dx, dy);
        n++; if (w) { hits++; if (w === 2) ow++; }
      }
    }
    j.wideG = grid;
    j.wide = n && hits >= 0.8 * n ? (ow * 2 > hits ? 2 : 1) : 0;
    return j.wide;
  };
  const clos = { data: null, img: null, imgStamp: -1, grid: null };
  const loadClosures = init => fetchData(`${base}data/closures.json`, init).then(r => r.json()).then(d => { clos.data = d; clos.imgStamp = -1; stamp++; }).catch(() => {});
  loadClosures(); watchFeed('closures.json', () => loadClosures(RELOAD));
  function closuresImg() {
    if (!clos.data) return null;
    if (clos.imgStamp !== fresh()) {
      clos.img = clos.data.items.map(c => {
        const pts = [];
        for (let i = 0; i < c.p.length; i += 2) pts.push(...llToImg(c.p[i], c.p[i + 1]));
        return { ...c, pts };
      });
      const grid = new Set(), C = 24, buf = 70 * GEO.A; // no free-flowing cars on and near a closed section
      const mark = (X, Y, r) => { for (let gx = Math.floor((X - r) / C); gx <= Math.floor((X + r) / C); gx++) for (let gy = Math.floor((Y - r / 2) / C); gy <= Math.floor((Y + r / 2) / C); gy++) grid.add(`${gx}_${gy}`); };
      for (const c of clos.img) for (let i = 0; i + 1 < c.pts.length; i += 2) {
        mark(c.pts[i], c.pts[i + 1], i === 0 || i === c.pts.length - 2 ? buf : 12);
        if (i + 3 < c.pts.length) { const n = Math.ceil(Math.hypot(c.pts[i + 2] - c.pts[i], c.pts[i + 3] - c.pts[i + 1]) / 10); for (let q = 1; q < n; q++) mark(c.pts[i] + ((c.pts[i + 2] - c.pts[i]) * q) / n, c.pts[i + 1] + ((c.pts[i + 3] - c.pts[i + 1]) * q) / n, 12); }
      }
      clos.grid = grid;
      clos.imgStamp = stamp;
    }
    return clos.img;
  }
  const inJam = (X, Y) => {
    const k = `${Math.floor(X / 24)}_${Math.floor(Y / 24)}`;
    if (state.layers.jams && traffic.grid && traffic.grid.has(k)) return true;
    if (state.layers.closures && closuresImg() && clos.grid.has(k)) return true;
    // live closure reports: keep cars away from the spot
    const T = state.layers.closures && traffic.img;
    if (T) for (const a of T.alerts) if (a.type === 'ROAD_CLOSED' && Math.abs(a.X - X) < 40 * GEO.A && Math.abs(a.Y - Y) < 20 * GEO.A) return true;
    return false;
  };
  // "no entry" sign
  function noEntry(ctx, x, y, r) {
    ctx.fillStyle = '#1b2333'; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8342c'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - r * 0.65, y - r * 0.2, r * 1.3, r * 0.4);
  }
  function drawClosures(ctx, v, t, cw, ch) {
    const L = closuresImg();
    if (!L || v.z < ALERT_Z) return;
    ctx.save();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    const w = Math.max(1.5, Math.min(3.5, v.z * 2)); // (a quiet line: half of what it was)
    for (const c of L) {
      const xs = c.pts.filter((_, i) => i % 2 === 0), ys = c.pts.filter((_, i) => i % 2 === 1);
      if (Math.max(...xs) * v.k + v.ox < -20 || Math.min(...xs) * v.k + v.ox > cw + 20 || Math.max(...ys) * v.k + v.oy < -20 || Math.min(...ys) * v.k + v.oy > ch + 20) continue;
      const path = () => { ctx.beginPath(); for (let i = 0; i < c.pts.length; i += 2) { const x = v.ox + c.pts[i] * v.k, y = v.oy + c.pts[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
      // barrier tape: red and white stripes over a dark edge (a tunnel shows thinner, it is underground)
      const ww = c.tunnel ? w * 0.7 : w;
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(27,35,51,.85)'; ctx.lineWidth = ww + 2; path(); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = ww; path(); ctx.stroke();
      ctx.strokeStyle = '#d8342c'; ctx.setLineDash([ww * 1.6, ww * 1.6]); path(); ctx.stroke();
      ctx.setLineDash([]);
      if (v.z >= 1) { // no-entry signs only from about 2 m per pixel, half the size they were
        const r = Math.max(3, Math.min(5.5, v.z * 3.5));
        noEntry(ctx, v.ox + c.pts[0] * v.k, v.oy + c.pts[1] * v.k - r - 2, r);
        noEntry(ctx, v.ox + c.pts[c.pts.length - 2] * v.k, v.oy + c.pts[c.pts.length - 1] * v.k - r - 2, r);
      }
    }
    ctx.restore();
  }
  function closureAt(sx, sy, v) {
    const L = state.layers.closures && v.z >= ALERT_Z && closuresImg();
    if (!L) return null;
    for (const c of L) for (let i = 0; i + 3 < c.pts.length; i += 2) {
      const ax = v.ox + c.pts[i] * v.k, ay = v.oy + c.pts[i + 1] * v.k, bx = v.ox + c.pts[i + 2] * v.k, by = v.oy + c.pts[i + 3] * v.k;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
      if (Math.hypot(ax + dx * tt - sx, ay + dy * tt - sy) < 9) return { closure: c, source: clos.data.source };
    }
    return null;
  }

  const works = { data: null, img: null, pts: null, imgStamp: -1, loading: false };
  const loadWorks = init => { works.loading = true; return fetchData(`${base}data/roadworks.json`, init).then(r => r.json()).then(d => { works.data = d; works.imgStamp = -1; stamp++; }).catch(() => {}).finally(() => { works.loading = false; }); };
  watchFeed('roadworks.json', () => (works.data ? loadWorks(RELOAD) : null));
  function worksImg() {
    if (!works.data) { if (!works.loading) loadWorks(); return null; }
    if (works.imgStamp !== fresh()) {
      works.img = works.data.items.map(w => {
        const parts = w.p.map(l => { const pts = []; for (let i = 0; i < l.length; i += 2) pts.push(...llToImg(l[i], l[i + 1])); return pts; });
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of parts) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
        return { ...w, parts, XY: llToImg(w.lon, w.lat), bb: [x0, y0, x1, y1] };
      });
      works.pts = works.data.points.map(q => ({ ...q, XY: llToImg(q.lon, q.lat) }));
      works.imgStamp = stamp;
    }
    return works.img;
  }
  // a traffic cone (pixel style), (x, y) its foot
  function cone(ctx, x, y, s, faint) {
    ctx.globalAlpha = faint ? 0.55 : 1;
    ctx.fillStyle = '#1b2333'; ctx.fillRect(x - s - 1, y - 1, 2 * s + 2, 3);
    ctx.fillStyle = '#f08a3c'; ctx.beginPath(); ctx.moveTo(x, y - 2.2 * s); ctx.lineTo(x + s * 0.9, y); ctx.lineTo(x - s * 0.9, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1b2333'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - s * 0.45, y - 1.2 * s, s * 0.9, Math.max(1, s * 0.35));
    ctx.globalAlpha = 1;
  }
  // "od 15. 11." next to a closure that is only coming (a dark chip with the start date), only at the closest zoom, from about 25 cm per pixel
  const CHIP_Z = 8;
  const fromLabel = d => `od ${d.slice(8, 10).replace(/^0/, '')}. ${d.slice(5, 7).replace(/^0/, '')}.`;
  function dateChip(ctx, x, y, text) {
    ctx.font = '400 13px "VT323", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(27,35,51,.9)'; ctx.fillRect(x, y - 8, w, 16);
    ctx.fillStyle = '#f2c66d'; ctx.fillText(text, x + 4, y + 1);
  }
  function drawWorks(ctx, v, t, cw, ch) {
    if (!state.layers.works || v.z < ALERT_Z) return;
    const L = worksImg();
    if (!L) return;
    ctx.save();
    const chips = []; // the start dates of coming closures, drawn last so the tape does not cross them
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    const w = Math.max(1.5, Math.min(3.5, v.z * 2));
    const vis = (x0, y0, x1, y1) => !(x1 * v.k + v.ox < -20 || x0 * v.k + v.ox > cw + 20 || y1 * v.k + v.oy < -20 || y0 * v.k + v.oy > ch + 20);
    for (const c of L) {
      if (c.osm || !vis(...c.bb)) continue; // (the same closure comes from OpenStreetMap, drawn with the closures)
      const full = c.kind === 'uplna';
      const path = () => { ctx.beginPath(); for (const p of c.parts) for (let i = 0; i < p.length; i += 2) { const x = v.ox + p[i] * v.k, y = v.oy + p[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
      const ww = full ? w : w * 0.7;
      ctx.globalAlpha = c.soon ? 0.55 : 1;
      // barrier tape: red and white for a closed street, orange and white for an occupied sidewalk or lane
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(27,35,51,.85)'; ctx.lineWidth = ww + 2; path(); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = ww; path(); ctx.stroke();
      ctx.strokeStyle = full ? '#d8342c' : '#f08a3c'; ctx.setLineDash([ww * 1.6, ww * 1.6]); path(); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const x = v.ox + c.XY[0] * v.k, y = v.oy + c.XY[1] * v.k;
      if (v.z >= 1) { // signs and cones only from about 2 m per pixel
        if (full) noEntry(ctx, x, y - 6, Math.max(3, Math.min(5.5, v.z * 3.5)));
        else cone(ctx, x, y, Math.max(2.5, Math.min(5, v.z * 3)), c.soon);
      }
      if (c.soon && v.z >= CHIP_Z) chips.push([x + 6, y - 14, fromLabel(c.from)]); // the date only close up: from afar the faint tape is enough
    }
    // reports of the national centre without a line of the City: a cone (works) or a red bar (closed)
    const s = Math.max(3, Math.min(6, v.z * 4));
    for (const q of works.pts) {
      const x = v.ox + q.XY[0] * v.k, y = v.oy + q.XY[1] * v.k;
      if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
      if (/uzavřen/i.test(q.kind) && !q.planned) {
        ctx.fillStyle = '#1b2333'; ctx.fillRect(x - s - 1, y - s * 0.6 - 1, 2 * s + 2, 1.2 * s + 2);
        ctx.fillStyle = '#d8342c'; ctx.fillRect(x - s, y - s * 0.6, 2 * s, 1.2 * s);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - s * 0.7, y - s * 0.18, 1.4 * s, s * 0.36);
      } else cone(ctx, x, y + s, s, q.planned);
      if (q.planned && q.from && v.z >= CHIP_Z) chips.push([x + s + 3, y - s - 4, fromLabel(q.from)]);
    }
    // one chip per place and date: several consents on the same corner (stages of one work) would pile up
    const drawn = [];
    for (const [x, y, text] of chips) {
      if (drawn.some(d => d[2] === text && Math.hypot(d[0] - x, d[1] - y) < 40)) continue;
      drawn.push([x, y, text]); dateChip(ctx, x, y, text);
    }
    ctx.restore();
  }
  function workAt(sx, sy, v) {
    if (!state.layers.works || v.z < ALERT_Z) return null;
    const L = worksImg();
    if (!L) return null;
    for (const q of works.pts) if (Math.hypot(v.ox + q.XY[0] * v.k - sx, v.oy + q.XY[1] * v.k - sy) < 11) return { workPoint: q };
    for (const c of L) {
      if (c.osm) continue;
      for (const p of c.parts) for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = v.ox + p[i] * v.k, ay = v.oy + p[i + 1] * v.k, bx = v.ox + p[i + 2] * v.k, by = v.oy + p[i + 3] * v.k;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
        if (Math.hypot(ax + dx * tt - sx, ay + dy * tt - sy) < 8) return { work: c };
      }
      if (Math.hypot(v.ox + c.XY[0] * v.k - sx, v.oy + c.XY[1] * v.k - sy) < 10) return { work: c };
    }
    return null;
  }

  // ------------------------------------------------------------ projects (City of Brno open data)
  const proj = { list: null, img: null, imgStamp: -1, updated: '', cobude: [] };
  const loadProjects = init => fetchData(`${base}data/projects.json`, init).then(r => r.json()).then(d => { proj.vmo = d.projects.find(p => p.id === 'cb-velky-mestsky-okruh'); proj.list = d.projects.filter(p => p.id !== 'cb-velky-mestsky-okruh'); /* the ring road is drawn as a line (src/vmo.js) */ proj.updated = d.updated; proj.cobude = d.cobude || []; proj.imgStamp = -1; stamp++; applyProjDetail(); }).catch(() => {});
  loadProjects(); watchFeed('projects.json', () => loadProjects(RELOAD));
  let projDetail = null, projDetailData = null;
  function applyProjDetail() { if (!projDetailData || !proj.list) return; for (const p of proj.list.concat(proj.vmo ? [proj.vmo] : [])) if (projDetailData[p.id]) Object.assign(p, projDetailData[p.id]); }
  // descriptions, investors, pictures and links of the projects: await it before a project card
  const projectDetail = () => (projDetail ||= fetchData(`${base}data/projects-detail.json`).then(r => r.json()).then(d => { projDetailData = d; applyProjDetail(); }).catch(() => { projDetail = null; }));
  // construction sites from OpenStreetMap (landuse=construction)
  const sites = { list: null, img: null, imgStamp: -1 };
  // building sites whose hatched ground the visitor hid from the card (a big site covers the houses around it,
  // which then cannot be clicked): only the crane stays, and it still opens the card. Kept in this browser.
  const HIDE_LS = 'izo-hide-area';
  let hiddenAreas = new Set();
  try { hiddenAreas = new Set(JSON.parse(localStorage.getItem(HIDE_LS) || '[]')); } catch { hiddenAreas = new Set(); }
  const areaKey = p => (p.osm ? `site-${p.osmId}` : String(p.id));
  const areaHidden = p => hiddenAreas.has(areaKey(p));
  function setAreaHidden(p, hidden) {
    if (hidden) hiddenAreas.add(areaKey(p)); else hiddenAreas.delete(areaKey(p));
    try { localStorage.setItem(HIDE_LS, JSON.stringify([...hiddenAreas])); } catch { /* private mode */ }
  }
  const loadSites = init => fetchData(`${base}data/sites.json`, init).then(r => r.json()).then(d => { sites.list = d; sites.imgStamp = -1; stamp++; }).catch(() => {});
  loadSites(); watchFeed('sites.json', () => loadSites(RELOAD));
  const demol = { list: null, img: null, imgStamp: -1 };
  fetch(`${base}data/demolished.json`).then(r => r.json()).then(d => { demol.list = d; stamp++; }).catch(() => {});

  // ---- location corrections: published ones (data/corrections.json) + this browser's own (localStorage)
  const LS = 'izo-corrections';
  const corr = { pub: {}, own: {} };
  try { corr.own = JSON.parse(localStorage.getItem(LS) || '{}'); } catch { corr.own = {}; }
  fetch(`${base}data/corrections.json`).then(r => (r.ok ? r.json() : {})).then(d => { corr.pub = d.items || d || {}; stamp++; }).catch(() => {});
  const correction = key => corr.own[key] || corr.pub[key] || null;
  function saveOwn() { try { localStorage.setItem(LS, JSON.stringify(corr.own)); } catch { /* private mode */ } stamp++; }
  const setPosition = (key, lon, lat, name) => { corr.own[key] = { lon: +lon.toFixed(6), lat: +lat.toFixed(6), name, at: new Date().toISOString() }; saveOwn(); };
  const confirmPosition = (key, name) => { const c = correction(key); corr.own[key] = { ...(c || {}), confirmed: true, name, at: new Date().toISOString() }; saveOwn(); };
  const resetPosition = key => { delete corr.own[key]; saveOwn(); };
  const ownCorrections = () => corr.own;
  // where a project's position comes from
  function positionInfo(p) {
    const c = correction(`proj:${p.id}`);
    if (c && c.lon) return c.confirmed ? 'potvrzená (upravená ručně)' : 'upravená ručně, zatím nepotvrzená';
    if (c && c.confirmed) return p.approx ? 'odhadnutá, potvrzená' : 'z dat města, potvrzená';
    return p.approx ? 'přibližná — odhad, nepotvrzená' : 'z dat města (Brno Brzo)';
  }

  // centre of a polygon (area-weighted), so labels sit in the middle of long areas
  function centroid(r) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const f = r[j] * r[i + 1] - r[i] * r[j + 1];
      a += f; cx += (r[j] + r[i]) * f; cy += (r[j + 1] + r[i + 1]) * f;
    }
    if (Math.abs(a) < 1e-6) { let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; } return [x / (r.length / 2), y / (r.length / 2)]; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return Math.abs(a / 2); };
  function geomImg(p) {
    const c = correction(`proj:${p.id}`);
    const g = p.pt && c && c.lon ? [[c.lon, c.lat]] : p.g;
    const rings = g.map(r => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...llToImg(r[i], r[i + 1])); return o; });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    let X, Y;
    if (!p.pt && c && c.lon) [X, Y] = llToImg(c.lon, c.lat); // a moved label of an area
    else if (p.pt || rings[0].length < 6) [X, Y] = rings[0];
    else { const big = rings.reduce((m, r) => (ringArea(r) > ringArea(m) ? r : m), rings[0]); [X, Y] = centroid(big); }
    return { p, rings, bb: [x0, y0, x1, y1], X, Y };
  }
  // where the map marks a project: the foot of its crane (a site under construction) or the middle of its area
  const projectPos = p => { const q = geomImg(p); return [q.X, q.Y]; };
  function projImg() {
    if (!proj.list) return null;
    if (proj.imgStamp !== fresh()) { proj.img = proj.list.map(geomImg); proj.imgStamp = stamp; }
    return proj.img;
  }
  // A construction site from OpenStreetMap that lies on a city project (Brno Brzo, with its pictures and
  // description) or that the project confirms only repeats it: it is left out, unless it has its own web page.
  // Its builder, dates and note go into the project's card when the project lacks them.
  const inLL = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  // the city project this site lies on (or that confirms it by name), or null
  function onProject(s) {
    const all = (proj.list || []).concat(proj.vmo ? [proj.vmo] : []);
    const m = /Brno Brzo:\s*(.+)$/.exec(s.confirmedBy || '');
    if (m) { const byName = all.find(q => q.n === m[1].trim()); if (byName) return byName; }
    const r = s.r[0]; let cx = 0, cy = 0;
    for (let i = 0; i < r.length; i += 2) { cx += r[i]; cy += r[i + 1]; }
    cx /= r.length / 2; cy /= r.length / 2;
    const pts = [[cx, cy]]; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
    return all.find(q => (q.g || []).some(g => inLL(g, cx, cy) || pts.filter(([a, b]) => inLL(g, a, b)).length / pts.length >= 0.3)) || (m ? true : null);
  }
  function sitesImg() {
    if (!sites.list) return null;
    if (sites.imgStamp !== fresh()) {
      const shown = proj.list ? sites.list.filter(s => {
        const q = onProject(s);
        if (!q) return true;
        // its own web page only counts when it is not the project's page
        const host = u => (u || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
        if (s.web && (q === true || ![q.web, q.src].some(u => u && host(u) === host(s.web)))) return true;
        if (q !== true) { // keep what the site knows: the builder and the dates
          if (s.op && !q.dev) q.dev = s.op;
          if (s.open && !q.done) q.done = s.open;
          if (s.start && !q.begin) q.begin = s.start;
          if (s.desc && !q.txt && !(q.cb && q.cb.d)) q.txt = s.desc;
        }
        return false;
      }) : sites.list;
      sites.img = shown.map(s => geomImg({ ...s, osmId: s.id, id: `site-${sites.list.indexOf(s)}`, g: s.r, osm: true }));
      sites.imgStamp = stamp;
    }
    return sites.img;
  }
  function demolImg() {
    if (!demol.list) return null;
    if (demol.imgStamp !== fresh()) { demol.img = demol.list.map(d => geomImg({ ...d, g: d.r, demol: true })); demol.imgStamp = stamp; }
    return demol.img;
  }
  // a symbolic tower crane (pixel style); (x, y) foot of the mast on screen, s = size factor
  // OSM construction=* values that mean a fenced-off open-air space (playground, park, path), not a building site
  const SOFT_SITE = new Set(['playground', 'pitch', 'park', 'garden', 'recreation_ground', 'dog_park', 'footway', 'sidewalk', 'cycleway', 'path', 'pedestrian', 'square']);
  let craneHits = []; // [[mast x0,y0,x1,y1, jib x0,y0,x1,y1, project], ...]
  function crane(ctx, x, y, s, t, p) {
    const H = 34 * s, J = 26 * s;
    const sway = Math.sin(t / 1800) * 0.25;
    const jx = Math.cos(sway), jy = Math.sin(sway) * 0.5;
    if (p) craneHits.push([x, y, x, y - H, x - J * 0.35 * jx, y - H - J * 0.35 * jy, x + J * jx, y - H + J * jy, p]);
    ctx.save();
    ctx.lineCap = 'square';
    const line = (x0, y0, x1, y1, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const top = y - H;
    for (const [w, c] of [[Math.max(3, 3 * s) + 2, '#1b2333'], [Math.max(3, 3 * s), '#f2c66d']]) {
      line(x, y, x, top, w, c); // mast
      line(x - J * 0.35 * jx, top - J * 0.35 * jy, x + J * jx, top + J * jy, w * 0.8, c); // jib and counter-jib
    }
    ctx.fillStyle = '#5b5f66'; ctx.fillRect(x - J * 0.35 * jx - 3 * s, top - J * 0.35 * jy - 1, 6 * s, 4 * s); // counterweight
    const hx = x + J * 0.75 * jx, hy = top + J * 0.75 * jy;
    line(hx, hy, hx, hy + H * 0.45, 1, '#1b2333'); // hook rope
    ctx.fillStyle = '#c9583b'; ctx.fillRect(hx - 2 * s, hy + H * 0.45, 4 * s, 3 * s); // load
    // lattice marks on the mast
    ctx.fillStyle = '#1b2333';
    for (let q = y - 6 * s; q > top; q -= 6 * s) ctx.fillRect(x - 1, q, 2, 1);
    ctx.restore();
  }
  let hatchPattern = null;
  function hatch(ctx) {
    if (hatchPattern) return hatchPattern;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(110,80,50,.32)'; g.fillRect(0, 0, 8, 8);
    // cross-hatch (two sets of lines at right angles) so building sites differ from the single stripes of planned areas
    g.strokeStyle = 'rgba(242,198,109,.7)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6);
    g.moveTo(-2, -2); g.lineTo(10, 10); g.moveTo(6, -2); g.lineTo(10, 2); g.moveTo(-2, 6); g.lineTo(2, 10);
    g.stroke();
    hatchPattern = ctx.createPattern(c, 'repeat');
    return hatchPattern;
  }
  const inRing = (r, x, y) => {
    let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // which projects are shown: building sites now / planned by the city and public bodies / planned private ones
  const CITY_INV = /veřejná|strategický|Dáme na vás|smíšená/i;
  const isCity = p => CITY_INV.test(p.inv || '') || !!p.cb;
  const projOn = p => { const st = p.st || 'plánovaný'; return st === 've výstavbě' ? !!state.layers.building : st === 'plánovaný' ? !!(isCity(p) ? state.layers.planCity : state.layers.planPrivate) : false; };
  const anyProj = () => state.layers.building || state.layers.planCity || state.layers.planPrivate;
  // fine diagonal stripes for planned areas (one pattern per colour)
  const stripeCache = new Map();
  // cleared site: grey-brown ground with light and dark bits (concrete, rubble)
  let rubblePattern = null;
  function rubble(ctx) {
    if (rubblePattern) return rubblePattern;
    const c = document.createElement('canvas'); c.width = c.height = 12;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(120,104,88,.28)'; g.fillRect(0, 0, 12, 12);
    g.fillStyle = 'rgba(235,228,215,.7)'; for (const [x, y] of [[1, 2], [7, 5], [4, 9], [10, 10]]) g.fillRect(x, y, 1, 1);
    g.fillStyle = 'rgba(60,50,42,.7)'; for (const [x, y] of [[4, 4], [9, 1], [1, 8], [8, 8]]) g.fillRect(x, y, 1, 1);
    rubblePattern = ctx.createPattern(c, 'repeat');
    return rubblePattern;
  }
  function planStripes(ctx, col) {
    if (!stripeCache.has(col)) {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g = c.getContext('2d'); g.strokeStyle = `rgba(${col},.5)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
      stripeCache.set(col, ctx.createPattern(c, 'repeat'));
    }
    return stripeCache.get(col);
  }
  // a crane under the screen point (within a few pixels of its mast or jib): its building site
  function craneAt(sx, sy) {
    const seg = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, f = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2)); return Math.hypot(ax + dx * f - sx, ay + dy * f - sy); };
    for (let i = craneHits.length - 1; i >= 0; i--) { const h = craneHits[i]; if (seg(h[0], h[1], h[2], h[3]) < 7 || seg(h[4], h[5], h[6], h[7]) < 7) return h[8]; }
    return null;
  }
  function projectsAt(X, Y) {
    const list = projImg();
    if (!list || !anyProj()) return [];
    const hit = q => {
      if (q.p.pt) return Math.hypot(q.rings[0][0] - X, q.rings[0][1] - Y) < 40;
      if (areaHidden(q.p) && !SOFT_SITE.has(q.p.kind)) return false;
      return X >= q.bb[0] && X <= q.bb[2] && Y >= q.bb[1] && Y <= q.bb[3] && q.rings.some(r => inRing(r, X, Y));
    };
    // city projects first, then construction sites from OpenStreetMap (they are clickable too)
    return [...list.filter(q => projOn(q.p) && hit(q)), ...(state.layers.building ? (sitesImg() || []).filter(hit) : []), ...(state.layers.building ? (demolImg() || []).filter(hit) : [])].map(q => q.p);
  }
  // project tags: major city projects ("Co bude, Brno?") get a tag; when a Wikipedia tag sits on the
  // same place, the project joins that tag instead (one tag, one card)
  function projectTags(wikiPois) {
    const list = projImg();
    if (!list) return { tags: [], byWiki: new Map() };
    const byWiki = new Map(), tags = [];
    for (const q of list) {
      if (!q.p.cb) continue;
      let hit = null, bd = 90;
      for (const w of wikiPois || []) {
        const inside = !q.p.pt && w[2] >= q.bb[0] && w[2] <= q.bb[2] && w[3] >= q.bb[1] - 10 && w[3] <= q.bb[3] + 10 && q.rings.some(r => inRing(r, w[2], w[3] + 8));
        const d = Math.hypot(w[2] - q.X, w[3] - q.Y);
        if (inside) { hit = w; break; }
        if (d < bd) { bd = d; hit = w; }
      }
      if (hit) { if (!byWiki.has(hit[1])) byWiki.set(hit[1], []); byWiki.get(hit[1]).push(q.p); }
      else tags.push({ n: q.p.cb.t || q.p.n, X: q.X, Y: q.Y, proj: q.p });
    }
    return { tags, byWiki };
  }

  // ------------------------------------------------------------ public transport
  const mhd = createMhd({ base, rotation });
  const live = createMhdLive();
  // live vehicles in image coordinates (only inside the map)
  function liveVehicles() {
    const out = [];
    for (const lv of live.list()) {
      const [X, Y] = llToImg(lv.lngNow, lv.latNow);
      if (X < 0 || Y < 0 || X > GEO.W || Y > GEO.H) continue;
      const o = { ...lv, X, Y, live: true };
      if (lv.moveLat !== undefined) { const [X0, Y0] = llToImg(lv.lngNow - lv.moveLng, lv.latNow - lv.moveLat); o.mx = X - X0; o.my = Y - Y0; }
      out.push(o);
    }
    return out;
  }
  // A live vehicle is put onto its line's route (from the timetable) so its body follows the rails / road
  // front first. Without a matching route the body points the way the vehicle actually moved.
  const snapCache = new Map(); // live id -> { pv, at }
  function snapLive(m) {
    let c = snapCache.get(m.id);
    if (!c || performance.now() - c.at > 10000) { c = { pv: matchPlan(m), at: performance.now() }; snapCache.set(m.id, c); }
    if (snapCache.size > 2000) snapCache.clear();
    const pv = c.pv;
    if (!pv || !pv.shape) return null;
    const [xy, cm] = pv.shape;
    let best = Infinity, bm = 0, bdx = 0, bdy = 0;
    for (let i = 1; i < cm.length; i++) {
      const ax = xy[2 * i - 2], ay = xy[2 * i - 1], dx = xy[2 * i] - ax, dy = xy[2 * i + 1] - ay;
      const L2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((m.X - ax) * dx + (m.Y - ay) * dy) / L2));
      const d = Math.hypot(ax + dx * f - m.X, ay + dy * f - m.Y);
      if (d < best) { best = d; bm = cm[i - 1] + (cm[i] - cm[i - 1]) * f; bdx = dx; bdy = dy; }
    }
    if (best > 30 * GEO.A) return null; // off its route (detour): use the direction of travel
    // direction along the route: the way the timetable trip runs, checked against the real movement
    let back = pv.back;
    if (m.mx !== undefined && Math.hypot(m.mx, m.my) > 3) back = (m.mx * bdx + m.my * bdy) < 0;
    return { shape: pv.shape, m: bm, back };
  }
  function liveBodySnapped(m, lengthM, n) {
    const s = snapLive(m);
    return s ? mhd.body(s, lengthM, n) : liveBody(m, lengthM, n);
  }
  // body points of a live vehicle: from its position backwards along its heading (metres)
  function liveBody(m, lengthM, n) {
    const b = ((m.heading ?? m.bearing) * Math.PI) / 180, out = [];
    for (let i = 0; i < n; i++) {
      const d = (lengthM * i) / (n - 1);
      const lat = m.latNow - (Math.cos(b) * d) / 110574, lng = m.lngNow - (Math.sin(b) * d) / (Math.cos((m.latNow * Math.PI) / 180) * 111320);
      out.push(...llToImg(lng, lat));
    }
    return out;
  }
  // The timetable trip a live vehicle runs. The candidates are the line's trips at the vehicle's timetable time
  // (now minus its delay), including one about to start or just finished (a vehicle at the terminus). The stops
  // the live stream reports decide more than the distance: the trip ends at the vehicle's final stop and passes
  // its last stop; a trip that only shares the destination name, or none of it, is a weaker match.
  function matchPlan(lv) {
    if (!mhd.ready()) { if (mhd.wantSnap) mhd.load(); return null; } // (the timetable comes in the background, until then the body points the way the vehicle moves)
    const finalName = mhd.stopName(lv.final);
    const planSec = mhd.now().sec - (lv.delay || 0) * 60;
    let best = null, bs = Infinity;
    for (const pv of mhd.candidates(lv.line, planSec)) {
      const nums = pv.p[5] || [];
      const endsThere = nums.length > 0 && nums[nums.length - 1] === lv.final;
      const passes = lv.last && nums.includes(lv.last);
      const d = Number.isFinite(pv.X) ? Math.hypot(pv.X - lv.X, pv.Y - lv.Y) : 2500 * GEO.A; // (no position: the stops decide)
      const s = d + (endsThere ? 0 : finalName && pv.hs === finalName ? 300 : 3000) + (passes ? 0 : 1500);
      if (s < bs) { bs = s; best = pv; }
    }
    return bs < 6000 * GEO.A ? best : null;
  }
  // the selected vehicle's whole route with its stops
  let selRoute = null;
  function setRoute(pv) {
    if (!pv) { selRoute = null; return; }
    const [, , ms, offs, stopNames] = pv.p;
    selRoute = { shape: pv.shape, ms, offs, names: stopNames, t0: pv.t0, type: pv.type };
  }
  function drawRoute(ctx, v, cw, ch) {
    const R = selRoute;
    const valid = R.ms.map((m, i) => [m, i]).filter(([m]) => m >= 0);
    if (valid.length < 2) return;
    const lo = Math.min(...valid.map(x => x[0])), hi = Math.max(...valid.map(x => x[0]));
    const [xy, cm] = R.shape;
    const path = [...mhd.pointAt(R.shape, lo).slice(0, 2)];
    for (let i = 0; i < cm.length; i++) if (cm[i] > lo && cm[i] < hi) path.push(xy[2 * i], xy[2 * i + 1]);
    path.push(...mhd.pointAt(R.shape, hi).slice(0, 2));
    const col = R.type === 'tram' ? '#c8202a' : R.type === 'trol' ? '#2f8f3a' : '#2f6fb7';
    const line = () => { ctx.beginPath(); for (let i = 0; i < path.length; i += 2) { const x = v.ox + path[i] * v.k, y = v.oy + path[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(27,35,51,.85)'; ctx.lineWidth = 9; line(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 5; line(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); line(); ctx.stroke(); ctx.setLineDash([]);
    // stops: passed ones grey, upcoming white; names of the stops when zoomed in
    const now = (() => { const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).split(' ')[1].split(':').map(Number); return s[0] * 3600 + s[1] * 60 + s[2]; })();
    ctx.font = '400 15px "VT323", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const [m, i] of valid) {
      const [X, Y] = mhd.pointAt(R.shape, m);
      const x = v.ox + X * v.k, y = v.oy + Y * v.k;
      if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
      const passed = R.t0 + R.offs[i] < now;
      const end = i === valid[0][1] || i === valid[valid.length - 1][1];
      const r = end ? 7 : 5;
      ctx.fillStyle = '#1b2333'; ctx.fillRect(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
      ctx.fillStyle = passed ? '#9aa3ad' : end ? '#f2c66d' : '#ffffff'; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      if (v.z >= 0.5 || end) {
        const name = mhd.names ? mhd.names(R.names[i]) : '';
        if (name) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(27,35,51,.9)'; ctx.strokeText(name, x + r + 4, y); ctx.fillStyle = passed ? '#c9ced6' : '#ffffff'; ctx.fillText(name, x + r + 4, y); }
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ boundaries of the city and its districts
  const bnd = { list: null, img: null, imgStamp: -1 };
  fetch(`${base}data/boundaries.json`).then(r => r.json()).then(d => { bnd.list = d; stamp++; }).catch(() => {});
  function drawBoundaries(ctx, v) {
    if (!bnd.list || v.z < 0.1) return;
    if (bnd.imgStamp !== fresh()) {
      bnd.img = bnd.list.map(b => ({ lvl: b.lvl, rings: b.r.map(r => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...llToImg(r[i], r[i + 1])); return o; }) }));
      bnd.imgStamp = stamp;
    }
    ctx.save();
    ctx.lineJoin = 'round';
    for (const b of bnd.img) {
      const city = b.lvl === 8;
      if (!city && v.z < 0.3) continue; // districts only when zoomed in
      ctx.setLineDash(city ? [10, 5] : [4, 5]);
      ctx.lineWidth = city ? 1.6 : 1;
      ctx.strokeStyle = city ? 'rgba(242,198,109,.55)' : 'rgba(238,241,230,.32)';
      for (const r of b.rings) {
        ctx.beginPath();
        for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ drawing
  function draw(ctx, v, t, hover) {
    const cw = ctx.canvas.clientWidth, ch = ctx.canvas.clientHeight;
    drawBoundaries(ctx, v);
    const vis = (x0, y0, x1, y1) => !(v.ox + x1 * v.k < -20 || v.ox + x0 * v.k > cw + 20 || v.oy + y1 * v.k < -20 || v.oy + y0 * v.k > ch + 20);
    // projects: outlines (planned and ongoing construction)
    if (anyProj() && v.z >= 0.25) {
      const list = projImg();
      if (list) {
        ctx.save();
        ctx.setLineDash([9, 5]);
        ctx.lineDashOffset = -(t / 120) % 10;
        const cranes = [];
        for (const q of list) {
          if (!vis(...q.bb) || !projOn(q.p)) continue;
          const on = hover && hover.includes(q.p);
          const major = !!q.p.cb;
          const priv = !isCity(q.p) && q.p.st !== 've výstavbě'; // planned private projects: blue outline
          if (q.p.pt) {
            const [X, Y] = q.rings[0];
            const r = (10 + 4 * Math.sin(t / 300)) * Math.max(1, v.z);
            ctx.strokeStyle = 'rgba(242,198,109,.95)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(v.ox + X * v.k, v.oy + Y * v.k, r, 0, Math.PI * 2); ctx.stroke();
            continue;
          }
          const building = q.p.st === 've výstavbě';
          // ground hidden from the card: no hatch and no outline, the crane alone marks the site (drawn at any zoom, so the card stays reachable)
          if (building && areaHidden(q.p)) { cranes.push([q.X, q.Y, q.p, true]); continue; }
          if (building) {
            // building site: brown hatched ground and a tower crane
            ctx.save(); ctx.setLineDash([]);
            ctx.fillStyle = hatch(ctx);
            ctx.beginPath();
            for (const r of q.rings) { for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); }
            ctx.fill();
            ctx.restore();
            cranes.push([q.X, q.Y, q.p]);
          }
          const shape = () => { ctx.beginPath(); for (const r of q.rings) { for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); } };
          if (!building) {
            // planned: a well visible area (fill + stripes) and a thick dashed outline with a dark edge
            const col = priv ? '143,196,240' : '242,198,109';
            shape(); ctx.fillStyle = `rgba(${col},${on ? 0.32 : 0.2})`; ctx.fill();
            ctx.fillStyle = planStripes(ctx, col); ctx.fill();
            const lw = on ? 3.2 : major ? 2.6 : 2;
            ctx.save(); ctx.setLineDash([]); shape(); ctx.strokeStyle = 'rgba(27,35,51,.7)'; ctx.lineWidth = lw + 1.5; ctx.stroke(); ctx.restore();
            shape(); ctx.strokeStyle = on ? 'rgba(255,240,190,1)' : `rgba(${col},1)`; ctx.lineWidth = lw; ctx.stroke();
          } else {
            // under construction: the hatched ground above, a light wash when hovered, and a dashed yellow outline with a dark edge
            if (on) { shape(); ctx.fillStyle = 'rgba(242,198,109,.22)'; ctx.fill(); }
            const lw = on ? 3 : major ? 2.4 : 1.8;
            ctx.save(); ctx.setLineDash([]); shape(); ctx.strokeStyle = 'rgba(27,35,51,.75)'; ctx.lineWidth = lw + 1.5; ctx.stroke(); ctx.restore();
            shape(); ctx.strokeStyle = on ? 'rgba(255,240,190,1)' : 'rgba(242,198,109,1)'; ctx.lineWidth = lw; ctx.stroke();
          }
        }
        ctx.restore();
        // OpenStreetMap construction sites
        const S = state.layers.building ? sitesImg() : null;
        if (S) {
          ctx.save();
          ctx.lineJoin = 'round';
          for (const q of S) {
            if (!vis(...q.bb)) continue;
            // an open-air space being redone (a playground, a park, a path): no tower crane, the hatched ground alone marks it
            const soft = SOFT_SITE.has(q.p.kind);
            if (!soft && areaHidden(q.p)) { cranes.push([q.X, q.Y, q.p, true]); continue; }
            const on = hover && hover.includes(q.p);
            const shape = () => { ctx.beginPath(); for (const r of q.rings) { for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); } };
            shape(); ctx.fillStyle = hatch(ctx); ctx.fill();
            if (on) { ctx.fillStyle = 'rgba(242,198,109,.22)'; ctx.fill(); }
            // dark edge and a dashed yellow outline, so the hatched ground does not get lost among the roofs
            const lw = on ? 3 : 1.8;
            ctx.setLineDash([]); shape(); ctx.strokeStyle = 'rgba(27,35,51,.75)'; ctx.lineWidth = lw + 1.5; ctx.stroke();
            ctx.setLineDash([9, 5]); ctx.lineDashOffset = -(t / 120) % 10;
            shape(); ctx.strokeStyle = on ? 'rgba(255,240,190,1)' : 'rgba(242,198,109,1)'; ctx.lineWidth = lw; ctx.stroke();
            if (!soft && ringArea(q.rings[0]) > 1500 * GEO.A * GEO.A) cranes.push([q.X, q.Y, q.p]);
          }
          ctx.restore();
        }
        // cleared sites (demolished buildings): rubble over the ground, a thin dark outline, a light wash when hovered
        const D = state.layers.building && v.z >= 0.25 ? demolImg() : null;
        if (D) {
          ctx.save(); ctx.lineJoin = 'round';
          for (const q of D) {
            if (!vis(...q.bb) || q.p.site) continue; // on a construction site the site's hatch is drawn instead (still clickable)
            const on = hover && hover.includes(q.p);
            ctx.beginPath(); for (const r of q.rings) { for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); }
            if (q.p.g !== 'grass' && q.p.g !== 'paved') { ctx.fillStyle = rubble(ctx); ctx.fill('evenodd'); }
            if (on) { ctx.fillStyle = 'rgba(255,240,190,.25)'; ctx.fill('evenodd'); }
            ctx.setLineDash([]); ctx.strokeStyle = on ? 'rgba(255,240,190,1)' : 'rgba(70,58,48,.6)'; ctx.lineWidth = on ? 2.2 : 1; ctx.stroke();
          }
          ctx.restore();
        }
        const cs = Math.max(0.45, Math.min(2.2, v.k * GEO.A * 1.1));
        // cranes only in detail: from about 2.5 m per pixel (z 0.8 = 1 / (A · 2.5) on the 2 m scale)
        craneHits = [];
        for (const [X, Y, p, always] of cranes) if (v.z >= 0.8 || always) crane(ctx, v.ox + X * v.k, v.oy + Y * v.k, cs, t, p);
      }
    }
    // live traffic: jams coloured by severity (layer jams), closures and accidents as icons (closures / jams)
    if (state.layers.jams || state.layers.closures) {
      if (!traffic.timer) { refreshTraffic(); traffic.timer = setInterval(refreshTraffic, 120e3); }
      const T = trafficImg();
      if (T) {
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (!state.layers.jams) {
          // (only the closures: no queues)
        } else if (v.z < 0.3) {
          // zoomed out: cars would be smaller than a pixel, so show the queue as a thin coloured line
          const w = Math.max(1.5, v.z * 6);
          for (const j of T.jams) {
            ctx.strokeStyle = j.level >= 4 ? 'rgba(216,52,44,.85)' : j.level === 3 ? 'rgba(240,138,60,.75)' : 'rgba(242,198,109,.6)';
            ctx.lineWidth = w;
            ctx.beginPath();
            for (let i = 0; i < j.pts.length; i += 2) { const x = v.ox + j.pts[i] * v.k, y = v.oy + j.pts[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
            ctx.stroke();
          }
        } else {
          // zoomed in: the jam is drawn as a queue of cars — the worse it is, the tighter, redder and stiller
          const sec = t / 1000;
          const mk = v.k * GEO.A; // screen px per metre
          for (const j of T.jams) {
            if (!j.cum) { j.cum = [0]; for (let i = 2; i < j.pts.length; i += 2) j.cum.push(j.cum[j.cum.length - 1] + Math.hypot(j.pts[i] - j.pts[i - 2], j.pts[i + 1] - j.pts[i - 1])); }
            const total = j.cum[j.cum.length - 1];
            if (!vis(Math.min(...j.pts.filter((_, i) => i % 2 === 0)), Math.min(...j.pts.filter((_, i) => i % 2 === 1)), Math.max(...j.pts.filter((_, i) => i % 2 === 0)), Math.max(...j.pts.filter((_, i) => i % 2 === 1)))) continue;
            const gap = (j.level >= 5 ? 1.2 : j.level === 4 ? 2 : j.level === 3 ? 4 : 7) * GEO.A;
            const speed = Math.max(0, (j.speed || 0) / 3.6) * GEO.A * 0.6; // crawling speed in px/s
            const shift = (sec * speed) % (SIZE.car[0] * GEO.A + gap);
            let seed = (j.t % 9973) | 1;
            const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const pal = j.level >= 4 ? ['#d8342c', '#d8342c', '#b5241f', '#e5533a'] : j.level === 3 ? ['#d8342c', '#f08a3c', '#e5533a', '#f08a3c'] : ['#f08a3c', '#f2c66d', '#e5533a', '#f2c66d'];
            let seg = 0;
            const queue = [];
            // Waze road types 3 freeway, 4 ramp, 6 major highway count as big roads; lorries only there and outside the centre
            if (j.dist === undefined) {
              const mid = j.path[Math.floor(j.path.length / 2)];
              j.dist = Math.hypot((mid[0] - 16.608) * 72765, (mid[1] - 49.195) * 110574);
            }
            const roadClass = [3, 4, 6].includes(j.road) ? 3 : 1;
            // two rows of cars only where OSM knows two or more lanes in this direction (jamWide); on a one-way road
            // they sit either side of the axis, on a two-way road both in the right-hand half. Otherwise a single row.
            const wide = jamWide(j);
            const lanes = wide === 2 ? [-1.75, 1.75] : wide ? [1.8, 5.2] : [1.8];
            for (const [li, lane] of lanes.entries()) {
            seg = 0;
            for (let s = shift + li * (SIZE.car[0] * 0.55) * GEO.A; s < total;) {
              const kind = pickKind(rnd(), roadClass, j.dist);
              const len = SIZE[kind][0] * GEO.A;
              const at = s + len / 2;
              if (at > total) break;
              while (seg < j.cum.length - 2 && j.cum[seg + 1] < at) seg++;
              const a = seg, b = seg + 1;
              const L = j.cum[b] - j.cum[a] || 1, f = (at - j.cum[a]) / L;
              const dx = (j.pts[2 * b] - j.pts[2 * a]) / L, dy = (j.pts[2 * b + 1] - j.pts[2 * a + 1]) / L;
              // keep to the right-hand lane
              const X = j.pts[2 * a] + (j.pts[2 * b] - j.pts[2 * a]) * f - dy * lane * GEO.A, Y = j.pts[2 * a + 1] + (j.pts[2 * b + 1] - j.pts[2 * a + 1]) * f + dx * lane * GEO.A;
              const colQ = pal[Math.floor(rnd() * pal.length)];
              if (!(occluder && v.z >= 0.45 && occluder(X, Y))) queue.push([v.ox + X * v.k, v.oy + Y * v.k, dx, dy, kind, colQ]); // cars behind buildings are not drawn
              s += len + gap * (li ? 1.3 : 1);
            }
            }
            queue.sort((p, q) => p[1] - q[1]);
            for (const [x, y, dx, dy, kind, col] of queue) {
              if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
              drawCar(ctx, x, y, dx, dy, kind, col, mk, col);
            }
          }
        }
        const s = Math.max(5, Math.min(10, v.z * 7));
        // accidents, hazards and closures from Waze only from about 14 m per pixel: zoomed out they would just dot the whole city
        if (v.z >= ALERT_Z) for (const a of T.alerts) {
          if (!(a.type === 'ROAD_CLOSED' ? state.layers.closures : state.layers.jams)) continue;
          const x = v.ox + a.X * v.k, y = v.oy + a.Y * v.k;
          if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
          if (a.type === 'ROAD_CLOSED') {
            ctx.fillStyle = '#1b2333'; ctx.fillRect(x - s - 1, y - s * 0.6 - 1, 2 * s + 2, 1.2 * s + 2);
            ctx.fillStyle = '#d8342c'; ctx.fillRect(x - s, y - s * 0.6, 2 * s, 1.2 * s);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(x - s * 0.7, y - s * 0.18, 1.4 * s, s * 0.36);
          } else {
            ctx.fillStyle = a.type === 'ACCIDENT' ? '#f08a3c' : '#f2c66d';
            ctx.strokeStyle = '#1b2333'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#1b2333'; ctx.fillRect(x - 1, y - s * 0.45, 2, s * 0.65); ctx.fillRect(x - 1, y + s * 0.35, 2, 2);
          }
        }
        ctx.restore();
      }
    } else if (traffic.timer) { clearInterval(traffic.timer); traffic.timer = null; }
    if (state.layers.closures) drawClosures(ctx, v, t, cw, ch);
    drawWorks(ctx, v, t, cw, ch);
    // public transport by timetable: articulated trams, trolleybuses with poles, buses — with line numbers
    if (state.layers.mhd && selRoute) drawRoute(ctx, v, cw, ch);
    if (state.layers.mhdStops) drawStops(ctx, v, cw, ch, t); else drawnStops = [];
    if (state.layers.mhd && v.z >= 0.18) {
      // live positions when the stream delivers them, otherwise the timetable
      const useLive = state.mhdMode === 'live' && live.alive();
      const list = useLive ? liveVehicles() : mhd.vehicles();
      drawnVehicles = [];
      const LEN = { tram: 31, trol: 18, bus: 12 }; // metres (Škoda 13T tram, articulated trolleybus, standard bus)
      ctx.save();
      const labels = v.z >= 0.7;
      // draw far vehicles first so nearer ones overlap them
      list.sort((a, b) => a.Y - b.Y);
      for (const m of list) {
        if (selectedVehicle === m.id) selPos = [m.X, m.Y, performance.now()];
        if (rideId === m.id) { ridePos = [m.X, m.Y, performance.now()]; rideM = m; } // riding along with it
        const x = v.ox + m.X * v.k, y = v.oy + m.Y * v.k;
        if (x < -60 || y < -60 || x > cw + 60 || y > ch + 60) continue;
        // live vehicles: real set length (coupled cars from the feed, car length from its fleet number)
        const set = m.live && m.vid ? setLength(m.type, [m.vid, m.idb, m.idc]) : null;
        let lenM = set ? set.len : LEN[m.type];
        // phones: far out a vehicle would be a speck of a few pixels; it is stretched along its track to at least 7 px
        // (and drawTransit keeps its body half again as wide), so it can still be seen and hit with a finger
        if (TOUCH) lenM *= Math.min(4, Math.max(1, 7 / (lenM * v.k * GEO.A)));
        const n = Math.max(11, Math.min(14, Math.round(lenM / 3) + 1)); // at least 10 pieces, each tested for buildings in front
        const body = m.live ? liveBodySnapped(m, lenM * GEO.A, n) : mhd.body(m, lenM * GEO.A, n);
        const pts = [];
        for (let i = 0; i < body.length; i += 2) pts.push(v.ox + body[i] * v.k, v.oy + body[i + 1] * v.k);
        // ring around the whole vehicle: selected (solid, pulsing) or under the mouse (thin)
        const sel = selectedVehicle === m.id || rideId === m.id, hov = hoverVehicle === m.id;
        if (sel || hov) {
          let cx = 0, cy = 0;
          for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
          cx /= pts.length / 2; cy /= pts.length / 2;
          let rad = 0;
          for (let i = 0; i < pts.length; i += 2) rad = Math.max(rad, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
          rad = Math.max(sel ? 24 : 18, rad + (sel ? 14 + 3 * Math.sin(t / 250) : 8));
          ctx.strokeStyle = 'rgba(27,35,51,.8)'; ctx.lineWidth = sel ? 6 : 4;
          ctx.beginPath(); ctx.arc(cx, cy - 6, rad, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = sel ? '#f2c66d' : 'rgba(242,198,109,.75)'; ctx.lineWidth = sel ? 3 : 2;
          ctx.beginPath(); ctx.arc(cx, cy - 6, rad, 0, Math.PI * 2); ctx.stroke();
        }
        // behind a building (seen at an angle): the vehicle is not drawn, only its line badge with the delay
        let vis = null;
        if (occluder && v.z >= 0.45) {
          vis = [];
          for (let i = 0; i + 3 < body.length; i += 2) vis.push(!occluder((body[i] + body[i + 2]) / 2, (body[i + 1] + body[i + 3]) / 2));
        }
        drawTransit(ctx, pts, m.type, v.k * GEO.A, m.line, labels, m.live ? Math.round(m.delay || 0) : null, set ? set.joints : null, false, vis, TOUCH ? 1.5 : 1);
        drawnVehicles.push([m, pts, labels]);
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ stops: signs on the map, click for departures
  const stopsCache = { img: null, stamp: -1, n: 0 };
  function stopsImg() {
    const S = mhd.stops();
    const n = Object.keys(S).length;
    if (!n) { mhd.loadStops(); return []; }
    if (stopsCache.stamp !== fresh() || stopsCache.n !== n) {
      stopsCache.img = Object.entries(S).map(([num, [name, lon, lat]]) => { const [X, Y] = llToImg(lon, lat); return { num, name, X, Y }; });
      stopsCache.stamp = stamp; stopsCache.n = n;
    }
    return stopsCache.img;
  }
  let selectedStop = null, drawnStops = [];
  // a stop sign: pole and a white plate with a red border and the letter Z (zastávka)
  function stopSign(ctx, x, y, s, on) {
    const ph = Math.round(14 * s), w = Math.round(11 * s);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - ph, 3, ph);
    ctx.fillStyle = '#5b5f66'; ctx.fillRect(Math.round(x), Math.round(y) - ph, 1, ph);
    const sx = Math.round(x - w / 2), sy = Math.round(y - ph - w);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(sx - 1, sy - 1, w + 2, w + 2);
    ctx.fillStyle = on ? '#f2c66d' : '#3b6fb6'; ctx.fillRect(sx, sy, w, w);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(sx + 2, sy + 2, w - 4, w - 4);
    ctx.fillStyle = '#2b4f86'; ctx.font = `700 ${Math.max(8, Math.round(9 * s))}px "Atkinson Hyperlegible", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Z', sx + w / 2, sy + w / 2 + 0.5);
    return [sx - 2, sy - 2, sx + w + 2, Math.round(y) + 2];
  }
  function drawStops(ctx, v, cw, ch, t) {
    drawnStops = [];
    const STOP_Z = 2 / 1.3; // stops only from 1.3 m per pixel (the selected one always)
    if (v.z < STOP_Z && selectedStop == null) return;
    const s = v.z >= 1.2 ? 1.25 : 1;
    ctx.save();
    for (const st of stopsImg()) {
      const x = v.ox + st.X * v.k, y = v.oy + st.Y * v.k;
      if (x < -20 || y < -30 || x > cw + 20 || y > ch + 20) continue;
      const on = selectedStop === st.num;
      if (v.z < STOP_Z && !on) continue;
      if (on) {
        ctx.strokeStyle = '#f2c66d'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y - 12 * s, 18 + 3 * Math.sin(t / 250), 0, Math.PI * 2); ctx.stroke();
      }
      drawnStops.push([st, stopSign(ctx, x, y, s, on)]);
      if (v.z >= 1.1 || on) {
        ctx.font = '400 15px "VT323", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(27,35,51,.9)'; ctx.strokeText(st.name, x + 9, y - 18 * s);
        ctx.fillStyle = '#ffffff'; ctx.fillText(st.name, x + 9, y - 18 * s);
      }
    }
    ctx.restore();
  }
  function stopAt(sx, sy) {
    for (const [st, r] of drawnStops) if (sx >= r[0] - 3 && sx <= r[2] + 3 && sy >= r[1] - 3 && sy <= r[3] + 3) return st;
    return null;
  }
  // current delay (minutes) of every trip that a live vehicle is running right now
  function liveDelays() {
    const out = new Map();
    if (!live.alive()) return out;
    for (const lv of liveVehicles()) {
      const pv = matchPlan(lv);
      if (pv && !out.has(pv.id)) out.set(pv.id, Math.round(lv.delay || 0));
    }
    return out;
  }

  // ------------------------------------------------------------ clicking a vehicle
  let drawnVehicles = [], selectedVehicle = null, hoverVehicle = null, selPos = null, rideId = null, ridePos = null, rideM = null;
  // generous hit area: anywhere along the body (segments, not just points) or on the line-number badge
  function vehicleAt(sx, sy) {
    let best = null, bd = TOUCH ? 24 : 16; // (a finger is wider than a mouse pointer)
    for (const [m, pts, labels] of drawnVehicles) {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1] - 5, bx = pts[i + 2], by = pts[i + 3] - 5;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
        const d = Math.hypot(ax + dx * tt - sx, ay + dy * tt - sy);
        if (d < bd) { bd = d; best = m; }
      }
      if (labels && Math.abs(sx - pts[0]) < (TOUCH ? 24 : 18) && sy < pts[1] - 4 && sy > pts[1] - 40) { best = m; bd = 0; }
    }
    hoverVehicle = best ? best.id : null;
    return best;
  }

  // ------------------------------------------------------------ hit tests for clicks
  function trafficAt(sx, sy, v) {
    const cl = closureAt(sx, sy, v);
    if (cl) return cl;
    const wk = workAt(sx, sy, v);
    if (wk) return wk;
    const T = (state.layers.jams || state.layers.closures) && trafficImg();
    if (!T) return null;
    if (v.z >= ALERT_Z) for (const a of T.alerts) if ((a.type === 'ROAD_CLOSED' ? state.layers.closures : state.layers.jams) && Math.hypot(v.ox + a.X * v.k - sx, v.oy + a.Y * v.k - sy) < 12) return { alert: a };
    if (state.layers.jams) for (const j of T.jams) {
      for (let i = 0; i + 3 < j.pts.length; i += 2) {
        const ax = v.ox + j.pts[i] * v.k, ay = v.oy + j.pts[i + 1] * v.k, bx = v.ox + j.pts[i + 2] * v.k, by = v.oy + j.pts[i + 3] * v.k;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
        if (Math.hypot(ax + dx * tt - sx, ay + dy * tt - sy) < 7) return { jam: j };
      }
    }
    return null;
  }

  return { setOccluder: f => (occluder = f), llToImg, draw, projectsAt, projectTags, projectDetail, trafficAt, inJam, traffic, proj, mhd, live, matchPlan, setRoute, stopAt, liveDelays, selectStop: num => (selectedStop = num), vehicleAt, selectVehicle: id => { if (id !== selectedVehicle) selPos = null; selectedVehicle = id; if (!id) selRoute = null; }, selectedPos: () => selPos, craneAt, projOn, areaHidden, setAreaHidden, projectPos, drawnVehicles: () => drawnVehicles.map(d => d[0]), setRide: id => { rideId = id; ridePos = null; rideM = null; }, ridePos: () => ridePos, rideVehicle: () => rideM, stamp: () => fresh(), setPosition, confirmPosition, resetPosition, ownCorrections, correction, positionInfo, clos: () => clos.data, works: () => { if (!works.data) worksImg(); return works.data; } };
}
