// Vehicle sprites drawn on the map in real-world size (metres -> screen pixels), as small
// boxes in the same isometric look as the buildings: side, roof and a few details.
export const CAR_COLORS = ['#c9583b', '#eef1e6', '#3b6fb6', '#2b2f38', '#9aa3ad', '#5c8f4a', '#d8b04a', '#7a3b2e', '#e6e6e6', '#4a5568'];
export const TRUCK_CABS = ['#eef1e6', '#3b6fb6', '#c9583b', '#2b2f38', '#d8b04a'];
export const SIZE = { car: [4.5, 1.9, 1.5], van: [5.6, 2.0, 2.3], truck: [12, 2.5, 3.6] }; // length, width, height in metres
export const VAN_COLORS = ['#eef1e6', '#e6e6e6', '#d9dcdf', '#3b6fb6', '#c9583b', '#f2c66d'];
// which vehicle: lorries only on motorways and the big roads outside the centre (VMO, D1, D2),
// in town only cars and delivery vans
export function pickKind(r, roadClass, distFromCentreM) {
  const truckOk = roadClass >= 3 && distFromCentreM > 2500;
  if (truckOk && r < 0.22) return 'truck';
  if (r < (truckOk ? 0.34 : 0.15)) return 'van';
  return 'car';
}
const VIS = 1.25; // a touch larger than life so they read on the pixel map

// one car or truck; (x, y) screen position of its centre on the road, (ux, uy) unit direction on screen
export function drawCar(ctx, x, y, ux, uy, kind, color, k, cab) {
  const [L, Wd, H] = SIZE[kind];
  const s = k * VIS;
  const hl = Math.max(2, (L * s) / 2), hw = Math.max(1, (Wd * s) / 2), h = Math.max(1, H * s * 0.6);
  // (ux, uy) is the direction on screen; on the ground (screen y is squashed to half) it is (ux, 2uy).
  // Length along the ground direction and width across it, both squashed back onto the screen,
  // so the vehicle always points along the road instead of looking skewed (drifting sideways).
  const gn = Math.hypot(ux, 2 * uy) || 1;
  const px = (-2 * uy) / gn, py = ux / (2 * gn);
  ux /= gn; uy /= gn;
  const quad = (ox, oy, a, b, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x + ox + ux * a + px * b, y + oy + uy * a + py * b);
    ctx.lineTo(x + ox + ux * a - px * b, y + oy + uy * a - py * b);
    ctx.lineTo(x + ox - ux * a - px * b, y + oy - uy * a - py * b);
    ctx.lineTo(x + ox - ux * a + px * b, y + oy - uy * a + py * b);
    ctx.fill();
  };
  quad(1, 1, hl, hw * 1.1, 'rgba(0,0,0,.28)'); // shadow
  if (kind === 'truck') {
    // box + cab
    quad(0, 0, hl, hw, '#5b5f66');
    quad(0, -h, hl, hw, '#d9dcdf');
    const cx = x + ux * hl * 0.78, cy = y + uy * hl * 0.78 - h * 0.6;
    ctx.fillStyle = cab || '#3b6fb6';
    ctx.fillRect(Math.round(cx - hw * 0.9), Math.round(cy - h * 0.4), Math.max(2, Math.round(hw * 1.8)), Math.max(2, Math.round(h * 0.9)));
  } else if (kind === 'van') {
    // delivery van: a tall box, windscreen at the front
    quad(0, 0, hl, hw, shade(color, 0.72));
    quad(0, -h, hl, hw * 0.95, color);
    if (hl > 3) quad(ux * hl * 0.7, uy * hl * 0.7 - h - 0.5, hl * 0.18, hw * 0.75, 'rgba(40,52,74,.8)');
  } else {
    quad(0, 0, hl, hw, shade(color, 0.7));
    quad(0, -h, hl * 0.95, hw * 0.92, color);
    if (hl > 3) quad(0, -h - 0.5, hl * 0.4, hw * 0.75, 'rgba(40,52,74,.75)'); // windows / roof glass
  }
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Length of one car by its DPMB fleet number (number series of the vehicle types; approximate):
// trams 15xx–16xx Tatra T3 (14 m, usually two coupled), 12xx T6A5 (14.6 m), 10xx VarioLF (15 m),
// 11xx K3R-N / VarioLF2 (20 m), 17xx KT8D5 / 45T (30 m), 18xx 03T / EVO2 (26 m), 19xx Škoda 13T (31 m);
// trolleybuses 36xx articulated (18 m), others solo (12 m); buses 2xxx articulated (18 m), 75xx midi (10 m), others 12 m.
export function unitLength(type, id) {
  if (type === 'tram') {
    const s = Math.floor(id / 100);
    return s === 15 || s === 16 ? 14 : s === 12 ? 14.6 : s === 10 ? 15 : s === 11 ? 20 : s === 17 ? 30 : s === 18 ? 26 : s === 19 ? 31 : 25;
  }
  if (type === 'trol') return Math.floor(id / 100) === 36 ? 18 : 12;
  if (id >= 2000 && id < 2900) return 18;
  if (id >= 7500 && id < 7600) return 10;
  return 12;
}
// a whole set as live data report it: the car itself plus coupled cars (IDB, IDC)
export function setLength(type, ids) {
  const units = ids.filter(x => x > 0).map(id => unitLength(type, id));
  const total = units.reduce((a, b) => a + b, 0);
  // where the cars meet (fractions of the length from the front) and articulations inside long single cars
  const joints = [];
  let acc = 0;
  for (let i = 0; i < units.length; i++) {
    const L = units[i];
    if (L >= 26) joints.push([(acc + L / 3) / total, 0], [(acc + (2 * L) / 3) / total, 0]); // three-section tram
    else if (L >= 18) joints.push([(acc + L * 0.55) / total, 0]); // articulated bus / trolleybus / tram
    acc += L;
    if (i < units.length - 1) joints.push([acc / total, 1]); // coupling between two cars
  }
  return { len: total, joints };
}

// a public transport vehicle following its route: pts = sampled centre points along the
// vehicle from front to back (screen px); type = tram | trol | bus
const LIVERY = {
  tram: { body: '#c8202a', side: '#c8202a', band: '#b9b6ae', roof: '#f1e9d2', cream: '#f1e9d2' }, // Brno trams (DPMB): red body, cream upper part and roof
  trol: { body: '#2f8f3a', side: '#1d5e26', band: '#efe6cf', roof: '#e2e2dc' },
  bus: { body: '#efe6cf', side: '#b9b2a2', band: '#2f6fb7', roof: '#f4f1ea' },
};
// Shapes of the ends (metres): Brno trams (Škoda 13T, EVO2, VarioLF, Tatra T3) have a rounded nose that narrows
// toward the front with a big windscreen wrapping round the corners, and a rounded back; trolleybuses and buses
// (Škoda 26Tr / 27Tr / 31Tr, Solaris, SOR) are boxier, with rounded corners and a dark windscreen.
const ENDS = {
  tram: { front: 2.1, ft: 0.42, back: 1.3, bt: 0.68, glass: 0.95 },
  trol: { front: 0.9, ft: 0.82, back: 0.7, bt: 0.86, glass: 0.6 },
  bus: { front: 0.9, ft: 0.82, back: 0.7, bt: 0.86, glass: 0.6 },
};
// one end of the body: from the cut end (x, y) forward along (ux, uy) by len, narrowing to taper × w, rounded
function endShape(ctx, x, y, ux, uy, w, len, taper, dy, color) {
  const px = -uy, py = ux, hw = w / 2, tw = (w * taper) / 2;
  const tx = x + ux * len, ty = y + uy * len + dy;
  y += dy;
  ctx.beginPath();
  ctx.moveTo(x + px * hw, y + py * hw);
  ctx.quadraticCurveTo(x + ux * len * 0.75 + px * hw, y + uy * len * 0.75 + py * hw, tx + px * tw, ty + py * tw);
  ctx.quadraticCurveTo(tx + ux * len * 0.12, ty + uy * len * 0.12, tx - px * tw, ty - py * tw);
  ctx.quadraticCurveTo(x + ux * len * 0.75 - px * hw, y + uy * len * 0.75 - py * hw, x - px * hw, y - py * hw);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}
// hidden: the vehicle is behind a building (seen at an angle) — only its line badge is drawn;
// vis: for each piece between two body points, whether it is visible (pieces behind buildings are left out)
export function drawTransit(ctx, pts, type, k, line, labels, delay = null, joints = null, hidden = false, vis = null, minScale = 1) {
  const c = LIVERY[type];
  // zoomed out the real size would be a speck: at least 4 x 3 px, so a tram still reads as a small block
  // (minScale: on phones the least size is half again as big, so a finger can hit it)
  const W = Math.max(4 * minScale, 2.6 * k * VIS), H = Math.max(3 * minScale, 3.2 * k * VIS * 0.6);
  const segOn = j => !vis || vis[Math.max(0, Math.min(vis.length - 1, j))] !== false;
  const E = ENDS[type] || ENDS.bus;
  const nn0 = pts.length / 2;
  const ends = [];
  if (nn0 >= 2) {
    pts = pts.slice();
    // front (pts[0]) and back (last point): move the end inward by the end's length (at most 90 % of that piece)
    for (const [i, j, L, taper, front] of [[0, 1, E.front, E.ft, true], [nn0 - 1, nn0 - 2, E.back, E.bt, false]]) {
      const ex = pts[2 * i], ey = pts[2 * i + 1], dx = ex - pts[2 * j], dy = ey - pts[2 * j + 1], seg = Math.hypot(dx, dy) || 1;
      const len = Math.min(L * k * VIS, seg * 0.9);
      const ux = dx / seg, uy = dy / seg;
      pts[2 * i] = ex - ux * len; pts[2 * i + 1] = ey - uy * len;
      ends.push({ x: pts[2 * i], y: pts[2 * i + 1], ux, uy, len, taper, front, on: segOn(front ? 0 : nn0 - 2) });
    }
  }
  // draw one layer of the body's ends (same offset and width as the body strokes)
  const caps = (w, dy, color, lenF = 1, taperF = 1) => { for (const e of ends) if (e.on && e.len > 0.5) endShape(ctx, e.x, e.y, e.ux, e.uy, w, e.len * lenF, Math.min(1, e.taper * taperF), dy, color); };
  // the body line, broken where a piece is hidden behind a building
  const path = (dy) => { ctx.beginPath(); for (let i = 0; i < pts.length; i += 2) { const x = pts[i], y = pts[i + 1] + dy, j = i / 2; if (!i || !segOn(j - 1)) ctx.moveTo(x, y); else ctx.lineTo(x, y); } };
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const n = pts.length / 2;
  if (vis && vis.every(x => x === false)) hidden = true;
  if (!hidden) {
  // shadow, side, roof
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = W + 1; path(1.5); ctx.stroke();
  caps(W + 1, 1.5, 'rgba(0,0,0,.3)');
  ctx.strokeStyle = '#1b2333'; ctx.lineWidth = W + H + 1.5; path(-H / 2); ctx.stroke();
  for (const e of ends) if (e.on && e.len > 0.5) endShape(ctx, e.x, e.y, e.ux, e.uy, W + H + 1.5, e.len + 0.75, e.taper, -H / 2, '#1b2333');
  ctx.strokeStyle = c.side; ctx.lineWidth = W + H; path(-H / 2); ctx.stroke();
  caps(W + H, -H / 2, c.side);
  // windscreen: dark glass over the nose (trams: wrapping round the rounded front), a smaller window at the back
  for (const e of ends) {
    if (!e.on || e.len <= 0.5) continue;
    const g = e.front ? E.glass : 0.45;
    const gx = e.x + e.ux * e.len * (1 - g), gy = e.y + e.uy * e.len * (1 - g);
    endShape(ctx, gx, gy, e.ux, e.uy, (W + H) * (e.front ? 0.92 : 0.7) * (1 - (1 - e.taper) * (1 - g)), e.len * g * 0.92, e.taper, -H * 0.62, 'rgba(24,32,48,.97)');
    if (e.front && H >= 2.5) endShape(ctx, gx, gy, e.ux, e.uy, (W + H) * 0.35, e.len * g * 0.6, 0.6, -H * 0.8, 'rgba(150,175,205,.55)'); // reflection
    // lights: white at the front, red at the back (just above the bottom of the nose)
    const lx = e.x + e.ux * e.len * 0.85, ly = e.y + e.uy * e.len * 0.85 - H * 0.05;
    const s2 = Math.max(1, Math.round(0.35 * k * VIS));
    ctx.fillStyle = e.front ? '#fff6d8' : '#e0302a';
    for (const sgn of [-1, 1]) ctx.fillRect(Math.round(lx - e.uy * sgn * (W + H) * e.taper * 0.32 - s2 / 2), Math.round(ly + e.ux * sgn * (W + H) * e.taper * 0.32 - s2 / 2), s2, s2);
  }
  // trams: cream upper part around the windows (Brno red-and-cream livery)
  if (c.cream) { ctx.strokeStyle = c.cream; ctx.lineWidth = Math.max(1, H * 0.6); path(-H * 0.55); ctx.stroke(); }
  // window strip along the side
  if (H >= 2.5) { ctx.strokeStyle = 'rgba(40,52,74,.9)'; ctx.lineWidth = Math.max(1, H * 0.35); ctx.setLineDash([Math.max(2, 1.4 * k * VIS), Math.max(1, 0.5 * k * VIS)]); path(-H * 0.45); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = c.roof; ctx.lineWidth = W; path(-H); ctx.stroke();
  // the roof ends behind the raked windscreen (at the front well before the nose, so the glass shows)
  for (const e of ends) if (e.on && e.len > 0.5) endShape(ctx, e.x, e.y, e.ux, e.uy, W, e.len * (e.front ? (type === 'tram' ? 0.3 : 0.35) : 0.7), Math.min(1, e.taper * 1.1), -H, c.roof);
  ctx.strokeStyle = c.band; ctx.lineWidth = Math.max(1, W * 0.28); path(-H); ctx.stroke();
  // articulations (thin dark line) and couplings between two cars (a wider gap); default: three-section tram
  const js = joints || (type === 'tram' ? [[1 / 3, 0], [2 / 3, 0]] : []);
  if (n >= 3) for (const [f, kind] of js) {
    const t = (n - 1) * f, i = Math.min(n - 2, Math.floor(t)), u = t - i;
    if (!segOn(i)) continue;
    const x = pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * u, y = pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * u;
    const g = kind ? Math.max(2, Math.round(0.9 * k * VIS)) : Math.max(1, Math.round(0.4 * k * VIS));
    ctx.fillStyle = kind ? '#1b2333' : 'rgba(27,35,51,.85)';
    ctx.fillRect(Math.round(x - g / 2), Math.round(y - H - W / 2), g, Math.round(W + H));
  }
  if (type === 'tram' && n >= 4) {
    // pantograph in the first quarter of the tram (seen in the direction of travel), as on most Brno trams
    const tq = (n - 1) * 0.2, m = Math.min(n - 2, Math.max(1, Math.floor(tq))), uq = tq - Math.floor(tq);
    const qi = Math.floor(tq), x = pts[2 * qi] + (pts[2 * qi + 2] - pts[2 * qi]) * uq, y = pts[2 * qi + 1] + (pts[2 * qi + 3] - pts[2 * qi + 1]) * uq - H;
    // a diamond-shaped pantograph (the classic tram sign): standing on the roof, the contact bar on top
    if (k > 0.5 && segOn(m - 1) && segOn(m)) {
      const hw = Math.max(2, W * 0.45), hh = Math.max(4, W * 1.5), bar = Math.max(3, W * 0.6);
      const lw = Math.max(1, Math.round(k * 0.35));
      const dia = () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - hw, y - hh / 2); ctx.lineTo(x, y - hh); ctx.lineTo(x + hw, y - hh / 2); ctx.closePath(); };
      ctx.lineJoin = 'miter';
      dia(); ctx.strokeStyle = 'rgba(27,35,51,.55)'; ctx.lineWidth = lw + 1.5; ctx.stroke();
      dia(); ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = lw; ctx.stroke();
      ctx.fillStyle = '#1b2333'; ctx.fillRect(Math.round(x - bar), Math.round(y - hh) - lw, Math.round(2 * bar), lw + 1); // contact strip
      ctx.lineJoin = 'round';
    }
  }
  if (type === 'trol' && n >= 2) {
    // two current collector poles: mounted on the roof in the front part, trailing back and up to the wires
    const i = Math.round((n - 1) * 0.3);
    const x = pts[2 * i], y = pts[2 * i + 1] - H;
    const bx = pts[2 * (n - 1)], by = pts[2 * (n - 1) + 1] - H;
    const dx = bx - x, dy = by - y, L = Math.hypot(dx, dy) || 1;
    ctx.strokeStyle = '#2b2f38'; ctx.lineWidth = 1;
    if (segOn(i) && segOn(i - 1)) for (const o of [-W * 0.25, W * 0.25]) { ctx.beginPath(); ctx.moveTo(x + o, y); ctx.lineTo(x + o + (dx / L) * W * 2.2, y + (dy / L) * W * 2.2 - W * 1.4); ctx.stroke(); }
  }
  if (type === 'bus' && n >= 2 && k > 0.5) {
    const m = Math.floor(n / 2);
    if (segOn(m)) ctx.fillStyle = '#9aa3ad'; if (segOn(m)) ctx.fillRect(pts[2 * m] - W * 0.3, pts[2 * m + 1] - H - W * 0.45, W * 0.6, W * 0.3); // roof air conditioning
  }
  }
  if (labels) {
    // line number badge above the vehicle
    const x = pts[0], y = pts[1] - H - W - 6;
    ctx.font = '400 15px "VT323", monospace';
    const tw = ctx.measureText(line).width + 6;
    const bx = Math.round(x - tw / 2), by = Math.round(y - 15);
    ctx.fillStyle = '#1b2333'; ctx.fillRect(bx - 1, by - 1, Math.round(tw) + 2, 16);
    ctx.fillStyle = type === 'tram' ? '#c8202a' : type === 'trol' ? '#2f8f3a' : '#2f6fb7';
    ctx.fillRect(bx, by, Math.round(tw), 14);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(line, Math.round(x), Math.round(y - 3));
    if (delay !== null && delay !== undefined) delayGauge(ctx, bx + Math.round(tw) + 2, by - 1, delay);
  } else if (delay !== null && delay !== undefined) {
    // zoomed out: just a coloured dot above the vehicle
    const x = pts[0], y = pts[1] - H - W - 3;
    ctx.fillStyle = '#1b2333'; ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
    ctx.fillStyle = delayColor(delay); ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
  }
}

// how late a vehicle is: green on time (or early), yellow 1–2 min, orange 3–5 min, red 6 min and more
export function delayColor(d) {
  return d <= 0 ? '#5cc062' : d <= 2 ? '#f2c66d' : d <= 5 ? '#f08a3c' : '#d8342c';
}
// a small thermometer next to the line number: the taller and redder, the later the vehicle
function delayGauge(ctx, x, y, d) {
  const H = 16, fill = Math.max(2, Math.round((Math.min(10, Math.max(0, d)) / 10) * (H - 4)) + 2);
  ctx.fillStyle = '#1b2333'; ctx.fillRect(x, y, 7, H);
  ctx.fillStyle = '#3a4762'; ctx.fillRect(x + 1, y + 1, 5, H - 2);
  ctx.fillStyle = delayColor(d); ctx.fillRect(x + 1, y + H - 1 - fill, 5, fill);
  // the number of minutes beside it when late
  if (d >= 1) {
    const t = `+${Math.round(d)}`;
    ctx.font = '400 13px "VT323", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(27,35,51,.95)'; ctx.strokeText(t, x + 9, y + H - 3);
    ctx.fillStyle = delayColor(d); ctx.fillText(t, x + 9, y + H - 3);
  }
}
