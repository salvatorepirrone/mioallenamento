// Lodestar — home: 1) salute e forma, 2) allenamento consigliato, 3) nutrizione (in arrivo).
// Il motore del consiglio e' in engine.js (globali: computeRecommendation, renderRecommendation, ...).

const ACT_LABELS = {
  running: 'Corsa', trail_running: 'Trail', treadmill_running: 'Tapis roulant', lap_swimming: 'Nuoto',
  open_water_swimming: 'Nuoto acque libere', swimming: 'Nuoto', strength_training: 'Palestra',
  cycling: 'Bici', walking: 'Camminata', hiking: 'Escursione',
};

function fmt1(n) { return n.toFixed(1).replace('.', ','); }

async function loadHealth() {
  const [fitness, weights, sleep] = await Promise.all([
    fetchJSONSafe('/data/garmin-fitness.json', null),
    fetchJSONSafe('/data/withings-weight.json', []),
    fetchJSONSafe('/data/withings-sleep.json', []),
  ]);
  const stat = (v, l, d) => `<div class="hstat"><span class="v">${v}</span><span class="l">${l}${d ? ' (' + d + ')' : ''}</span></div>`;
  const w = weights && weights[0];
  const rhr = fitness && fitness.resting_hr && fitness.resting_hr.length ? fitness.resting_hr[fitness.resting_hr.length - 1] : null;
  const night = sleep && sleep[0];
  const tiles = [];
  if (w) {
    tiles.push(stat(w.weight != null ? fmt1(w.weight) + ' kg' : '—', 'Peso', w.label));
    tiles.push(stat(w.fat != null ? fmt1(w.fat) + '%' : '—', 'Grasso', w.label));
    tiles.push(stat(w.bmi != null ? fmt1(w.bmi) : '—', 'IMC', w.label));
  }
  if (fitness) {
    tiles.push(stat(fitness.vo2max_running != null ? fmt1(fitness.vo2max_running) : '—', 'VO2max'));
    const cat = fitness.training_status_category;
    tiles.push(stat(cat ? (TRAINING_STATUS_LABELS_IT[cat] || cat) : '—', 'Training status'));
  }
  if (rhr) tiles.push(stat(rhr.value + ' bpm', 'FC a riposo'));
  if (night && night.sleep_score != null) tiles.push(stat(night.sleep_score + '/100', 'Sonno', actDateLabel(night.date)));
  document.getElementById('ld-stats').innerHTML = tiles.join('') || '<span class="ld-muted">Dati non disponibili</span>';
  return { fitness, sleep };
}

// Training readiness: punteggio Garmin + prontezza combinata (Garmin, sonno Withings, FC a riposo, carico recente).
function renderReadiness(fitness, model) {
  const tr = fitness && fitness.training_readiness;
  const r = model && model.readiness;
  const box = document.getElementById('ld-ready');
  if (!r) { box.innerHTML = '<span class="ld-muted">Prontezza non disponibile.</span>'; return; }
  const color = r.band === 'alta' ? 'var(--ld-good)' : (r.band === 'media' ? 'var(--ld-mid)' : 'var(--ld-low)');
  const bandText = { alta: 'Prontezza alta', media: 'Prontezza media', bassa: 'Prontezza bassa', 'molto bassa': 'Prontezza molto bassa' }[r.band];
  const chips = r.factors.map(f => {
    const txt = f.value != null ? `${f.label} ${f.value}` : `${f.label} ${f.delta > 0 ? '+' : '−'}${Math.abs(f.delta)}`;
    return `<span class="ld-chip ${f.delta > 0 ? 'pos' : (f.delta < 0 ? 'neg' : '')}">${txt}</span>`;
  }).join('');
  const garmin = tr && tr.score != null && daysSinceDate(tr.date) <= 1
    ? `<b>Training readiness Garmin: ${tr.score}/100.</b> ` : '<b>Training readiness Garmin non disponibile oggi</b>: stima dal carico recente. ';
  const effect = { alta: 'Via libera a una seduta di qualità.', media: 'Qualità sì, ma a volume ridotto.', bassa: 'Meglio lavoro aerobico, niente ripetute.', 'molto bassa': 'Oggi solo scarico.' }[r.band];
  box.innerHTML = `
    <div class="ld-gauge"><div class="ring" style="--p:${r.score};--c:${color}"><div class="ring-in"><b>${r.score}</b><span>/ 100</span></div></div><div class="cap" style="color:${color}">${bandText}</div></div>
    <div class="ld-ready-text">${garmin}Prontezza combinata ${r.score}/100 (fonte: ${r.source}). ${effect}<div class="ld-chips">${chips}</div></div>`;
}

async function loadRecommendation(health) {
  try {
    const activities = await fetchJSONSafe('/data/garmin-activities.json', []);
    const goals = await loadGoals(health.fitness);
    const model = computeRecommendation(activities, health.fitness, health.sleep, goals);
    renderReadiness(health.fitness, model);
    renderRecommendation(model);
    attachSendButtons(model);
  } catch (err) {
    console.warn('Consiglio del giorno non disponibile:', err);
    document.getElementById('reco-box').innerHTML = '<div class="reco-text">Consiglio non disponibile al momento.</div>';
  }
}

async function loadActivitiesTable() {
  const tbody = document.getElementById('ld-acts');
  const acts = await fetchJSONSafe('/data/garmin-activities.json', []);
  if (!acts.length) { tbody.innerHTML = '<tr><td colspan="6" class="ld-muted">Nessuna attività sincronizzata</td></tr>'; return; }
  tbody.innerHTML = acts.slice(0, 10).map(a => {
    const swim = SWIM_TYPES.includes(a.type);
    const dist = a.distance_km != null ? (swim ? Math.round(a.distance_km * 1000) + ' m' : fmt1(a.distance_km) + ' km') : '—';
    const dur = a.duration_min != null ? `${Math.floor(a.duration_min / 60) ? Math.floor(a.duration_min / 60) + ' h ' : ''}${Math.round(a.duration_min % 60)} min` : '—';
    return `<tr><td>${actDateLabel(a.date)}</td><td>${ACT_LABELS[a.type] || a.type}</td><td>${dist}</td><td>${dur}</td><td>${a.avg_hr ?? '—'}/${a.max_hr ?? '—'}</td><td>${a.calories != null ? Math.round(a.calories) : '—'}</td></tr>`;
  }).join('');
}

// Dati freschi prima di consigliare, con cooldown di 20 minuti per non martellare Garmin/Withings.
async function maybeAutoRefresh() {
  let last = 0;
  try { last = Number(localStorage.getItem('lastAutoRefresh') || 0); } catch (e) { /* storage non disponibile */ }
  if (Date.now() - last < 20 * 60 * 1000) return false;
  try { localStorage.setItem('lastAutoRefresh', String(Date.now())); } catch (e) { /* storage non disponibile */ }
  const s = document.getElementById('ld-refresh');
  s.textContent = '🔄 aggiornamento dati…';
  try {
    const res = await fetch('/refresh-sync.php', { method: 'POST' });
    const d = await res.json();
    return !!d.ok;
  } catch (e) {
    return false;
  } finally {
    s.textContent = 'Garmin · Withings';
  }
}

async function loadAll() {
  const health = await loadHealth();
  loadRecommendation(health);
  loadActivitiesTable();
}

document.getElementById('ld-date').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
loadAll();
maybeAutoRefresh().then(ok => { if (ok) loadAll(); });
