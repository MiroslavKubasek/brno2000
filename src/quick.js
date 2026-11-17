// Rychlé přepínače skupin vrstev: one tile per theme (Stavby, MHD, Doprava, Akce, Zajímavosti, Měření) at the
// right edge of the map (on phones a row above the tiles at the bottom). Each tile has level dots: a click turns
// the next level on (every level adds to the one before), the click after the last level turns the group off;
// holding the tile (or a right click) turns it off at once; from off the next click starts again at one dot.
// The detailed switches in Vrstvy stay the truth: the tiles read their level from state.layers and write to it
// through setLayer, so both always agree. A combination that is no level (ticked by hand) shows as "vlastní".

// ------------------------------------------------------------------ pixel icons, 12 × 12, # = a lit pixel
const PX = {
  crane: ['..##########', '..##.#.#.#.#', '####.......#', '####.......#', '..##.....###', '..##.....#.#', '..##.....###', '..##........', '..##........', '..##........', '..##........', '.######.....'],
  tram: ['.....##.....', '..########..', '.##########.', '.##......##.', '.##......##.', '.##......##.', '.##########.', '.#.######.#.', '.##########.', '..########..', '...##..##...', '...##..##...'],
  cone: ['.....##.....', '.....##.....', '....####....', '....####....', '....#..#....', '...######...', '...######...', '...#....#...', '..########..', '..########..', '.##########.', '############'],
  ticket: ['............', '............', '.####..####.', '#....##....#', '#..#.......#', '#..........#', '#..#.......#', '#..........#', '#..#.......#', '#....##....#', '.####..####.', '............'],
  bust: ['....####....', '...######...', '...######...', '....####....', '.....##.....', '..########..', '.##########.', '.##########.', '............', '...######...', '...######...', '.##########.'],
  thermo: ['....####....', '....#..#....', '....#..#....', '....#..#....', '....####....', '....####....', '....####....', '...######...', '..########..', '..########..', '...######...', '....####....'],
  camera: ['............', '...###......', '############', '############', '####....####', '###......###', '###..##..###', '###..##..###', '###......###', '####....####', '############', '############'],
  // the controls that were glyphs of the font until now, in the same raster
  flag: ['.##.........', '.####.......', '.#######....', '.#########..', '.#########..', '.#######....', '.####.......', '.##.........', '.##.........', '.##.........', '.##.........', '.##.........'],
  ring: ['....####....', '..##....##..', '.#........#.', '.#........#.', '#....##....#', '#...####...#', '#...####...#', '#....##....#', '.#........#.', '.#........#.', '..##....##..', '....####....'],
  sun: ['.....##.....', '.#........#.', '............', '....####....', '...######...', '##.######.##', '##.######.##', '...######...', '....####....', '............', '.#...##...#.', '.....##.....'],
  layers: ['.....##.....', '...######...', '.##########.', '...######...', '.....##.....', '.##......##.', '...##..##...', '.....##.....', '.##......##.', '...##..##...', '.....##.....', '............'],
  star: ['.....##.....', '.....##.....', '....####....', '....####....', '############', '.##########.', '..########..', '...######...', '...######...', '..###..###..', '.##......##.', '............'],
  more: ['............', '............', '............', '............', '............', '.##..##..##.', '.##..##..##.', '............', '............', '............', '............', '............'],
  share: ['.....##.....', '....####....', '...##..##...', '..##....##..', '.....##.....', '.....##.....', '.##..##..##.', '.#...##...#.', '.#........#.', '.#........#.', '.##########.', '............'],
  home: ['.....##.....', '....####....', '...######...', '..########..', '.##########.', '############', '..########..', '..###..###..', '..###..###..', '..###..###..', '..########..', '............'],
  plus: ['............', '............', '.....##.....', '.....##.....', '.....##.....', '..########..', '..########..', '.....##.....', '.....##.....', '.....##.....', '............', '............'],
  minus: ['............', '............', '............', '............', '............', '..########..', '..########..', '............', '............', '............', '............', '............'],
};
const pathCache = {};
function pxPath(name) {
  if (pathCache[name]) return pathCache[name];
  let d = '';
  (PX[name] || []).forEach((r, y) => { let x = 0; while (x < 12) { if (r[x] === '#') { const s = x; while (x < 12 && r[x] === '#') x++; d += `M${s} ${y}h${x - s}v1h-${x - s}z`; } else x++; } });
  return (pathCache[name] = d);
}
/** The SVG of a pixel icon (fills currentColor). */
export const pxIcon = (name, cls = 'ico px-ico') => `<svg class="${cls}" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="${pxPath(name)}"/></svg>`;
/** Elements with data-px="name" get the pixel icon instead of their text glyph. */
export function placePxIcons(root = document) {
  root.querySelectorAll('[data-px]').forEach(el => { if (!el.querySelector('svg')) el.innerHTML = pxIcon(el.dataset.px); });
}

// ------------------------------------------------------------------ the groups and their levels
// on: the switches (state.layers keys) this level adds; range: the events layer's time range instead
export const EVENT_RANGES = ['today', 'week', 'all'];
export const GROUPS = [
  { key: 'stavby', name: 'Stavby', icon: 'crane', def: 1, levels: [
    { n: 'aktuálně probíhající výstavba', on: ['building'] }, { n: 'plány města', on: ['planCity'] }, { n: 'soukromé plány', on: ['planPrivate'] }, { n: 'dopravní záměry', on: ['bigplans'] }] },
  { key: 'mhd', name: 'MHD', icon: 'tram', def: 1, levels: [
    { n: 'vozidla a zastávky', on: ['mhd', 'mhdStops'] }, { n: 'výluky', on: ['mhdOutages'] }] },
  { key: 'doprava', name: 'Doprava', icon: 'cone', def: 3, levels: [
    { n: 'kolony a nehody', on: ['jams'] }, { n: 'uzavírky', on: ['closures'] }, { n: 'výkopy a zábory', on: ['works'] }] },
  { key: 'akce', name: 'Akce', icon: 'ticket', def: 2, levels: [
    { n: 'akce dnes', on: ['events'], range: 'today' }, { n: 'tento týden', on: [], range: 'week' }, { n: 'všechny nadcházející', on: [], range: 'all' }] },
  { key: 'mista', name: 'Zajímavosti', short: 'Místa', icon: 'bust', def: 1, levels: [
    { n: 'sochy a stromy', on: ['smArt', 'smTree'] }, { n: 'památky a kříže', on: ['monuments', 'smCross'] }, { n: 'názvy míst', on: ['names'] }, { n: 'pamětní desky', on: ['smPlaque'] }] },
  { key: 'mereni', name: 'Měření', icon: 'thermo', def: 3, levels: [
    { n: 'ovzduší', on: ['air'] }, { n: 'meteostanice', on: ['meteo'] }, { n: 'webkamery', on: ['cams'] }] },
  // the street-level photos get in the way at times: one tile, one dot, hidden with one tap (only where the part "pano" is public)
  { key: 'foto', name: 'Fotky', icon: 'camera', def: 1, pub: 'pano', levels: [
    { n: 'fotky z ulice (Panoramax)', on: ['pano'] }] },
];

/**
 * @param state the page state (state.layers, state.eventsRange)
 * @param setLayer (key, on) → sets the layer and its switch in Vrstvy
 * @param setEventsRange (range) → the time range of the events layer
 * @param mount the element that takes the tiles
 */
export function createQuick({ state, setLayer, setEventsRange, mount, shown = () => true, onStep = null }) {
  const GROUPS_HERE = GROUPS.filter(g => !g.pub || shown(g.pub)); // (a part that is not public has no tile)
  const byKey = k => GROUPS_HERE.find(g => g.key === k);

  function levelOf(g) {
    if (g.key === 'akce') return state.layers.events ? EVENT_RANGES.indexOf(state.eventsRange) + 1 : 0;
    let L = 0;
    while (L < g.levels.length && g.levels[L].on.every(k => state.layers[k])) L++;
    return L;
  }
  // something of a higher level is on without the levels below it: a combination ticked by hand
  const customOf = (g, L) => g.key !== 'akce' && g.levels.slice(L).some(l => l.on.some(k => state.layers[k]));
  const shownText = (g, L) => g.levels.slice(0, L).map(l => l.n).join(', ');

  function apply(g, L) {
    if (g.key === 'akce') { if (L > 0) setEventsRange(EVENT_RANGES[L - 1]); setLayer('events', L > 0); }
    else g.levels.forEach((l, i) => l.on.forEach(k => setLayer(k, i < L)));
  }

  // the tiles
  const tiles = {};
  mount.classList.toggle('n7', GROUPS_HERE.length >= 7); // (seven tiles: the short names on phones)
  for (const g of GROUPS_HERE) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'qt'; b.dataset.g = g.key;
    b.innerHTML = `${pxIcon(g.icon)}<span class="dots">${g.levels.map(() => '<i></i>').join('')}</span><span class="l">${g.name}</span><span class="l s">${g.short || g.name}</span>`;
    mount.append(b); tiles[g.key] = b;
  }
  // the small copies in the headings of the Vrstvy sections (data-qg="key"), same dots, same click
  const minis = () => document.querySelectorAll('[data-qg]');
  minis().forEach(m => { const g = byKey(m.dataset.qg); if (g) m.innerHTML = `${pxIcon(g.icon)}<span class="dots">${g.levels.map(() => '<i></i>').join('')}</span>`; });

  function paint(el, g, L, custom) {
    el.setAttribute('aria-pressed', String(L > 0));
    el.classList.toggle('custom', custom);
    el.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < L));
    const n = g.levels.length;
    el.title = `${g.name}: ${L ? `${shownText(g, L)} (${L}/${n})` : 'vypnuto'}${custom ? ' · vlastní výběr ve Vrstvách' : ''}. Klepnutí: další úroveň (od vypnuto jedna tečka), podržení: vypnout.`;
    el.setAttribute('aria-label', `${g.name}, úroveň ${L} z ${n}`);
  }
  function render() {
    for (const g of GROUPS_HERE) {
      const L = levelOf(g), custom = customOf(g, L);
      paint(tiles[g.key], g, L, custom);
      minis().forEach(m => { if (m.dataset.qg === g.key) paint(m, g, L, custom); });
    }
  }

  // the message after a click: what happened, what the group shows now (three seconds beside the tile)
  let msgTimer = null;
  function message(g, prev, L) {
    const n = g.levels.length;
    let head, rest;
    if (L === 0) { head = 'vypnuto'; rest = `nic ze skupiny ${g.name}`; }
    else if (prev === 0 || L === 1) { head = `zapnuto: ${g.levels[0].n}`; rest = L === 1 ? `1/${n}` : `zobrazeno: ${shownText(g, L)} (${L}/${n})`; }
    else { head = `přidáno: ${g.levels[L - 1].n}`; rest = `zobrazeno: ${shownText(g, L)} (${L}/${n})`; }
    document.querySelectorAll('.qt-msg').forEach(m => m.remove());
    const m = document.createElement('span');
    m.className = 'qt-msg'; m.setAttribute('role', 'status');
    m.innerHTML = `<b>${g.name}</b>${head} <small>· ${rest}</small>`;
    // beside the tile, but a child of the column, not of the pressed button (a pressed button is transformed, which
    // would catch a fixed message inside it); on phones the stylesheet puts it in one line above the row
    const b = tiles[g.key];
    m.style.top = `${b.offsetTop + b.offsetHeight / 2}px`;
    mount.append(m);
    clearTimeout(msgTimer); msgTimer = setTimeout(() => m.remove(), 3000);
  }

  function step(key, off) {
    const g = byKey(key); if (!g) return;
    const prev = levelOf(g), custom = customOf(g, prev), n = g.levels.length;
    let L;
    if (off) L = 0;
    else if (prev === 0) L = 1; // from off always one dot, then one more with every click
    else if (custom) L = prev; // a hand-made combination: the first click brings it to the clean level it shows
    else L = prev + 1 > n ? 0 : prev + 1;
    apply(g, L);
    render();
    message(g, prev, L);
    if (onStep) onStep(g.key, L);
  }

  // click = next level (from off: one dot); holding (500 ms) or the right button = off
  let holdTimer = null, held = false;
  const onDown = e => { const b = e.target.closest('[data-g], [data-qg]'); if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return; held = false; clearTimeout(holdTimer); holdTimer = setTimeout(() => { held = true; step(b.dataset.g || b.dataset.qg, true); }, 500); };
  const onUp = () => clearTimeout(holdTimer);
  const onClick = e => { const b = e.target.closest('[data-g], [data-qg]'); if (!b) return; e.preventDefault(); e.stopPropagation(); if (held) { held = false; return; } step(b.dataset.g || b.dataset.qg, false); };
  const onMenu = e => { const b = e.target.closest('[data-g], [data-qg]'); if (!b) return; e.preventDefault(); step(b.dataset.g || b.dataset.qg, true); };
  for (const root of [mount, document.getElementById('pane-layers')].filter(Boolean)) {
    root.addEventListener('pointerdown', onDown); root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp); root.addEventListener('pointerleave', onUp, true);
    root.addEventListener('click', onClick); root.addEventListener('contextmenu', onMenu);
  }
  render();
  return { render, step, levelOf };
}
