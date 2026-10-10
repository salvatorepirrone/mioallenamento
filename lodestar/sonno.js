// Lodestar — pagina Sonno: ultima notte (punteggio, fasi, frequenza cardiaca, respirazione), ultime notti e medie.
const $ = id => document.getElementById(id);
const fmtMin = m => (!m ? '—' : (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`));
const scoreColor = s => (s >= 75 ? 'var(--ld-good)' : (s >= 55 ? 'var(--ld-mid)' : 'var(--ld-low)'));
const scoreWord = s => (s >= 75 ? 'Notte riposante' : (s >= 55 ? 'Notte nella media' : 'Notte difficile'));
const nightLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

function render(nights) {
  const d = nights[0];
  const tile = (v, l) => `<div class="hstat"><span class="v">${v}</span><span class="l">${l}</span></div>`;
  $('sl-stats').innerHTML = [d.sleep_score != null ? tile(d.sleep_score + '/100', 'Punteggio') : '', tile(fmtMin(d.total_sleep_time_min), 'Durata'),
    tile(fmtMin(d.deep_min), 'Sonno profondo'), tile(fmtMin(d.rem_min), 'REM'), d.hr_min ? tile(d.hr_min + ' bpm', 'FC minima') : ''].join('');

  $('sl-night').textContent = nightLabel(d.date);
  if (d.sleep_score != null) {
    $('sl-score').textContent = d.sleep_score;
    const ring = $('sl-ring'); ring.style.setProperty('--p', d.sleep_score); ring.style.setProperty('--c', scoreColor(d.sleep_score));
    $('sl-cap').textContent = scoreWord(d.sleep_score); $('sl-cap').style.color = scoreColor(d.sleep_score);
  }
  const awake = Math.max(0, (d.total_timeinbed_min || 0) - (d.total_sleep_time_min || 0));
  $('sl-stages').innerHTML = [['#3b5d86', d.deep_min], ['#8fb0d6', d.light_min], ['#7a5a96', d.rem_min], ['#d5dde5', awake]].map(([c, v]) => `<div style="flex:${v || 0};background:${c}" title="${fmtMin(v)}"></div>`).join('');
  const row = (l, v) => `<div class="ps-row"><span>${l}</span><b>${v}</b></div>`;
  $('sl-rows').innerHTML = row('Durata del sonno', fmtMin(d.total_sleep_time_min)) + row('Sonno profondo', fmtMin(d.deep_min)) + row('Sonno leggero', fmtMin(d.light_min)) + row('REM', fmtMin(d.rem_min))
    + row('Risvegli', d.wakeupcount != null ? d.wakeupcount + '×' : '—') + row('FC notturna (min · media)', d.hr_min ? `${d.hr_min} · ${d.hr_average || '—'} bpm` : '—')
    + row('Respirazione media', d.rr_average ? d.rr_average + ' resp/min' : '—') + row('Russamento', (d.snoring_min || 0) + ' min');
  $('sl-alerts').innerHTML = (d.breathing_disturbances_intensity || 0) > 40 ? '<div class="ld-adapt" style="margin-top:12px">⚠️ Rilevate possibili interruzioni del respiro durante la notte. Se capita spesso, parlane con un medico.</div>' : '';

  const last = nights.slice(0, 14).reverse();
  const maxScore = 100;
  $('sl-chart').innerHTML = last.map(n => `<div class="sl-col" title="${nightLabel(n.date)}: score ${n.sleep_score ?? '—'}, ${fmtMin(n.total_sleep_time_min)}">
    <div class="sl-colbar"><div style="height:${n.sleep_score != null ? Math.max(5, n.sleep_score / maxScore * 100) : 5}%;background:${n.sleep_score != null ? scoreColor(n.sleep_score) : 'var(--s3)'}"></div></div>
    <span>${new Date(n.date + 'T12:00:00').getDate()}</span></div>`).join('');
  const w7 = nights.slice(0, 7), avg = (a, k) => { const v = a.map(x => x[k]).filter(x => x != null && x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const aDur = avg(w7, 'total_sleep_time_min'), aSc = avg(w7, 'sleep_score'), short = w7.filter(x => x.total_sleep_time_min && x.total_sleep_time_min < 360).length;
  $('sl-avg').innerHTML = `Ultime ${w7.length} notti: ${aDur ? 'media <b>' + fmtMin(Math.round(aDur)) + '</b>' : ''}${aSc ? ', punteggio medio <b>' + Math.round(aSc) + '</b>' : ''}${short ? `, <b>${short}</b> ${short === 1 ? 'notte' : 'notti'} sotto le 6 ore` : ''}.`;

  $('sl-history').innerHTML = nights.slice(0, 14).map(n => `<tr><td>${nightLabel(n.date)}</td><td>${fmtMin(n.total_sleep_time_min)}</td><td>${fmtMin(n.deep_min)}</td><td>${fmtMin(n.rem_min)}</td>
    <td>${n.wakeupcount != null ? n.wakeupcount : '—'}</td><td>${n.hr_min || '—'}</td><td>${n.sleep_score != null ? `<b style="color:${scoreColor(n.sleep_score)}">${n.sleep_score}</b>` : '—'}</td></tr>`).join('');
}

(async () => {
  const s = await fetchJSONSafe('/data/withings-sleep.json', []);
  const nights = (s || []).filter(n => n && n.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!nights.length) { $('sl-empty').hidden = false; return; }
  $('sl-main').hidden = false;
  render(nights);
})();
