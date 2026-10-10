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
    try { applyLibrary(model, await loadAllLibraries(), activities); } catch (e) { console.warn('Libreria non disponibile per il consiglio:', e); }
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

// Allenamenti assegnati dal coach per oggi o i prossimi giorni.
async function loadCoachAssigned() {
  const box = document.getElementById('coach-box');
  try {
    const d = await LibUI.api('mine');
    if (!d.workouts.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="reco-title" style="margin-bottom:8px">📋 Assegnato dal coach</div>' + d.workouts.map(w =>
      `<div class="ld-recipe ld-wk" data-prog="${w.id}" style="margin-bottom:12px"><div class="ld-recipe-head"><b>${LibUI.e(w.title)}</b> <span class="ld-badge">${w.date} · ${LibUI.e(w.created_by)}</span></div>${LibUI.html(w.parsed)}${LibUI.sendBox(null, d.can_send, w.sport)}<div class="cw-msg ld-muted"></div></div>`).join('');
    box.onclick = async ev => {
      const b = ev.target.closest('[data-send]'); if (!b) return;
      const wrap = b.closest('[data-prog]'), msg = wrap.querySelector('.cw-msg');
      b.disabled = true; msg.textContent = 'Un momento…';
      try { await LibUI.api('send', { id: wrap.dataset.prog, date: wrap.querySelector('.reco-date').value || null }); msg.textContent = "Inviato a Garmin: sull'orologio dopo la sincronizzazione."; }
      catch (e) { msg.textContent = e.message; b.disabled = false; }
    };
  } catch (e) { box.innerHTML = ''; }
}

// Dal piano personalizzato: la seduta di oggi (o la prossima).
async function loadPlanToday() {
  const box = document.getElementById('plan-box');
  try {
    const res = await fetch('/lodestar/piano-api.php?action=get', { cache: 'no-store', credentials: 'same-origin' });
    const d = await res.json();
    if (!d.plan) { box.innerHTML = '<div class="reco-text" style="margin-bottom:12px">🎯 Non hai ancora un piano: <a class="reco-link" href="/lodestar/piano.html">crea il tuo piano personalizzato →</a></div>'; return; }
    const today = todayISO();
    const [acts, fit, sleep] = await Promise.all([fetchJSONSafe('/data/garmin-activities.json', []), fetchJSONSafe('/data/garmin-fitness.json', null), fetchJSONSafe('/data/withings-sleep.json', [])]);
    await applyPlanAdaptation(d.plan, { activities: acts, fitness: fit, sleep }, d.csrf);
    const items = d.plan.weeks.flatMap(w => w.days.map(x => ({ date: x.date, s: x.sessions })));
    const todayItem = items.find(x => x.date === today);
    const next = items.find(x => x.date > today);
    const line = x => x.s.map(s => `${s.adapted && s.adapted.orig ? '🔧 ' : ''}${s.sport === 'running' ? '🏃' : (s.sport === 'swimming' ? '🏊' : (s.sport === 'strength' ? '🏋️' : '🏁'))} <b>${LibUI.e(s.title)}</b>`).join(' + ');
    const wk = d.plan.weeks.find(w => daysBetweenIso(w.monday, today) >= 0 && daysBetweenIso(w.monday, today) < 7);
    box.innerHTML = `<div class="ld-planline"><div class="reco-title">🎯 Dal tuo piano${wk ? ` · settimana ${wk.n} di ${d.plan.weeks.length} (${PHASE_NAMES[wk.phase]})` : ''}</div>
      <div class="reco-text">${todayItem ? 'Oggi: ' + line(todayItem) : 'Oggi riposo.'}${next ? ` · Prossima: ${line(next)} <span class="ld-muted">(${next.date.slice(8)}/${next.date.slice(5, 7)})</span>` : ''} <a class="reco-link" href="/lodestar/piano.html">Apri il piano →</a></div></div>`;
  } catch (e) { box.innerHTML = ''; }
}
const PHASE_NAMES = { base: 'base', sviluppo: 'sviluppo', picco: 'picco', scarico: 'scarico' };
function daysBetweenIso(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

async function loadAll() {
  loadPlanToday();
  loadCoachAssigned();
  const health = await loadHealth();
  loadRecommendation(health);
}

initNutritionPanel(document.getElementById('ld-meals'));
document.getElementById('ld-date').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
loadAll();
maybeAutoRefresh().then(ok => { if (ok) loadAll(); });
