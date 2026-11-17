// Live data straight from public open APIs (the site itself stays static):
//  - weather: Open-Meteo (current conditions in Brno)
//  - traffic: City of Brno open data, Waze jams and incidents (gis.brno.cz)
const WEATHER = 'https://api.open-meteo.com/v1/forecast?latitude=49.195&longitude=16.608&current=temperature_2m,cloud_cover,precipitation,rain,showers,snowfall,weather_code,visibility,wind_speed_10m,is_day&timezone=Europe%2FPrague';
const JAMS = 'https://gis.brno.cz/ags1/rest/services/Hosted/WazeJams/FeatureServer/0/query';
const ALERTS = 'https://gis.brno.cz/ags1/rest/services/Hosted/WazeAlerts/FeatureServer/0/query';

export async function fetchWeather() {
  const r = await fetch(WEATHER);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const c = (await r.json()).current;
  const code = c.weather_code;
  let kind = 'clear';
  if (code === 45 || code === 48 || (c.visibility && c.visibility < 1000)) kind = 'fog';
  if (c.snowfall > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86) kind = 'snow';
  else if (c.precipitation > 0 || c.rain > 0 || c.showers > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) kind = 'rain';
  const sky = code === 0 ? 'jasno' : code <= 2 ? 'polojasno' : code === 3 ? 'zataženo' : code <= 48 ? 'mlha' : code <= 67 ? 'déšť' : code <= 77 ? 'sněžení' : code <= 82 ? 'přeháňky' : code <= 86 ? 'sněhové přeháňky' : 'bouřka';
  return { code, day: c.is_day, kind, cloud: (c.cloud_cover ?? 50) / 100, precip: c.precipitation || 0, wind: c.wind_speed_10m || 0, temp: c.temperature_2m, sky, time: c.time };
}

async function query(url, params) {
  const q = new URLSearchParams({ outSR: '4326', f: 'json', ...params });
  const r = await fetch(`${url}?${q}`);
  if (!r.ok) throw new Error(`traffic ${r.status}`);
  return (await r.json()).features || [];
}

// jams from the last 30 minutes and incidents from the last hours, newest report per event
// the map area (Brno and around): reports outside it are left out
const inArea = (lon, lat) => lon > 16.41 && lon < 16.80 && lat > 49.075 && lat < 49.33;
export async function fetchTraffic() {
  const now = Date.now();
  const [jams, alerts] = await Promise.all([
    query(JAMS, { where: `pubMillis > ${now - 30 * 60e3}`, outFields: 'uuid,level,speedKMH,delay,length,street,pubMillis,roadType,blockingAlertUuid', orderByFields: 'pubMillis DESC', resultRecordCount: '2000' }),
    // (Waze "road closed" reports are not used: a single point says little about which section is closed;
    // the official closures from the city and OpenStreetMap are shown instead)
    query(ALERTS, { where: `pubMillis > ${now - 3600e3} AND type IN ('ACCIDENT','HAZARD')`, outFields: 'uuid,type,subtype,street,pubMillis,reportDescription', orderByFields: 'pubMillis DESC', resultRecordCount: '2000' }),
  ]);
  const seen = new Set();
  const outJ = [];
  const skipped = { closure: 0, local: 0, other: 0 };
  for (const f of jams) {
    const a = f.attributes;
    if (seen.has(a.uuid) || !f.geometry || !f.geometry.paths) continue;
    seen.add(a.uuid);
    const p0 = f.geometry.paths[0], pm = p0[Math.floor(p0.length / 2)];
    if (!pm || !inArea(pm[0], pm[1])) continue;
    // Plausibility check of a Waze jam (the feed also contains things that are not queues of cars):
    //  - level 5 with a blocking report, zero speed or no delay = the road is closed (a report of a driver),
    //    not a queue; closures are shown from the reports themselves
    //  - no delay = nothing to show
    //  - parking lots, private and off-road ways, paths: not traffic
    //  - local streets (Waze road type 1): one slow car (rubbish truck, someone parking) makes a 'jam' there;
    //    shown only when it is a real hold-up: at least 3 minutes of delay and heavy level
    const rt = +a.roadType || 0;
    if (a.level >= 5 && (a.blockingAlertUuid || (a.delay ?? 0) < 0 || !a.speedKMH)) { skipped.closure++; continue; }
    if (!(a.delay > 0)) { skipped.other++; continue; }
    if ([5, 8, 10, 17, 18, 19, 20].includes(rt)) { skipped.other++; continue; }
    if (rt === 1 && !(a.delay >= 180 && a.level >= 4)) { skipped.local++; continue; }
    outJ.push({ level: a.level || 1, road: +a.roadType || 0, speed: a.speedKMH, delay: a.delay, len: a.length, street: a.street || '', t: a.pubMillis, path: f.geometry.paths[0] });
  }
  const outA = [];
  for (const f of alerts) {
    const a = f.attributes;
    if (seen.has(a.uuid) || !f.geometry) continue;
    seen.add(a.uuid);
    if (!inArea(f.geometry.x, f.geometry.y)) continue;
    outA.push({ type: a.type, sub: a.subtype || '', street: a.street || '', t: a.pubMillis, note: a.reportDescription || '', lon: f.geometry.x, lat: f.geometry.y });
  }
  return { jams: outJ, alerts: outA, at: now, skipped };
}
