import { fetchData, DATA_BASE } from './feed.js';
import { track } from './stats.js';
const $ = id => document.getElementById(id);
const MODE = { live: ['živě', 'Mapa si data načítá při prohlížení'], regular: ['obnovováno', 'Obnovuje se skriptem při přípravě mapy'], snapshot: ['stav k datu', 'Snímek dat z uvedeného dne'] };
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = txt; return e; };
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const age = d => { if (!d) return null; const t = Date.parse(d + 'T12:00:00'); return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 864e5)) : null; };
const ageTxt = n => (n == null ? '' : n === 0 ? 'dnes' : n === 1 ? 'včera' : n < 5 ? `před ${n} dny` : n < 60 ? `před ${n} dny` : n < 730 ? `před ${Math.round(n / 30)} měsíci` : `před ${Math.round(n / 365)} lety`);
let data = [], sortKey = 'count', sortDir = -1;

function render() {
  const q = norm($('q').value.trim()), mode = $('mode').value;
  let list = data.filter(d => (!mode || d.mode === mode) && (!q || norm([d.name, d.what, d.owner, d.licence, d.note, d.unit].join(' ')).includes(q)));
  const val = d => (sortKey === 'count' ? d.count ?? -1 : sortKey === 'date' ? (d.date || (d.mode === 'live' ? '9999' : '')) : (d[sortKey] || '').toString());
  list = list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : x.localeCompare(y, 'cs')) * sortDir; });
  $('rows').replaceChildren(...list.map(d => {
    const tr = el('tr');
    const c1 = el('td'); c1.append(el('b', '', d.name), el('div', 'what', d.what));
    const c2 = el('td', '', d.owner);
    const c3 = el('td', '', d.licence || '–');
    const c4 = el('td', 'num'); c4.append(el('span', '', d.count == null ? '–' : d.count.toLocaleString('cs-CZ')), el('div', 'what', d.unit || ''));
    const c5 = el('td');
    if (d.mode === 'live') c5.append(el('span', '', 'aktuální (načítá se živě)'));
    else if (d.feedAt) c5.append(el('span', '', new Date(d.feedAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })), el('div', 'what', 'obnovuje server sám (data feed)'));
    else if (d.date) { const a = age(d.date); c5.append(el('span', '', new Date(d.date + 'T12:00:00').toLocaleDateString('cs-CZ')), el('div', 'what', ageTxt(a))); }
    if (d.note) c5.append(el('div', 'what', d.note));
    const c6 = el('td'); const m = el('span', `mode m-${d.mode}`, MODE[d.mode][0]); m.title = MODE[d.mode][1]; c6.append(m);
    const c7 = el('td', 'links');
    for (const [label, href] of d.links || []) { const a = el('a', '', `${label} ↗`); a.href = href; a.target = '_blank'; a.rel = 'noopener'; c7.append(a); }
    tr.append(c1, c2, c3, c4, c5, c6, c7);
    return tr;
  }));
  const live = data.filter(d => d.mode === 'live').length, total = data.reduce((s, d) => s + (d.count || 0), 0);
  $('summary').textContent = `${data.length} datových sad · ${live} živě · celkem ${total.toLocaleString('cs-CZ')} záznamů s počtem · zobrazeno ${list.length}`;
  document.querySelectorAll('th[data-k]').forEach(th => th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
}
document.querySelectorAll('th[data-k]').forEach(th => (th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : k === 'count' || k === 'date' ? -1 : 1; sortKey = k; render(); }));
$('q').oninput = render;
$('q').addEventListener('change', () => { if ($('q').value.trim()) track('Hledání', { dotaz: $('q').value.toLowerCase(), kde: 'data' }); }); // (once the field is left, not every letter)
$('mode').onchange = render;
$('csv').onclick = () => {
  track('Nástroj', { nastroj: 'csv', hodnota: 'data' });
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Co ukazuje', 'Zdroj a vlastník', 'Licence', 'Počet', 'Jednotka', 'Datum', 'Typ', 'Poznámka', 'Odkazy']]
    .concat(data.map(d => [d.name, d.what, d.owner, d.licence, d.count ?? '', d.unit, d.date, MODE[d.mode][0], d.note || '', (d.links || []).map(l => l[1]).join(' ')]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(';')).join('\n')], { type: 'text/csv' }));
  a.download = 'izometricke-brno-data.csv'; a.click();
};
const feedMeta = DATA_BASE ? fetchData('./data/feed-meta.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
Promise.all([fetch('./data/datasets.json').then(r => r.json()), feedMeta]).then(([d, meta]) => {
  for (const row of d) { const run = row.feed && meta?.feeds?.[row.feed]; if (run?.ok && Date.parse(run.at) > Date.parse(`${row.date || '2000-01-01'}T23:59:59`)) { row.feedAt = run.at; row.date = run.at.slice(0, 10); } }
  data = d; render();
}).catch(() => { $('summary').textContent = 'Přehled dat se nepodařilo načíst.'; });
