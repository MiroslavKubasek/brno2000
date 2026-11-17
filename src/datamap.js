export const DATAMAPS = {
  hluk: {
    n: 'Hluk z dopravy',
    what: 'Celodenní hladina hluku Lden ze silnic, železnice a tramvají (strategická hluková mapa 2022). Budova má barvu nejhlučnějšího místa svého půdorysu.',
    source: 'Statutární město Brno, data.brno.cz, CC BY',
    // one entry per band value in the data (1..8: 50–54 … 85–89 dB), grouped into the classes of the legend
    classes: [
      { n: '50–54 dB', c: '#f7f0b4', v: [1] },
      { n: '55–59 dB', c: '#f2e68a', v: [2] },
      { n: '60–64 dB', c: '#f2b24d', v: [3] },
      { n: '65–69 dB', c: '#e8743b', v: [4] },
      { n: '70–74 dB', c: '#c8202a', v: [5] },
      { n: '75 dB a více', c: '#7a0f3a', v: [6, 7, 8] },
    ],
    label: v => (v >= 8 ? 'Lden 85 dB a více' : `Lden ${45 + 5 * v}–${49 + 5 * v} dB`),
    ground: true, // the raster is also drawn between the buildings when zoomed in
  },
  povoden: {
    n: 'Povodeň',
    what: 'Kam sahá pětiletá, dvacetiletá a stoletá voda Svratky, Svitavy a dalších toků podle stanovených záplavových území, a aktivní zóna, kde se nesmí stavět. Budova má barvu nejhorší vody, která dosáhne na její půdorys.',
    source: 'Statutární město Brno a Povodí Moravy, data.brno.cz, CC BY',
    classes: [
      { n: 'aktivní zóna', c: '#1f4e9c', v: [4] },
      { n: 'pětiletá voda (Q5)', c: '#3b7fd1', v: [3] },
      { n: 'dvacetiletá voda (Q20)', c: '#5fa8e6', v: [2] },
      { n: 'stoletá voda (Q100)', c: '#a6d2f2', v: [1] },
    ],
    label: v => ['', 'Stoletá voda (Q100)', 'Dvacetiletá voda (Q20)', 'Pětiletá voda (Q5)', 'Aktivní zóna záplavového území'][v] || '',
    ground: true,
  },
  hustota: {
    n: 'Hustota obyvatel',
    what: 'Obyvatelé s obvyklým pobytem podle sčítání 2021 na hektar základní sídelní jednotky (celé její plochy, i s ulicemi a parky). Všechny budovy jednotky mají její barvu; jednotky, kde nikdo nebydlí, zůstávají šedé.',
    source: 'Český statistický úřad (otevřená data sčítání 2021), hranice jednotek Statutární město Brno, CC BY',
    classes: [
      { n: 'do 10 obyvatel na hektar', c: '#f7e7a0', v: [1] },
      { n: '10–30', c: '#cfdc8a', v: [2] },
      { n: '30–60', c: '#8ec5a0', v: [3] },
      { n: '60–120', c: '#4fa3a0', v: [4] },
      { n: '120–200', c: '#2c6b9e', v: [5] },
      { n: 'nad 200', c: '#1e2f6b', v: [6] },
    ],
    label: v => ['', 'Do 10 obyvatel na hektar', '10–30 obyvatel na hektar', '30–60 obyvatel na hektar', '60–120 obyvatel na hektar', '120–200 obyvatel na hektar', 'Přes 200 obyvatel na hektar'][v] || '',
    ground: true,
  },
  vyuziti: {
    n: 'Co je v domě',
    what: 'Typ domu podle průzkumu budov 2018 až 2020, který zná využití každého podlaží: kde se jen bydlí, kde se bydlí nad obchodem nebo kanceláří, a co je v domech bez bytů. Domy, které průzkum nezná, zůstávají šedé.',
    source: 'Kancelář architekta města Brna, data.brno.cz, CC BY',
    classes: [
      { n: 'čistě bydlení', c: '#e9b84a', v: [1] },
      { n: 'bydlení nad obchodem či kanceláří', c: '#e8743b', v: [2] },
      { n: 'obchody, služby, hospody, hotely', c: '#d8342c', v: [3] },
      { n: 'kanceláře a veřejné budovy', c: '#3b6fb6', v: [4] },
      { n: 'výroba, sklady, technika', c: '#20a4a0', v: [5] },
      { n: 'garáže, chaty, zahradní domky', c: '#8cc063', v: [6] },
      { n: 'prázdné, bez využití', c: '#1b1f2a', v: [7] },
    ],
    label: v => ['', 'Čistě bydlení', 'Bydlení v patrech, dole obchod, hospoda nebo kancelář', 'Obchody, služby, hospody, hotely (bez bytů)', 'Kanceláře, úřady a veřejné budovy (školství, zdravotnictví, kultura, sport)', 'Výroba, sklady, technika', 'Garáž, chata nebo zahradní domek', 'Prázdné, bez využití'][v] || '',
    ground: false, // the roofs only; the raster stands in for them when zoomed out
  },
};
const CELL = 16;
const ROOF_ALPHA = 0.72, GROUND_ALPHA = 0.33, FAR_ALPHA = 0.82;
const Z_NEAR = 0.5, Z_FAR = 0.8; // between them the raster fades to the ground tint and the roofs appear

export function createDatamap({ base, rotation, GEO, chunk, CH, canvasSize }) {
  let key = null, def = null, lit = []; // lit: which classes of the legend are shown (one per class, at least one true)
  let img = null, raster = null, cls = null, loadTicket = 0; // img: the ground raster as loaded; raster: recoloured; cls: bands per chunk
  let values = null, rw = 0, rh = 0; // the band value per cell, for the label under the cursor
  const cache = document.createElement('canvas'); // the roofs of the current view (drawn only when the view changes)
  let cacheKey = '';
  const dm = { listeners: [] };

  const hex = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const classOf = v => (def ? def.classes.findIndex(c => c.v.includes(v)) : -1);
  const lut = () => { const t = new Int8Array(16).fill(-1); def.classes.forEach((c, i) => c.v.forEach(v => (t[v] = i))); return t; };

  // the ground raster recoloured with the palette (a faint grey for the classes that are not lit)
  function recolour() {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data, t = lut();
    const rgb = def.classes.map(k => { const n = parseInt(k.c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    values = new Uint8Array(c.width * c.height); rw = c.width; rh = c.height;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = d[i]; values[p] = v;
      const k = v ? t[v] : -1;
      if (k < 0) { d[i + 3] = 0; continue; }
      if (!lit[k]) { d[i] = 110; d[i + 1] = 116; d[i + 2] = 128; d[i + 3] = 70; continue; }
      d[i] = rgb[k][0]; d[i + 1] = rgb[k][1]; d[i + 2] = rgb[k][2]; d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  dm.set = k => {
    key = DATAMAPS[k] ? k : null; def = key ? DATAMAPS[key] : null; lit = def ? def.classes.map(() => true) : [];
    img = null; raster = null; cls = null; values = null; cacheKey = '';
    const ticket = ++loadTicket;
    if (!key) { dm.changed(); return; }
    const im = new Image();
    im.onload = () => { if (ticket === loadTicket) { img = im; raster = recolour(); dm.changed(); } };
    im.onerror = () => { if (ticket === loadTicket) console.warn(`data/r${rotation()}/dm/${key}.png: missing`); };
    im.src = `${base}data/r${rotation()}/dm/${key}.png`;
    fetch(`${base}data/r${rotation()}/dm/${key}.json`).then(r => (r.ok ? r.json() : null)).then(d => { if (ticket === loadTicket && d) { cls = d.cls; dm.updated = d.updated; cacheKey = ''; dm.changed(); } }).catch(() => {});
    dm.changed();
  };
  dm.key = () => key;
  dm.def = () => def;
  // the classes shown: switch one on or off (the last lit one stays), one alone, or all of them
  const relight = () => { cacheKey = ''; if (img) raster = recolour(); dm.changed(); };
  dm.lit = () => lit.slice();
  dm.toggle = i => { if (lit[i] && lit.filter(Boolean).length < 2) return false; lit[i] = !lit[i]; relight(); return true; };
  dm.solo = i => { lit = lit.map((_, j) => j === i); relight(); };
  dm.all = () => { lit = lit.map(() => true); relight(); };
  dm.onChange = f => dm.listeners.push(f);
  dm.changed = () => dm.listeners.forEach(f => f());

  // the band of an image point (from the raster) or of a building (b = entry of a chunk, i = its index there)
  dm.valueAt = (X, Y) => { if (!values) return 0; const cx = (X / CELL) | 0, cy = (Y / CELL) | 0; return cx < 0 || cy < 0 || cx >= rw || cy >= rh ? 0 : values[cy * rw + cx]; };
  dm.valueOf = (ckey, i) => (cls && cls[ckey] ? cls[ckey][i] || 0 : 0);
  dm.text = v => (def && v ? def.label(v) : '');
  dm.classOf = classOf;

  function roofs(ctx, v, cw, ch) {
    if (!cls) return;
    const x0 = Math.floor(-v.ox / v.k / CH) - 1, x1 = Math.floor((cw - v.ox) / v.k / CH) + 1;
    const y0 = Math.floor(-v.oy / v.k / CH) - 1, y1 = Math.floor((ch - v.oy) / v.k / CH) + 1;
    const colours = def.classes.map((k, i) => (!lit[i] ? ['rgba(110,116,128,0.35)', 'rgba(70,76,90,0.6)'] : [hex(k.c, ROOF_ALPHA), hex(k.c, 0.95)]));
    const t = lut();
    ctx.lineWidth = 1;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const ck = `${cx}_${cy}`, list = chunk(cx, cy), bands = cls[ck];
      if (!list || !bands) continue;
      for (let i = 0; i < list.length; i++) {
        const k = bands[i] ? t[bands[i]] : -1;
        if (k < 0) continue;
        const p = list[i][0];
        const px0 = v.ox + p[0] * v.k, py0 = v.oy + p[1] * v.k;
        if (px0 < -400 || py0 < -400 || px0 > cw + 400 || py0 > ch + 400) continue;
        ctx.beginPath();
        for (let j = 0; j < p.length; j += 2) { const sx = v.ox + p[j] * v.k, sy = v.oy + p[j + 1] * v.k; j ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
        ctx.closePath();
        ctx.fillStyle = colours[k][0]; ctx.fill();
        ctx.strokeStyle = colours[k][1]; ctx.stroke();
      }
    }
  }

  // drawn under the traffic and the people (fx.under)
  dm.draw = (ctx, v) => {
    if (!key) return;
    const { cw, ch, dpr } = canvasSize();
    const near = Math.max(0, Math.min(1, (v.z - Z_NEAR) / (Z_FAR - Z_NEAR))); // 0 zoomed out … 1 zoomed in
    if (raster) {
      const a = FAR_ALPHA + (def.ground ? (GROUND_ALPHA - FAR_ALPHA) * near : -FAR_ALPHA * near);
      if (a > 0.01) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = a;
        ctx.drawImage(raster, v.ox, v.oy, raster.width * CELL * v.k, raster.height * CELL * v.k);
        ctx.restore();
      }
    }
    if (near <= 0 || !cls) return;
    // the roofs: thousands of polygons, so they are drawn into a cache and redrawn only when the view changes
    let loaded = 0;
    const x0 = Math.floor(-v.ox / v.k / CH) - 1, x1 = Math.floor((cw - v.ox) / v.k / CH) + 1, y0 = Math.floor(-v.oy / v.k / CH) - 1, y1 = Math.floor((ch - v.oy) / v.k / CH) + 1;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) if (chunk(cx, cy)) loaded++;
    const k = `${key}|${lit.map(Number).join('')}|${v.ox.toFixed(1)}|${v.oy.toFixed(1)}|${v.k}|${cw}x${ch}@${dpr}|${loaded}`;
    if (k !== cacheKey) {
      cacheKey = k;
      if (cache.width !== Math.round(cw * dpr) || cache.height !== Math.round(ch * dpr)) { cache.width = Math.round(cw * dpr); cache.height = Math.round(ch * dpr); }
      const g = cache.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);
      roofs(g, v, cw, ch);
    }
    ctx.save();
    ctx.globalAlpha = near;
    ctx.drawImage(cache, 0, 0, cw, ch);
    ctx.restore();
  };

  // ---- for the cards: the bands of a building in every map (the files load when first asked for)
  const clsFiles = new Map();
  const loadCls = k => { if (!clsFiles.has(k)) clsFiles.set(k, fetch(`${base}data/r${rotation()}/dm/${k}.json`).then(r => (r.ok ? r.json() : null)).then(d => (d ? d.cls : null)).catch(() => null)); return clsFiles.get(k); };
  // rows [name of the map, text] for the building i of the chunk ckey, one per map that knows it
  dm.describe = async (ckey, i) => {
    const rows = [];
    for (const [k, d] of Object.entries(DATAMAPS)) {
      const c = await loadCls(k);
      const v = c && c[ckey] ? c[ckey][i] || 0 : 0;
      const t = v ? d.label(v) : k === 'hluk' ? 'pod 50 dB' : k === 'povoden' ? 'mimo záplavové území' : '';
      if (t) rows.push([d.n, t]);
    }
    return rows;
  };
  // the quarters (cadastral units) with their statistics: the one around an image point
  let areasP = null;
  const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c; } return c; };
  dm.areaAt = async (X, Y) => {
    if (!areasP) areasP = fetch(`${base}data/r${rotation()}/dm/areas.json`).then(r => (r.ok ? r.json() : null)).then(d => (d ? d.areas : [])).catch(() => []);
    const areas = await areasP;
    return areas.find(a => X >= a.bb[0] && X <= a.bb[2] && Y >= a.bb[1] && Y <= a.bb[3] && a.rings.reduce((c, r) => c ^ inRing(r, X, Y), 0)) || null;
  };
  return dm;
}
