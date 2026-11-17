export function createMhd({ base, rotation }) {
  let tt = null, geo = null, geoRot = -1, loading = null;
  // the stops (data/mhd-stops.json, ~100 KB): their signs on the map and the names of the live vehicles' stops
  // come from this small file at once; the timetable itself (mhd.json + mhd-geo.json, ~4 MB) only when needed:
  // the timetable mode, a stop or vehicle card, or (wantSnap) to put live vehicles onto their routes
  let st = null, stLoading = null;
  let active = [], activeAt = 0;
  let stopIdx = null, profTrips = null; // built on the first stop click

  async function ensure() {
    if (!tt) tt = await (await fetch(`${base}data/mhd.json`)).json();
    if (geoRot !== rotation()) {
      geoRot = rotation();
      geo = await (await fetch(`${base}data/r${geoRot}/mhd-geo.json`)).json();
      activeAt = 0;
    }
  }
  const load = () => (loading ||= ensure().finally(() => { loading = null; }));
  const loadStops = () => (stLoading ||= fetch(`${base}data/mhd-stops.json`).then(r => r.json()).then(d => { st = d; }).catch(() => { st = { stops: {}, stopNum: {} }; }));

  function pragueNow() {
    const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }); // 2026-11-04 08:41:12
    const [d, t] = s.split(' ');
    const [h, m, x] = t.split(':').map(Number);
    const date = +d.replace(/-/g, '');
    const wd = (new Date(`${d}T12:00:00`).getDay() + 6) % 7; // 0 = Monday
    return { date, wd, sec: h * 3600 + m * 60 + x };
  }
  function prevDay(date) {
    const y = Math.floor(date / 10000), mo = Math.floor(date / 100) % 100, d = date % 100;
    const t = new Date(Date.UTC(y, mo - 1, d) - 864e5);
    return { date: t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(), wd: (t.getUTCDay() + 6) % 7 };
  }
  const runs = (svc, date, wd) => {
    const [days, from, to, add, rem] = svc;
    if (add.includes(date)) return true;
    if (rem.includes(date)) return false;
    return days[wd] === '1' && date >= from && date <= to;
  };

  // which trips are on the road now (refreshed every few seconds)
  let svcToday = null, svcYday = null, svcDate = 0;
  function refreshActive() {
    const now = pragueNow();
    const y = prevDay(now.date);
    const today = tt.services.map(s => runs(s, now.date, now.wd));
    const yday = tt.services.map(s => runs(s, y.date, y.wd));
    svcToday = today; svcYday = yday; svcDate = now.date;
    active = [];
    const T = tt.trips;
    for (let i = 0; i < T.length; i += 4) {
      const p = tt.profiles[T[i]], s = T[i + 1], t0 = T[i + 2], hs = tt.names[T[i + 3]];
      const dur = p[3][p[3].length - 1];
      if (today[s] && now.sec >= t0 && now.sec <= t0 + dur) active.push([p, t0, hs, i]);
      else if (yday[s] && now.sec + 86400 >= t0 && now.sec + 86400 <= t0 + dur) active.push([p, t0 - 86400, hs, i]);
    }
    activeAt = performance.now();
  }

  // where a trip (profile p, start t0) is at second sec of the day: a vehicle object, or null off the map
  let lineTrips = null; // line -> indices into tt.trips (built on first use)
  function posAt(p, t0, hs, id, sec) {
    const [r, vi, ms, offs] = p;
    const dt = sec - t0;
    let i = 0;
    while (i < offs.length - 2 && offs[i + 1] <= dt) i++;
    const a = ms[i], b = ms[i + 1];
    if (a < 0 || b < 0) return null;
    const span = offs[i + 1] - offs[i];
    // dwell ~20 s at stops, then move
    const moveStart = offs[i] + Math.min(20, span * 0.25);
    const f = span <= 0 ? 1 : Math.max(0, Math.min(1, (dt - moveStart) / (offs[i + 1] - moveStart || 1)));
    const shape = vi >= 0 ? geo.v[vi] : geo.s[-vi - 1];
    if (!shape) return null;
    const pt = pointAt(shape, a + (b - a) * f);
    const back = b < a;
    const m = a + (b - a) * f;
    return { X: pt[0], Y: pt[1], dx: back ? -pt[2] : pt[2], dy: back ? -pt[3] : pt[3], type: tt.routes[r][1], line: tt.routes[r][0], shape, m, back, hs, id, t0, p, seg: i };
  }
  function pointAt(shape, m) {
    const [xy, cm] = shape;
    if (m <= cm[0]) return [xy[0], xy[1], xy[2] - xy[0], xy[3] - xy[1]];
    let lo = 0, hi = cm.length - 1;
    if (m >= cm[hi]) return [xy[2 * hi], xy[2 * hi + 1], xy[2 * hi] - xy[2 * hi - 2], xy[2 * hi + 1] - xy[2 * hi - 1]];
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (cm[md] <= m) lo = md; else hi = md; }
    const f = (m - cm[lo]) / (cm[hi] - cm[lo] || 1);
    const dx = xy[2 * hi] - xy[2 * lo], dy = xy[2 * hi + 1] - xy[2 * lo + 1];
    return [xy[2 * lo] + dx * f, xy[2 * lo + 1] + dy * f, dx, dy];
  }

  return {
    load,
    ready: () => !!tt && !!geo && geoRot === rotation(),
    // vehicles: [{ X, Y, dx, dy, type, line }]
    vehicles() {
      if (!tt || !geo || geoRot !== rotation()) { load(); return []; }
      if (performance.now() - activeAt > 5000) refreshActive();
      const sec = pragueNow().sec + (Date.now() % 1000) / 1000;
      const out = [];
      for (const [p, t0, hs, id] of active) { const v = posAt(p, t0, hs, id, sec); if (v) out.push(v); }
      return out;
    },
    // The trips of a line a live vehicle may be running, judged at the time of its timetable (planSec = now minus
    // its delay): the trips under way then, plus those about to start (20 min: a vehicle waiting at the terminus)
    // and those just finished (10 min). Each with its position at that time (held at the ends of the trip).
    candidates(line, planSec) {
      if (!tt || !geo || geoRot !== rotation()) { load(); return []; }
      if (performance.now() - activeAt > 5000 || !svcToday) refreshActive();
      if (!lineTrips) { lineTrips = new Map(); for (let i = 0; i < tt.trips.length; i += 4) { const l = tt.routes[tt.profiles[tt.trips[i]][0]][0]; if (!lineTrips.has(l)) lineTrips.set(l, []); lineTrips.get(l).push(i); } }
      const out = [];
      for (const i of lineTrips.get(line) || []) {
        const T = tt.trips, p = tt.profiles[T[i]], s = T[i + 1], hs = tt.names[T[i + 3]], dur = p[3][p[3].length - 1];
        for (const [ok, t0] of [[svcToday[s], T[i + 2]], [svcYday[s], T[i + 2] - 86400]]) {
          if (!ok || planSec < t0 - 1200 || planSec > t0 + dur + 600) continue;
          const v = posAt(p, t0, hs, i, Math.max(t0, Math.min(t0 + dur, planSec)));
          if (v) { out.push(v); continue; }
          // on a part of the trip that the shape does not cover (stops far from it: a detour): no position, but the
          // trip still counts by its stops, and its route can be drawn where the shape does fit
          const vi = p[1], shape = vi >= 0 ? geo.v[vi] : geo.s[-vi - 1];
          if (shape) out.push({ X: NaN, Y: NaN, dx: 0, dy: 0, type: tt.routes[p[0]][1], line, shape, m: NaN, back: false, hs, id: i, t0, p, seg: -1 });
        }
      }
      return out;
    },
    count: () => active.length,
    pointAt,
    // one timetable trip (ti = index into tt.trips) as layers.setRoute() takes it: the stop card highlights the way
    // a chosen departure goes
    tripRoute(ti) {
      if (!tt || !geo || geoRot !== rotation()) return null;
      const p = tt.profiles[tt.trips[ti]];
      const vi = p[1], shape = vi >= 0 ? geo.v[vi] : geo.s[-vi - 1];
      if (!shape) return null;
      return { p, shape, t0: tt.trips[ti + 2], type: tt.routes[p[0]][1], line: tt.routes[p[0]][0] };
    },
    stopName: num => (st && st.stopNum ? st.stopNum[num] || '' : ''),
    names: i => (tt ? tt.names[i] || '' : ''),
    // ---------------------------------------------------------------- stops and their departures
    stops: () => (st ? st.stops || {} : {}),
    loadStops,
    wantSnap: true, // false (phones): live vehicles are drawn straight until the timetable is needed for something else
    now: pragueNow,
    // the dates to show a timetable for: today, the next working day, Saturday and Sunday
    dayChoices() {
      const n = pragueNow();
      const y = Math.floor(n.date / 10000), mo = Math.floor(n.date / 100) % 100, d = n.date % 100;
      const at = k => { const t = new Date(Date.UTC(y, mo - 1, d) + k * 864e5); return { date: t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(), wd: (t.getUTCDay() + 6) % 7 }; };
      const next = test => { for (let k = 0; k < 8; k++) { const x = at(k); if (test(x.wd)) return x; } return at(0); };
      return { today: { ...at(0), label: 'Dnes' }, work: { ...next(w => w <= 4), label: 'Pracovní den' }, sat: { ...next(w => w === 5), label: 'Sobota' }, sun: { ...next(w => w === 6), label: 'Neděle' } };
    },
    // all calls at a stop on one day: [{ sec, line, type, hs, trip, last, first }]
    calls(stopNum, day) {
      if (!tt) return [];
      if (!stopIdx) {
        stopIdx = new Map();
        tt.profiles.forEach((p, pi) => (p[5] || []).forEach((num, pos) => { if (!num) return; if (!stopIdx.has(num)) stopIdx.set(num, []); stopIdx.get(num).push([pi, pos]); }));
        profTrips = new Map();
        for (let i = 0; i < tt.trips.length; i += 4) { const pi = tt.trips[i]; if (!profTrips.has(pi)) profTrips.set(pi, []); profTrips.get(pi).push(i); }
      }
      const svc = tt.services.map(s => runs(s, day.date, day.wd));
      const out = [];
      for (const [pi, pos] of stopIdx.get(+stopNum) || []) {
        const p = tt.profiles[pi];
        for (const ti of profTrips.get(pi) || []) {
          if (!svc[tt.trips[ti + 1]]) continue;
          out.push({ sec: tt.trips[ti + 2] + p[3][pos], line: tt.routes[p[0]][0], type: tt.routes[p[0]][1], hs: tt.names[tt.trips[ti + 3]], trip: ti, first: pos === 0, last: pos === p[3].length - 1 });
        }
      }
      return out.sort((a, b) => a.sec - b.sec);
    },
    // the vehicle's itinerary: [{ name, time (s since midnight), state: 'past' | 'next' | 'later' }]
    itinerary(veh) {
      const [r, , , offs, stopNames, stopNums] = veh.p;
      const kind = tt.reqStops || {};
      const sec = pragueNow().sec;
      const out = [];
      for (let i = 0; i < offs.length; i++) {
        const t = veh.t0 + offs[i];
        // request stop ("na znamení") of the line: all day ('a') or only at night, 22–5 h ('n'); req = on this trip
        const rk = stopNums ? kind[`${r}|${stopNums[i]}`] || '' : '', s = ((t % 86400) + 86400) % 86400;
        out.push({ name: tt.names[stopNames[i]], num: stopNums ? stopNums[i] : 0, time: t, state: t <= sec ? 'past' : 'later', reqKind: rk, req: rk === 'a' || (rk === 'n' && (s >= 79200 || s < 18000)) });
      }
      const nx = out.find(o => o.state === 'later');
      if (nx) nx.state = 'next';
      return out;
    },
    // points along the vehicle body from the front to the back (image px), following the route's curves
    body(veh, lengthM, n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const d = (lengthM * i) / (n - 1);
        const p = pointAt(veh.shape, veh.back ? veh.m + d : veh.m - d);
        out.push(p[0], p[1]);
      }
      return out;
    },
  };
}
