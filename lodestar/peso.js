// Lodestar — pagina Peso: andamento (peso, grasso, massa muscolare), ultima misurazione per fonte, storico e obiettivo dal profilo.
const SRC = { withings: { name: 'Withings', color: '#2f8f66' }, garmin: { name: 'Garmin', color: '#3f72a0' } };
const METRICS = { weight: { label: 'Peso', unit: 'kg' }, fat: { label: 'Grasso', unit: '%' }, muscle: { label: 'Massa muscolare', unit: 'kg' } };
const RANGES = { 30: '30 giorni', 90: '90 giorni', 0: 'Tutto' };
let DATA = { withings: [], garmin: [] }, view = { metric: 'weight', range: 30 }, targetKg = null;
const $ = id => document.getElementById(id);
const f1 = n => (n == null ? '—' : n.toFixed(1).replace('.', ','));

function chartSVG(series) {
  const W = 680, H = 250, ml = 46, mr = 16, mt = 14, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
  const pts = series.flatMap(s => s.points);
  if (pts.length < 2) return '<div class="ld-muted" style="padding:20px 0;text-align:center">Dati insufficienti per il grafico in questo periodo.</div>';
  const times = pts.map(p => new Date(p.date + 'T12:00:00').getTime()), vals = pts.map(p => p.value);
  const minT = Math.min(...times), maxT = Math.max(...times);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.18 || 1; lo -= pad; hi += pad;
  const x = d => (maxT === minT ? ml + pw / 2 : ml + (new Date(d + 'T12:00:00').getTime() - minT) / (maxT - minT) * pw);
  const y = v => mt + ph - (v - lo) / (hi - lo) * ph;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, yy = y(v);
    g += `<line x1="${ml}" y1="${yy.toFixed(1)}" x2="${W - mr}" y2="${yy.toFixed(1)}" stroke="var(--border)"/><text x="${ml - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--muted)">${v.toFixed(1)}</text>`;
  }
  const days = [...new Set(pts.map(p => p.date))].sort(), ticks = Math.min(6, days.length);
  for (let i = 0; i < ticks; i++) {
    const d = days[Math.round(i * (days.length - 1) / (ticks - 1 || 1))];
    g += `<text x="${x(d).toFixed(1)}" y="${H - mb + 17}" font-size="10" text-anchor="middle" fill="var(--muted)">${actDateLabel(d)}</text>`;
  }
  if (view.metric === 'weight' && targetKg && targetKg > lo && targetKg < hi) {
    g += `<line x1="${ml}" y1="${y(targetKg).toFixed(1)}" x2="${W - mr}" y2="${y(targetKg).toFixed(1)}" stroke="#d9822b" stroke-dasharray="5 4"/><text x="${W - mr}" y="${(y(targetKg) - 5).toFixed(1)}" font-size="10" text-anchor="end" fill="#d9822b">obiettivo ${f1(targetKg)} kg</text>`;
  }
  series.forEach(s => {
    const sp = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!sp.length) return;
    g += `<path d="${sp.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
    sp.forEach(p => { g += `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${s.color}"><title>${actDateLabel(p.date)}: ${f1(p.value)}</title></circle>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
}

function renderChart() {
  const m = view.metric, cutoff = view.range ? daysFrom(view.range) : '';
  const series = Object.keys(DATA).map(k => ({ name: SRC[k].name, color: SRC[k].color,
    points: DATA[k].filter(d => d[m] != null && d.date >= cutoff).map(d => ({ date: d.date, value: d[m] })) })).filter(s => s.points.length);
  $('ps-legend').innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
  $('ps-chart').innerHTML = chartSVG(series);
  $('ps-metric-btns').innerHTML = Object.keys(METRICS).filter(k => k === 'weight' || Object.values(DATA).some(a => a.some(d => d[k] != null)))
    .map(k => `<button type="button" class="ld-cat${view.metric === k ? ' on' : ''}" data-metric="${k}">${METRICS[k].label}</button>`).join('');
  $('ps-range-btns').innerHTML = Object.keys(RANGES).map(k => `<button type="button" class="ld-cat${view.range === Number(k) ? ' on' : ''}" data-range="${k}">${RANGES[k]}</button>`).join('');
}

function daysFrom(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); }

function renderSources() {
  const rows = { weight: 'Peso', fat: 'Grasso corporeo', muscle: 'Massa muscolare', bone: 'Massa ossea', water: 'Acqua corporea', bmi: 'IMC' };
  const unit = { weight: ' kg', fat: ' %', muscle: ' kg', bone: ' kg', water: ' %', bmi: '' };
  $('ps-sources').innerHTML = Object.keys(DATA).filter(k => DATA[k].length).map(k => {
    const l = DATA[k][0];
    return `<div class="ps-src" style="border-left:4px solid ${SRC[k].color}"><div class="ps-src-head"><b style="color:${SRC[k].color}">${SRC[k].name}</b><span class="ld-muted">${l.label || actDateLabel(l.date)}</span></div>
      ${Object.keys(rows).filter(r => l[r] != null).map(r => `<div class="ps-row"><span>${rows[r]}</span><b>${f1(l[r])}${unit[r]}</b></div>`).join('')}</div>`;
  }).join('');
  const both = DATA.withings.length && DATA.garmin.length;
  $('ps-note').hidden = !both;
  if (both) {
    const dw = DATA.withings[0].weight - DATA.garmin[0].weight;
    const df = DATA.withings[0].fat != null && DATA.garmin[0].fat != null ? DATA.withings[0].fat - DATA.garmin[0].fat : null;
    $('ps-sources').insertAdjacentHTML('beforeend', `<div class="ps-src"><div class="ps-src-head"><b>Differenza</b><span class="ld-muted">Withings − Garmin</span></div>
      <div class="ps-row"><span>Peso</span><b>${dw > 0 ? '+' : ''}${f1(dw)} kg</b></div>${df != null ? `<div class="ps-row"><span>Grasso</span><b>${df > 0 ? '+' : ''}${f1(df)} pt</b></div>` : ''}</div>`);
  }
}

function renderHistory() {
  const rows = [];
  Object.keys(DATA).forEach(k => DATA[k].slice(0, 20).forEach(d => rows.push({ k, d })));
  rows.sort((a, b) => (a.d.date < b.d.date ? 1 : -1));
  $('ps-history').innerHTML = rows.slice(0, 30).map(({ k, d }) => `<tr><td>${d.label || actDateLabel(d.date)}</td><td><span class="ps-dot" style="background:${SRC[k].color}"></span>${SRC[k].name}</td>
    <td>${f1(d.weight)} kg</td><td>${d.fat != null ? f1(d.fat) + ' %' : '—'}</td><td>${d.muscle != null ? f1(d.muscle) + ' kg' : '—'}</td><td>${d.water != null ? f1(d.water) + ' %' : '—'}</td></tr>`).join('');
}

function renderHero() {
  const main = DATA.withings[0] || DATA.garmin[0];
  const all = (DATA.withings.length ? DATA.withings : DATA.garmin);
  const recent = all.filter(d => d.weight != null && d.date >= daysFrom(14)), before = all.filter(d => d.weight != null && d.date < daysFrom(14) && d.date >= daysFrom(28));
  const avg = a => a.reduce((s, d) => s + d.weight, 0) / a.length;
  const trend = recent.length >= 2 && before.length >= 2 ? avg(recent) - avg(before) : null;
  const tile = (v, l) => `<div class="hstat"><span class="v">${v}</span><span class="l">${l}</span></div>`;
  const g = DATA.garmin[0];
  $('ps-stats').innerHTML = [tile(f1(main.weight) + ' kg', 'Peso (' + (main.label || actDateLabel(main.date)) + ')'),
    main.fat != null ? tile(f1(main.fat) + '%', 'Grasso') : '', main.bmi != null ? tile(f1(main.bmi), 'IMC') : '',
    g && g.muscle != null ? tile(f1(g.muscle) + ' kg', 'Massa muscolare') : '',
    trend != null ? tile((trend > 0 ? '+' : '') + f1(trend) + ' kg', 'Variazione 14 giorni') : ''].join('');
  if (targetKg && main.weight != null) {
    const diff = main.weight - targetKg;
    $('ps-goal').textContent = Math.abs(diff) < 0.3 ? `Hai raggiunto il tuo peso obiettivo di ${f1(targetKg)} kg.` : `Peso obiettivo ${f1(targetKg)} kg: ${diff > 0 ? 'mancano' : 'sei sopra di'} ${f1(Math.abs(diff))} kg.`;
  }
}

document.addEventListener('click', e => {
  const m = e.target.closest('[data-metric]'), r = e.target.closest('[data-range]');
  if (m) { view.metric = m.dataset.metric; renderChart(); }
  if (r) { view.range = Number(r.dataset.range); renderChart(); }
});

(async () => {
  const [w, g, prof] = await Promise.all([fetchJSONSafe('/data/withings-weight.json', []), fetchJSONSafe('/data/garmin-weight.json', []),
    fetchJSONSafe('/lodestar/profile-api.php?action=get', { profile: null })]);
  DATA = { withings: (w || []).filter(d => d.weight != null), garmin: (g || []).filter(d => d.weight != null) };
  targetKg = prof && prof.profile && prof.profile.target_weight_kg;
  if (!DATA.withings.length && !DATA.garmin.length) { $('ps-empty').hidden = false; return; }
  $('ps-main').hidden = false;
  // periodo iniziale: il piu' breve che contiene almeno due misurazioni
  const enough = r => Object.values(DATA).some(a => a.filter(d => d.weight != null && (r === 0 || d.date >= daysFrom(r))).length >= 2);
  view.range = [30, 90, 0].find(enough) ?? 0;
  renderHero(); renderChart(); renderSources(); renderHistory();
})();
