// Everything drawn over the map tiles: district labels, clouds, night lights,
// weather, traffic, chimney smoke, highlighted buildings and place pins.
import { drawCar, pickKind, CAR_COLORS, VAN_COLORS, TRUCK_CABS } from './vehicles.js';

export function createFx({ canvas, pins, viewer, GEO, state, data }) {
  const ctx = canvas.getContext('2d');
  const S = GEO.A * 2; // sizes below were tuned at 2 m per image pixel
  let dpr = 1, cw = 0, ch = 0;
  const fx = { hover: null, selected: null, pieces: b => [b] }; // pieces: every outline of a building (set by the page)
  let night = 0, weather = 'clear', season = 'summer', dm = false; // dm: a datová mapa is on (the map goes grey)

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  resize();
  addEventListener('resize', resize);

  // ---------------------------------------------------------- seeded noise
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  // ---------------------------------------------------------- clouds: fluffy cumulus high above the map, with shadows
  // Each cloud is a pixel-art sprite built from overlapping puffs, lit from the upper left,
  // with a flat grey base; its shadow falls on the ground far below.
  function cloudSprite(w, h) {
    const puffs = [];
    const base = h * 0.66;
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) puffs.push([w * (0.14 + (0.72 * i) / (n - 1)) + (rnd() - 0.5) * 3, base - rnd() * 2, h * (0.24 + rnd() * 0.12)]);
    const m = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < m; i++) puffs.push([w * (0.3 + rnd() * 0.4), h * (0.36 + rnd() * 0.12), h * (0.3 + rnd() * 0.14)]);
    const flatY = Math.round(h * 0.84);
    const inside = (x, y) => y <= flatY && puffs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const cloud = mk(), shadow = mk();
    const g = cloud.getContext('2d'), gs = shadow.getContext('2d');
    gs.fillStyle = 'rgba(16,24,44,1)';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      gs.fillRect(x, y, 1, 1);
      // light from the nearest puff's surface normal
      let best = null, bd = Infinity;
      for (const p of puffs) { const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) - p[2]; if (Math.abs(d) < bd) { bd = Math.abs(d); best = p; } }
      const nx = (x + 0.5 - best[0]) / best[2], ny = (y + 0.5 - best[1]) / best[2];
      const lit = -0.55 * nx - 0.83 * ny + (y < flatY - 2 ? 0 : -0.6);
      const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5);
      g.fillStyle = lit > 0.5 ? '#ffffff' : lit > 0.05 ? '#f1f4f8' : lit > -0.35 ? '#dde4ec' : '#c3cdd9';
      g.globalAlpha = edge ? 0.85 : 1;
      g.fillRect(x, y, 1, 1);
    }
    return { cloud, shadow };
  }
  const clouds = [];
  for (let i = 0; i < 28; i++) {
    clouds.push({
      X: rnd() * GEO.W * 1.15 - GEO.W * 0.05,
      Y: rnd() * GEO.H * 0.95,
      v: (7 + rnd() * 9) * GEO.A * 2,
      alt: 1400 + rnd() * 800, // metres above the ground
      ...cloudSprite(34 + Math.floor(rnd() * 26), 16 + Math.floor(rnd() * 8)),
    });
  }

  // ---------------------------------------------------------- night lights (prepared once in image space / 8)
  const LS = 8 * S;
  const lightCanvas = document.createElement('canvas');
  const litMask = document.createElement('canvas'); // where it is lit: soft, strong alpha (built from the light map)
  const nightCanvas = document.createElement('canvas'); // the night veil, with holes where it is lit
  let litStamp = 0, nightKey = ''; // the veil is rebuilt only when the view, the size or the darkness changes
  function buildLitMask() {
    const W = lightCanvas.width, H = lightCanvas.height;
    litMask.width = W; litMask.height = H;
    const m = litMask.getContext('2d');
    const small = document.createElement('canvas'); small.width = Math.ceil(W / 3); small.height = Math.ceil(H / 3);
    const sg = small.getContext('2d'); sg.imageSmoothingEnabled = true;
    // several passes: the scattered lights of windows and lamps join into lit streets and quarters
    sg.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) sg.drawImage(lightCanvas, 0, 0, small.width, small.height);
    m.imageSmoothingEnabled = true;
    m.globalCompositeOperation = 'lighter';
    m.drawImage(small, 0, 0, W, H);
    m.globalAlpha = 0.5; m.drawImage(lightCanvas, 0, 0); // the lit streets themselves a little more
    litStamp++;
  }
  fx.prepareLights = () => {
    const L = data.lights;
    if (!L) return;
    lightCanvas.width = Math.ceil(GEO.W / LS); lightCanvas.height = Math.ceil(GEO.H / LS);
    const g = lightCanvas.getContext('2d');
    const raw = L.raw || Uint8Array.from(atob(L.d), ch => ch.charCodeAt(0)); // (lights.png decoded by the page, or the older base64)
    const cs = L.cell / LS;
    seed = 7;
    // street lamps along main roads
    g.strokeStyle = 'rgba(255,196,110,0.55)';
    g.lineWidth = 0.9;
    for (const [c, p] of data.routes) {
      if (c === 9) continue;
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, p[i] / LS, p[i + 1] / LS);
      g.stroke();
    }
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) {
      const d = raw[j * L.w + i];
      if (!d) continue;
      const n = Math.ceil(d / 50);
      for (let q = 0; q < n; q++) {
        const x = (i + rnd()) * cs, y = (j + rnd()) * cs;
        const warm = rnd();
        g.fillStyle = warm < 0.7 ? `rgba(255,${200 + Math.floor(rnd() * 40)},120,${0.35 + d / 600})` : `rgba(190,215,255,${0.25 + d / 800})`;
        g.fillRect(x, y, 0.8, 0.8);
      }
    }
    buildLitMask();
  };

  // ---------------------------------------------------------- traffic
  let cars = [];
  function prepareTraffic() {
    seed = 1234;
    cars = [];
    for (const [c, p, ow] of data.routes) {
      const cum = [0];
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      const len = cum[cum.length - 1];
      const route = { c, p, cum, len, ow: !!ow, bb: [x0 - 20, y0 - 20, x1 + 20, y1 + 20], cars: [] };
      // local streets (class 0) get only an occasional car, so every street shows it is a road
      const per = (c === 9 ? 260 : c === 3 ? 40 : c === 2 ? 60 : c === 1 ? 110 : 420) * S;
      let n = Math.round(len / per);
      if (!n && c !== 9) n = c === 0 ? (rnd() < len / per ? 1 : 0) : 1;
      for (let i = 0; i < n; i++) {
        const dir = ow ? 1 : rnd() < 0.5 ? 1 : -1; // one-way streets: only the allowed way
        const col = c === 9 ? '#c8202a' : ['#c9583b', '#eef1e6', '#3b6fb6', '#2b2f38', '#f2c66d', '#9aa3ad', '#5c8f4a'][Math.floor(rnd() * 7)];
        // lorries only on motorways / the outer big roads, vans and cars everywhere
        const mx = (x0 + x1) / 2 / GEO.A - GEO.R, my = ((y0 + y1) / 2 - GEO.TOP) * 2 / GEO.A - GEO.R;
        const kind = pickKind(rnd(), c, Math.hypot(mx, my));
        const color = kind === 'van' ? VAN_COLORS[Math.floor(rnd() * VAN_COLORS.length)] : CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)];
        route.cars.push({ o: rnd() * len, s: (c === 9 ? 5 : c === 3 ? 14 : c === 0 ? 6 : 9) * S * (kind === 'truck' ? 0.75 : 1) * (0.8 + rnd() * 0.4), dir, col: color, kind, cab: TRUCK_CABS[Math.floor(rnd() * TRUCK_CABS.length)] });
      }
      cars.push(route);
    }
  }
  function along(r, s) {
    let lo = 0, hi = r.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const u = (s - r.cum[lo]) / seg;
    const ax = r.p[2 * lo], ay = r.p[2 * lo + 1], bx = r.p[2 * hi], by = r.p[2 * hi + 1];
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    return [ax + (bx - ax) * u, ay + (by - ay) * u, dx, dy];
  }

  // ---------------------------------------------------------- weather particles
  const drops = [];
  for (let i = 0; i < 420; i++) drops.push({ x: Math.random(), y: Math.random(), z: 0.5 + Math.random() * 0.5 });

  // ---------------------------------------------------------- pins for places
  let pinEls = [];
  fx.setStories = list => {
    pinEls = list.map(s => {
      const el = document.createElement('div');
      el.className = 'pin';
      el.textContent = s.n;
      el.style.display = 'none';
      pins.append(el);
      return { el, s };
    });
  };
  // The marker of the place a card is about: shown as long as the card is open (fx.cardOpen, set by main.js), or
  // for a few seconds when there is no card. A card opened without a fresh marker (a vehicle, a building) drops it.
  let markerEl = null, markerUntil = 0, markerXY = null, markerAt = -1e9;
  fx.cardOpen = () => false;
  fx.marker = (X, Y, ms = 7000) => {
    if (!markerEl) { markerEl = document.createElement('div'); markerEl.className = 'here-pin'; pins.append(markerEl); }
    markerXY = [X, Y]; markerAt = performance.now(); markerUntil = markerAt + ms;
  };
  fx.markerOff = () => { markerXY = null; };
  fx.markerIfNone = (X, Y) => { if (!markerXY) fx.marker(X, Y); };
  fx.cardOpened = () => { if (performance.now() - markerAt > 2000) markerXY = null; };

  // ---------------------------------------------------------- state setters
  const osdCanvas = () => viewer.drawer && viewer.drawer.canvas && viewer.drawer.canvas.parentElement;
  function applyFilter() {
    const el = osdCanvas();
    if (!el) return;
    const golden = Math.max(0, 1 - Math.abs(night - 0.5) * 2.2);
    const dark = Math.max(0, (night - 0.45) / 0.55);
    const fog = weather === 'fog' ? 1 : 0, rain = weather === 'rain' ? 1 : 0;
    const f = [];
    const b = 1 - 0.1 * golden - 0.14 * dark - 0.08 * rain; // night: lit places only a little darker than by day, the rest is the veil (fx.draw)
    if (b < 0.999) f.push(`brightness(${b.toFixed(3)})`);
    if (golden > 0.01) f.push(`sepia(${(0.38 * golden).toFixed(3)})`);
    const sat = 1 + 0.25 * golden - 0.25 * rain - 0.15 * fog;
    if (Math.abs(sat - 1) > 0.001) f.push(`saturate(${sat.toFixed(3)})`);
    if (fog) f.push('contrast(0.92)');
    if (dm) f.push('saturate(0.2)', 'brightness(0.86)'); // the city steps back, the data shine
    el.style.filter = f.join(' ');
  }
  fx.resetTraffic = () => { cars = []; };
  fx.setNight = v => { night = v; applyFilter(); };
  fx.setWeather = w => { weather = w; applyFilter(); };
  fx.setDatamap = on => { dm = !!on; applyFilter(); };
  fx.size = () => ({ cw, ch, dpr });
  // live weather: cloud cover 0..1, precipitation mm/h, wind km/h
  fx.cloud = 0.5; fx.precip = -1; fx.wind = 0;
  fx.setSeason = s => { season = s; };
  viewer.addHandler('open', applyFilter);

  // ---------------------------------------------------------- drawing
  // map labels use VT323: a pixel font whose letters (Z, Ž, Ř…) stay easy to read
  const labelFont = px => `400 ${px}px "VT323", "Courier New", monospace`;
  if (document.fonts) document.fonts.load('20px "VT323"').catch(() => {});
  function drawLabels(v) {
    if (!state.layers.labels) return;
    const k = v.k;
    const boxes = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const list = data.labels;
    for (let pass = 1; pass <= 3; pass++) {
      if (pass === 2 && v.z < 0.16) break;
      if (pass === 3) break;
      const size = Math.round(Math.min(30, Math.max(15, (pass === 1 ? 19 : 16.5) * Math.pow(v.z / 0.103, 0.28))));
      ctx.font = labelFont(size);
      for (const l of list) {
        if (l.r !== pass) continue;
        const sx = v.ox + l.X * k, sy = v.oy + l.Y * k;
        if (sx < -100 || sy < -20 || sx > cw + 100 || sy > ch + 20) continue;
        const text = l.n.toUpperCase();
        const w = ctx.measureText(text).width;
        const box = [sx - w / 2 - 4, sy - size / 2 - 3, sx + w / 2 + 4, sy + size / 2 + 3];
        if (boxes.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
        boxes.push(box);
        if (pass <= 2) fx.labelRects.push([...box, l]); // the names of quarters open a card
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(27,35,51,.85)';
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = '#eef1e6';
        ctx.fillText(text, sx, sy);
      }
    }
  }

  function drawClouds(t, v) {
    // pixel size of one cloud pixel; clouds fade away when zoomed in close
    const s = Math.max(1, Math.min(7, Math.round(v.z * 9)));
    const fade = Math.max(0, Math.min(1, 1.6 - v.z));
    if (fade <= 0) return;
    ctx.imageSmoothingEnabled = false;
    const span = GEO.W * 1.2;
    // cloud cover 0 means a truly clear sky (the summer look, or "Jasno" chosen by hand); otherwise at least a few clouds
    const count = fx.cloud <= 0 ? 0 : Math.round(clouds.length * Math.max(0.05, Math.min(1, fx.cloud)));
    for (let ci = 0; ci < count; ci++) {
      const c = clouds[ci];
      let X = c.X + (t / 1000) * c.v * (1 + fx.wind / 15);
      X = ((X + GEO.W * 0.1) % span) - GEO.W * 0.1;
      const w = c.cloud.width * s, h = c.cloud.height * s;
      const gx = v.ox + X * v.k, gy = v.oy + c.Y * v.k; // shadow on the ground
      const lift = c.alt * GEO.V * v.k; // the cloud itself floats this much higher
      ctx.globalAlpha = (weather === 'fog' ? 0.08 : 0.16) * fade;
      if (!(gx + w < 0 || gy + h < 0 || gx > cw || gy > ch)) ctx.drawImage(c.shadow, Math.round(gx + w * 0.25), Math.round(gy), w, h);
      ctx.globalAlpha = (weather === 'fog' ? 0.55 : 0.95) * fade;
      const sy = gy - lift;
      if (!(gx + w < 0 || sy + h < 0 || gx > cw || sy > ch)) ctx.drawImage(c.cloud, Math.round(gx), Math.round(sy), w, h);
    }
    ctx.globalAlpha = 1;
  }

  function drawTraffic(t, v) {
    if (!state.layers.traffic || dm || v.z < 0.4 || night > 0.97) return; // (no cars over a datová mapa)
    if (!cars.length) { if (!data.routes.length) { if (fx.needRoutes) fx.needRoutes(); return; } prepareTraffic(); } // (the roads come when first needed)
    const x0 = -v.ox / v.k, y0 = -v.oy / v.k, x1 = x0 + cw / v.k, y1 = y0 + ch / v.k;
    const sec = t / 1000;
    const cs = Math.max(1.5, v.z * 2.2);
    for (const r of cars) {
      if (r.c === 9 && state.layers.mhd) continue; // trams come from the timetable layer
      if (r.bb[2] < x0 || r.bb[0] > x1 || r.bb[3] < y0 || r.bb[1] > y1) continue;
      for (const c of r.cars) {
        let s = (c.o + c.dir * c.s * sec) % r.len; if (s < 0) s += r.len;
        const [X, Y, dx, dy] = along(r, s);
        if (X < x0 - 5 || X > x1 + 5 || Y < y0 - 5 || Y > y1 + 5) continue;
        const off = r.c === 9 || r.ow ? 0 : (r.c === 0 ? 1.2 : 1.6) * S * c.dir; // keep right; one-way: middle of the road
        const px = X - dy * off, py = Y + dx * off;
        if (r.c !== 9 && fx.inJam && fx.inJam(px, py)) continue; // that stretch is a jam: cars stand there instead
        if (fx.occluder && v.z >= 0.45 && fx.occluder(px, py)) continue; // behind a building (seen at an angle)
        const sx = v.ox + px * v.k, sy = v.oy + py * v.k;
        if (r.c === 9) {
          const L = 9 * v.z;
          ctx.strokeStyle = c.col; ctx.lineWidth = Math.max(2, 2.4 * v.z); ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(sx - dx * L / 2, sy - dy * L / 2); ctx.lineTo(sx + dx * L / 2, sy + dy * L / 2); ctx.stroke();
          ctx.strokeStyle = '#efe6cf'; ctx.lineWidth = Math.max(1, 0.8 * v.z);
          ctx.beginPath(); ctx.moveTo(sx - dx * L / 2, sy - dy * L / 2 - v.z * 0.6); ctx.lineTo(sx + dx * L / 2, sy + dy * L / 2 - v.z * 0.6); ctx.stroke();
        } else {
          drawCar(ctx, sx, sy, dx * c.dir, dy * c.dir, c.kind, c.col, v.k * GEO.A, c.cab);
          if (night > 0.6) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(Math.round(sx + dx * c.dir * 3 * v.k) - 1, Math.round(sy + dy * c.dir * 3 * v.k) - 1, 2, 2); } // headlights
        }
      }
    }
  }

  function drawSmoke(t, v) {
    if (!state.layers.smoke || v.z < 0.22) return;
    const sec = t / 1000;
    for (const [X, Y] of data.chimneys) {
      const sx = v.ox + X * v.k, sy = v.oy + Y * v.k;
      if (sx < -80 || sx > cw + 80 || sy < -120 || sy > ch + 20) continue;
      for (let i = 0; i < 7; i++) {
        const ph = (sec * 0.18 + i / 7 + (X % 7) / 7) % 1;
        const r = (1.2 + ph * 5) * v.z * 1.6;
        ctx.fillStyle = `rgba(${200 + 30 * (1 - ph)},${205 + 30 * (1 - ph)},${215},${(1 - ph) * 0.5})`;
        ctx.beginPath();
        ctx.arc(sx + ph * 26 * v.z, sy - ph * 34 * v.z, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function outline(b, v, color, width) {
    const p = b[0], hp = b[1];
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'miter';
    const P = i => [v.ox + p[i] * v.k, v.oy + p[i + 1] * v.k];
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = P(i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
    // left- and right-most corners drop down to the ground
    let li = 0, ri = 0;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < p[li]) li = i; if (p[i] > p[ri]) ri = i; }
    ctx.beginPath();
    for (const i of [li, ri]) { const [x, y] = P(i); ctx.moveTo(x, y); ctx.lineTo(x, y + hp * v.k); }
    ctx.stroke();
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.18)');
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = P(i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill();
  }

  function drawWeather(t) {
    const sec = t / 1000;
    if (fx.cloud > 0.7) { ctx.fillStyle = `rgba(60,70,92,${(0.14 * (fx.cloud - 0.7)) / 0.3})`; ctx.fillRect(0, 0, cw, ch); }
    if (weather === 'rain') {
      ctx.fillStyle = 'rgba(40,52,74,0.18)'; ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(190,210,240,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const nd = fx.precip < 0 ? drops.length : Math.min(drops.length, 70 + fx.precip * 160);
      for (let di = 0; di < nd; di++) {
        const d = drops[di];
        const x = ((d.x * cw + sec * 120 * d.z) % (cw + 40)) - 20, y = ((d.y * ch + sec * 620 * d.z) % (ch + 40)) - 20;
        ctx.moveTo(x, y); ctx.lineTo(x - 3 * d.z, y - 12 * d.z);
      }
      ctx.stroke();
    } else if (weather === 'snow') {
      ctx.fillStyle = 'rgba(220,230,245,0.12)'; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const ns = fx.precip < 0 ? drops.length : Math.min(drops.length, 90 + fx.precip * 200);
      for (let di = 0; di < ns; di++) {
        const d = drops[di];
        const x = (((d.x * cw + Math.sin(sec * 0.8 + d.y * 20) * 18 + sec * 14) % (cw + 20)) + cw + 20) % (cw + 20) - 10;
        const y = ((d.y * ch + sec * 46 * d.z) % (ch + 20)) - 10;
        const s = d.z > 0.8 ? 3 : 2;
        ctx.fillRect(Math.round(x), Math.round(y), s, s);
      }
    } else if (weather === 'fog') {
      // only a hint of fog: a thin veil and a few drifting lighter patches (the map stays readable)
      ctx.fillStyle = 'rgba(196,204,214,0.14)'; ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 6; i++) {
        const x = ((i * 0.23 + sec * 0.012) % 1.4 - 0.2) * cw, y = (0.15 + i * 0.14) * ch;
        const g = ctx.createRadialGradient(x, y, 10, x, y, cw * 0.35);
        g.addColorStop(0, 'rgba(220,226,232,0.16)'); g.addColorStop(1, 'rgba(220,226,232,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      }
    }
  }

  function drawNight(v) {
    if (night < 0.02) return;
    const dark = Math.max(0, (night - 0.45) / 0.55);
    const golden = Math.max(0, 1 - Math.abs(night - 0.5) * 2.2);
    if (golden > 0) { ctx.fillStyle = `rgba(255,150,60,${0.1 * golden})`; ctx.fillRect(0, 0, cw, ch); }
    if (dark > 0) {
      // the light map (data/r<ROT>/lights.json) is fetched the first time the night falls
      if (!litStamp && fx.needLights) fx.needLights(); // (litStamp: the mask has been built; a fresh canvas has a width too)
      const lw = lightCanvas.width * LS * v.k, lh = lightCanvas.height * LS * v.k;
      // the veil (full-screen fill and three passes of the mask) is costly: kept from the last frame while the view stands still
      const key = `${cw}|${ch}|${v.ox}|${v.oy}|${v.k}|${dark}|${litStamp}`;
      if (key !== nightKey) {
        nightKey = key;
        if (nightCanvas.width !== cw || nightCanvas.height !== ch) { nightCanvas.width = cw; nightCanvas.height = ch; }
        const n = nightCanvas.getContext('2d');
        n.globalCompositeOperation = 'source-over'; n.globalAlpha = 1;
        n.clearRect(0, 0, cw, ch);
        n.fillStyle = `rgba(8,14,42,${0.7 * dark})`; n.fillRect(0, 0, cw, ch);
        if (litStamp) {
          n.globalCompositeOperation = 'destination-out'; // holes in the veil where it is lit (never quite day)
          n.imageSmoothingEnabled = true;
          // three passes: where it is lit the veil is gone completely (the map exactly as by day)
          for (let k = 0; k < 3; k++) n.drawImage(litMask, v.ox, v.oy, lw, lh);
        }
      }
      ctx.drawImage(nightCanvas, 0, 0, cw, ch);
    }
  }

  // Wikipedia places: small name tags (click one to open its card)
  fx.wikiRects = [];
  // Name tags of places (Wikipedia, city projects, GO TO BRNO): shown only when zoomed in to about 0.7 m per pixel
  // and only after the view has stood still for ~2 s; then they fade in next to the place (not over it), each with
  // a thin line ending in a dot on the place it belongs to. Click on a tag opens its card.
  const TAG_Z = 2 / 0.7, TAG_WAIT = 1000, TAG_FADE = 450, TAG_MAX = 28;
  let tagView = '', tagStill = 0, tagLayout = null;
  // Landmarks (Špilberk, the cathedral, AZ Tower, the exhibition grounds, Villa Tugendhat): a permanent gold
  // tag while the other name tags are hidden, so the city can be read even zoomed out
  const LANDMARKS = ['Špilberk', 'Katedrála svatého Petra a Pavla', 'AZ Tower', 'Brněnské výstaviště', 'Vila Tugendhat'];
  function drawLandmarks(v) {
    if (!data.wikiPois || !state.layers.labels || v.z >= TAG_Z || v.z < 0.08) return;
    ctx.font = labelFont(16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const title of LANDMARKS) {
      const p = data.wikiPois.find(w => w[1] === title);
      if (!p) continue;
      const sx = Math.round(v.ox + p[2] * v.k), sy = Math.round(v.oy + p[3] * v.k);
      if (sx < -100 || sy < -40 || sx > cw + 100 || sy > ch + 40) continue;
      const txt = `★ ${p[0]}`, w = Math.ceil(ctx.measureText(txt).width) + 10, h = 20, x0 = sx - Math.round(w / 2), y0 = sy - h - 8;
      ctx.fillStyle = '#e6c15a'; ctx.fillRect(sx - 1, y0 + h, 2, 8);
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x0 + 2, y0 + 2, w, h);
      ctx.fillStyle = '#e6c15a'; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#232d42'; ctx.fillRect(x0 + 2, y0 + 2, w - 4, h - 4);
      ctx.fillStyle = '#f6e7b4'; ctx.fillText(txt, sx, y0 + h / 2 + 0.5);
      (fx.landmarkRects ||= []).push([x0, y0, x0 + w, y0 + h + 8, p]);
    }
  }
  function drawWikiMarks(v) {
    fx.wikiRects = [];
    if (!data.wikiPois || !state.layers.labels || v.z < TAG_Z) { tagLayout = null; tagView = ''; return; }
    const now = performance.now();
    const key = `${Math.round(v.ox)},${Math.round(v.oy)},${v.k.toFixed(4)},${cw},${ch}`;
    if (key !== tagView) { tagView = key; tagStill = now; tagLayout = null; return; } // moving: no tags
    if (now - tagStill < TAG_WAIT) return;
    const size = 17;
    ctx.font = labelFont(size);
    ctx.textBaseline = 'middle';
    if (!tagLayout) {
      // order: places with a story, city projects, other Wikipedia places, GO TO BRNO places
      const projTags = (fx.projTags || []).filter(q => !fx.projOn || fx.projOn(q.proj));
      const list = [];
      for (const p of data.wikiPois) if (p[4]) list.push(p);
      for (const q of projTags) list.push([q.n, null, q.X, q.Y, 1, q]);
      for (const p of data.wikiPois) if (!p[4]) list.push(p);
      for (const q of fx.placeTags || []) list.push(q);
      const boxes = [], dots = [], out = [];
      const free = (b, pad = 3) => !boxes.some(q => q[0] < b[2] + pad && q[2] > b[0] - pad && q[1] < b[3] + pad && q[3] > b[1] - pad) && !dots.some(([x, y]) => x > b[0] - 6 && x < b[2] + 6 && y > b[1] - 6 && y < b[3] + 6);
      const anchors = [];
      for (const p of list) {
        const sx = Math.round(v.ox + p[2] * v.k), sy = Math.round(v.oy + p[3] * v.k);
        if (sx < 10 || sy < 10 || sx > cw - 10 || sy > ch - 10) continue;
        if (anchors.some(([x, y]) => Math.abs(x - sx) < 4 && Math.abs(y - sy) < 4)) continue;
        anchors.push([sx, sy, p]);
      }
      for (const [sx, sy] of anchors) dots.push([sx, sy]);
      for (const [sx, sy, p] of anchors) {
        if (out.length >= TAG_MAX) break;
        const tw = Math.ceil(ctx.measureText(p[0]).width), w = tw + 12, h = size + 8;
        // try places around the point: up-right, up-left, right, left, down…, then farther away
        let placed = null;
        for (const dist of [46, 74, 104]) {
          for (const [dx, dy] of [[0.7, -0.7], [-0.7, -0.7], [1, -0.2], [-1, -0.2], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0, 1]]) {
            const cx = sx + dx * dist, cy = sy + dy * dist * 0.75;
            const x0 = Math.round(dx > 0.3 ? cx : dx < -0.3 ? cx - w : cx - w / 2), y0 = Math.round(cy - h / 2);
            const b = [x0, y0, x0 + w, y0 + h];
            if (b[0] < 4 || b[1] < 4 || b[2] > cw - 4 || b[3] > ch - 4) continue;
            if (!free(b)) continue;
            placed = b; break;
          }
          if (placed) break;
        }
        if (!placed) continue;
        boxes.push(placed);
        out.push({ p, sx, sy, b: placed });
      }
      tagLayout = { out, t0: now };
    }
    const a = Math.min(1, (now - tagLayout.t0) / TAG_FADE); // fade in
    ctx.save();
    ctx.globalAlpha = a;
    for (const { p, sx, sy, b } of tagLayout.out) {
      const [x0, y0, x1, y1] = b, w = x1 - x0, h = y1 - y0;
      const isProj = !!p[5];
      const hasProj = !isProj && fx.projByWiki && fx.projByWiki.has(p[1]) && fx.projByWiki.get(p[1]).some(q => !fx.projOn || fx.projOn(q));
      const edge = isProj ? '#f2c66d' : p[6] ? '#5fb3e6' : '#8cc063';
      // leader line from the tag to the dot on the place
      const lx = Math.max(x0, Math.min(x1, sx)), ly = sy < y0 ? y0 : sy > y1 ? y1 : (sx < x0 ? y0 + h / 2 : y0 + h / 2);
      const ex = sx < x0 ? x0 : sx > x1 ? x1 : lx;
      ctx.strokeStyle = 'rgba(27,35,51,.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ex, ly); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ex, ly); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.fillStyle = '#1b2333'; ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = edge; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
      // the tag
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x0 + 2, y0 + 2, w, h);
      ctx.fillStyle = edge; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#232d42'; ctx.fillRect(x0 + 2, y0 + 2, w - 4, h - 4);
      if (hasProj) { ctx.fillStyle = '#f2c66d'; ctx.fillRect(x1 - 8, y0, 8, 8); } // also a city project here
      ctx.fillStyle = '#eef1e6'; ctx.textAlign = 'center';
      ctx.fillText(p[0], x0 + w / 2, y0 + h / 2 + 0.5);
      if (a > 0.3) fx.wikiRects.push([x0, y0, x1, y1, p], [sx - 7, sy - 7, sx + 7, sy + 7, p]);
    }
    ctx.restore();
  }

  // Street names: written along the street, only when zoomed in (main roads from about 2.5 m per pixel,
  // all streets from about 1.5 m per pixel); each name at most once per ~half screen, never over other labels
  let streetPrep = null, streetSrc = null;
  function prepStreets() {
    if (streetSrc === data.streets) return streetPrep;
    streetSrc = data.streets;
    streetPrep = (data.streets || []).map(([n, r, p]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const cum = [0];
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
        if (i) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
      }
      return { n, r, p, cum, L: cum[cum.length - 1], b: [x0, y0, x1, y1] };
    });
    return streetPrep;
  }
  // point and direction at arc length s (image px) along a street
  function alongSt(st, s) { // (street names; along() above moves the cars)
    const { p, cum } = st;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1, f = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
    const ax = p[2 * i - 2], ay = p[2 * i - 1], bx = p[2 * i], by = p[2 * i + 1];
    return [ax + (bx - ax) * f, ay + (by - ay) * f, Math.atan2(by - ay, bx - ax)];
  }
  const charW = new Map();
  function drawStreetNames(v) {
    if (!state.layers.labels || v.z < 0.8) return;
    if (!data.streets) { if (fx.needStreets) fx.needStreets(); return; } // (the streets come when first needed)
    const list = prepStreets();
    const maxRank = v.z >= 1.3 ? 3 : 2;
    const size = v.z >= 2.5 ? 18 : v.z >= 1.6 ? 16 : 15;
    ctx.font = labelFont(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const k = v.k, pad = 60;
    const boxes = (fx.wikiRects || []).map(r => [r[0], r[1], r[2], r[3]]);
    const seen = new Map(); // name -> placed label centres
    const gap = Math.max(cw, ch) * 0.55; // the same name again only this far away
    const spacing = 900; // screen px between repeats along one long street
    const wOf = c => { const key = `${size}${c}`; let w = charW.get(key); if (w === undefined) { w = ctx.measureText(c).width; charW.set(key, w); } return w; };
    let drawn = 0;
    for (const st of list) {
      if (st.r > maxRank) continue;
      const [bx0, by0, bx1, by1] = st.b;
      if (v.ox + bx1 * k < -pad || v.ox + bx0 * k > cw + pad || v.oy + by1 * k < -pad || v.oy + by0 * k > ch + pad) continue;
      const text = st.n;
      const chars = [...text];
      const widths = chars.map(wOf);
      const tw = widths.reduce((a, b) => a + b, 0);
      const Ls = st.L * k; // street length on screen
      if (Ls < tw + 24) continue;
      const nRep = Math.max(1, Math.floor(Ls / spacing));
      for (let rep = 0; rep < nRep; rep++) {
        const sMid = ((rep + 0.5) / nRep) * st.L;
        const half = tw / 2 / k;
        if (sMid - half < 0 || sMid + half > st.L) continue;
        const [mx, my] = alongSt(st, sMid);
        const cx = v.ox + mx * k, cy = v.oy + my * k;
        if (cx < 0 || cy < 0 || cx > cw || cy > ch) continue;
        const prev = seen.get(text);
        if (prev && prev.some(([px, py]) => Math.hypot(px - cx, py - cy) < gap)) continue;
        // read left to right: reverse when the street runs right to left here
        const [ax, ay] = alongSt(st, sMid - half), [bx, by] = alongSt(st, sMid + half);
        const flip = bx < ax;
        // place each letter on the street line; give up on sharp bends
        const glyphs = [];
        let s = flip ? sMid + half : sMid - half, ok = true, lastA = null;
        for (let i = 0; i < chars.length; i++) {
          const w = widths[i] / k;
          const [x, y, a0] = alongSt(st, flip ? s - w / 2 : s + w / 2);
          const a = flip ? a0 + Math.PI : a0;
          if (lastA !== null) { let d = Math.abs(a - lastA); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.5) { ok = false; break; } }
          lastA = a;
          glyphs.push([chars[i], v.ox + x * k, v.oy + y * k, a]);
          s += flip ? -w : w;
        }
        if (!ok) continue;
        const r = size * 0.55;
        const gb = glyphs.map(([, x, y]) => [x - r, y - r, x + r, y + r]);
        if (gb.some(g => boxes.some(q => q[0] < g[2] && q[2] > g[0] && q[1] < g[3] && q[3] > g[1]))) continue;
        for (const g of gb) boxes.push(g);
        if (prev) prev.push([cx, cy]); else seen.set(text, [[cx, cy]]);
        for (const pass of [0, 1]) {
          for (const [c, x, y, a] of glyphs) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.translate(x, y);
            ctx.rotate(a);
            if (pass === 0) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(27,35,51,.8)'; ctx.strokeText(c, 0, 0); }
            else { ctx.fillStyle = st.r === 1 ? '#fbe7b0' : '#eef1e6'; ctx.fillText(c, 0, 0); }
          }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (++drawn > 60) return;
      }
    }
  }

  function placePins(v) {
    const show = v.z >= 0.6 && state.layers.labels;
    for (const { el, s } of pinEls) {
      const sx = v.ox + s.X * v.k, sy = v.oy + s.Y * v.k;
      const vis = show && sx > -150 && sx < cw + 150 && sy > -40 && sy < ch + 60;
      el.style.display = vis ? 'block' : 'none';
      if (vis) { el.style.left = `${sx}px`; el.style.top = `${sy}px`; }
    }
    if (markerEl) {
      const on = !!markerXY && (fx.cardOpen() || performance.now() < markerUntil);
      markerEl.style.display = on ? 'block' : 'none';
      if (on) { markerEl.style.left = `${v.ox + markerXY[0] * v.k}px`; markerEl.style.top = `${v.oy + markerXY[1] * v.k}px`; }
    }
  }

  fx.labelRects = []; fx.area = null; // area: rings (image px) of the quarter whose card is open
  fx.labelAt = (sx, sy) => { const r = fx.labelRects.find(b => sx >= b[0] && sx <= b[2] && sy >= b[1] && sy <= b[3]); return r ? r[4] : null; };
  function drawArea(v) {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(242,198,109,.95)'; ctx.fillStyle = 'rgba(242,198,109,.08)';
    ctx.beginPath();
    for (const r of fx.area) for (let i = 0; i < r.length; i += 2) { const x = v.ox + r[i] * v.k, y = v.oy + r[i + 1] * v.k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill('evenodd'); ctx.stroke(); ctx.restore();
  }
  fx.draw = (t, v) => {
    fx.landmarkRects = []; fx.labelRects = [];
    if (canvas.clientWidth !== cw || canvas.clientHeight !== ch) resize();
    if (!cw || !ch || !v || !Number.isFinite(v.k) || !(v.k > 0) || !Number.isFinite(v.ox) || !Number.isFinite(v.oy) || !Number.isFinite(v.z)) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (fx.under) fx.under(ctx, v, t); // the datová mapa: under everything that moves
    drawNight(v);
    drawTraffic(t, v);
    drawSmoke(t, v);
    if (fx.area) drawArea(v);
    if (fx.selected) for (const q of fx.pieces(fx.selected)) outline(q, v, 'rgba(201,88,59,1)', 2);
    if (fx.hover && fx.hover !== fx.selected && !(fx.selected && fx.hover[12] !== undefined && fx.hover[12] === fx.selected[12])) for (const q of fx.pieces(fx.hover)) outline(q, v, 'rgba(242,198,109,1)', 2);
    if (fx.extra) fx.extra(ctx, v, t);
    drawClouds(t, v);
    drawWeather(t);
    if (v.z < 0.5) drawLabels(v); // names of city districts and quarters, only zoomed out
    if (state.layers.names) drawLandmarks(v); // the five landmarks too: under "Názvy zajímavých míst"
    if (state.layers.names) drawWikiMarks(v); else { fx.wikiRects = []; } // names of places: only when switched on
    drawStreetNames(v);
    if (fx.top) fx.top(ctx, v, t); // clickable icons (cameras, air stations) above labels and buildings
    placePins(v);
  };
  void season;
  return fx;
}
