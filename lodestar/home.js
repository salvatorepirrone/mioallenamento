// Lodestar — home: 1) salute e forma, 2) allenamento consigliato, 3) nutrizione (in arrivo).
// Il motore del consiglio e' in engine.js (globali: computeRecommendation, renderRecommendation, ...).

function fmt1(n) { return n.toFixed(1).replace('.', ','); }

const hstat = (v, l, d) => `<div class="hstat"><span class="v">${v}</span><span class="l">${l}${d ? ' (' + d + ')' : ''}</span></div>`;
let healthTiles = [];

function renderStats(readinessTiles) {
  document.getElementById('ld-stats').innerHTML = healthTiles.concat(readinessTiles || []).join('') || '<span class="ld-muted">Dati non disponibili</span>';
}

async function loadHealth() {
  const [fitness, weights, sleep] = await Promise.all([
    fetchJSONSafe('/data/garmin-fitness.json', null),
    fetchJSONSafe('/data/withings-weight.json', []),
    fetchJSONSafe('/data/withings-sleep.json', []),
  ]);
  const w = weights && weights[0];
  const rhr = fitness && fitness.resting_hr && fitness.resting_hr.length ? fitness.resting_hr[fitness.resting_hr.length - 1] : null;
  healthTiles = [];
  if (w) {
    healthTiles.push(hstat(w.weight != null ? fmt1(w.weight) + ' kg' : '—', 'Peso', w.label));
    healthTiles.push(hstat(w.fat != null ? fmt1(w.fat) + '%' : '—', 'Grasso', w.label));
    healthTiles.push(hstat(w.bmi != null ? fmt1(w.bmi) : '—', 'IMC', w.label));
  }
  if (fitness) {
    healthTiles.push(hstat(fitness.vo2max_running != null ? fmt1(fitness.vo2max_running) : '—', 'VO2max'));
    const cat = fitness.training_status_category;
    healthTiles.push(hstat(cat ? (TRAINING_STATUS_LABELS_IT[cat] || cat) : '—', 'Training status'));
  }
  if (rhr) healthTiles.push(hstat(rhr.value + ' bpm', 'FC a riposo'));
  renderStats();
  return { fitness, sleep };
}

// Training readiness: punteggio Garmin, ultima in coda agli indicatori.
function readinessTiles(fitness) {
  const tr = fitness && fitness.training_readiness;
  return tr && tr.score != null && daysSinceDate(tr.date) <= 1 ? [hstat(tr.score + '/100', 'Training readiness')] : [];
}

async function loadRecommendation(health) {
  try {
    const activities = await fetchJSONSafe('/data/garmin-activities.json', []);
    const goals = await loadGoals(health.fitness);
    const model = computeRecommendation(activities, health.fitness, health.sleep, goals);
    renderStats(readinessTiles(health.fitness));
    renderRecommendation(model);
    attachSendButtons(model);
  } catch (err) {
    console.warn('Consiglio del giorno non disponibile:', err);
    document.getElementById('reco-box').innerHTML = '<div class="reco-text">Consiglio non disponibile al momento.</div>';
  }
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
    s.textContent = 'Dati Garmin · Withings';
  }
}

async function loadAll() {
  const health = await loadHealth();
  loadRecommendation(health);
}

document.getElementById('ld-date').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
loadAll();
maybeAutoRefresh().then(ok => { if (ok) loadAll(); });
