// Live positions of public transport vehicles from the City of Brno open data stream
// (KORDIS JMK, licence CC BY; data.brno.cz "Polohy vozidel hromadné dopravy").
// Every vehicle reports its position, bearing, line, delay and last / final stop about every 10–30 s;
// between reports the vehicle glides from its previous to its new position.
const STREAM = 'wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe?outSR=4326';
const TYPE = { 0: 'tram', 1: 'trol', 2: 'bus' }; // LType: 0 tram, 1 trolleybus, 2 city bus (4 regional bus, 5 train)

export function createMhdLive() {
  const vehicles = new Map();
  let ws = null, wanted = false, lastMsg = 0, retry = null;
  const status = { connected: false, onChange: null };

  function connect() {
    if (ws || !wanted) return;
    try { ws = new WebSocket(STREAM); } catch { ws = null; schedule(); return; }
    ws.onopen = () => { status.connected = true; status.onChange && status.onChange(); };
    ws.onclose = () => { ws = null; status.connected = false; status.onChange && status.onChange(); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    ws.onmessage = m => {
      let a;
      try { a = JSON.parse(m.data).attributes; } catch { return; }
      if (!a || !(a.LType in TYPE) || a.IsInactive === 'true') return;
      lastMsg = Date.now();
      const now = performance.now();
      const v = vehicles.get(a.ID);
      if (v) {
        // keep where it is drawn right now as the start of the glide to the new position
        const p = pos(v, now);
        v.lat0 = p[0]; v.lng0 = p[1]; v.t0 = now;
      }
      const n = v || { lat0: a.Lat, lng0: a.Lng, t0: now };
      // real direction of travel (the reported bearing is often stale): from the last report to this one
      const dLat = a.Lat - n.lat0, dLng = a.Lng - n.lng0;
      const dN = dLat * 110574, dE = dLng * Math.cos((a.Lat * Math.PI) / 180) * 111320;
      if (Math.hypot(dN, dE) > 4) { n.heading = (Math.atan2(dE, dN) * 180) / Math.PI; n.moveLat = dLat; n.moveLng = dLng; }
      Object.assign(n, {
        id: `live-${a.ID}`, lat: a.Lat, lng: a.Lng, t1: now + 9000, bearing: a.Bearing || 0, line: a.LineName, type: TYPE[a.LType],
        vid: a.ID, idb: a.IDB || 0, idc: a.IDC || 0, delay: a.Delay, last: a.LastStopID, final: a.FinalStopID, at: a.TimeUpdated, seen: Date.now(), lowFloor: a.LF === 'true',
      });
      vehicles.set(a.ID, n);
    };
  }
  function schedule() { if (wanted && !retry) retry = setTimeout(() => { retry = null; connect(); }, 5000); }
  function pos(v, now) {
    const f = Math.max(0, Math.min(1, (now - v.t0) / (v.t1 - v.t0 || 1)));
    return [v.lat0 + (v.lat - v.lat0) * f, v.lng0 + (v.lng - v.lng0) * f];
  }
  return {
    status,
    start() { wanted = true; connect(); },
    stop() { wanted = false; if (ws) ws.close(); },
    // fresh vehicles (reported in the last 3 minutes) with their current glide position
    list() {
      const now = performance.now(), cut = Date.now() - 180e3, out = [];
      for (const [k, v] of vehicles) {
        if (v.seen < cut) { vehicles.delete(k); continue; }
        const [lat, lng] = pos(v, now);
        out.push({ ...v, latNow: lat, lngNow: lng });
      }
      return out;
    },
    alive: () => Date.now() - lastMsg < 60e3,
    count: () => vehicles.size,
  };
}
