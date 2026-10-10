// Motore di Lodestar: prontezza, stato di forma, obiettivi e catalogo di sedute del consiglio del giorno.
// Ricavato dall'app esistente (index.html), che resta invariata; da qui si evolve per conto suo.
// Script classico (non un modulo): le funzioni sono globali, usate da home.js e dalle altre pagine.

// ── Helper ──
const MESI_IT = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
function actDateLabel(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESI_IT[m - 1]}`;
}
function median(nums) {
  const s = nums.slice().sort((x, y) => x - y);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null;
}
function fmtPace(minPerKm) {
  if (minPerKm == null) return '—';
  const totalSec = Math.round(minPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2,'0')}/km`;
}
function fmtSwimPace100(minPerKm) {
  if (minPerKm == null) return '—';
  const sec = Math.round(minPerKm * 6); // min/km -> sec/100m
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}/100m`;
}
function swimLapStats(a) {
  const laps = (a.laps || []).filter(l => l.avg_pace_min_per_km != null && l.distance_m >= 20);
  if (!laps.length) return null;
  const paces = laps.map(l => l.avg_pace_min_per_km);
  return { median: median(paces), best: Math.min(...paces) };
}

// ── VO2max / TRAINING STATUS in hero + CONSIGLIO DEL GIORNO (live da data/garmin-fitness.json) ──
// Il consiglio non sceglie tra 3 sessioni fisse: rigenera ogni volta il tipo e i
// parametri della seduta (corsa e nuoto/palestra) leggendo davvero l'andamento
// delle ultime settimane (frequenza per tipo di seduta, affaticamento, sonno),
// cosi' resta valido anche se il piano sotto viene ripianificato o saltato.
const TRAINING_STATUS_LABELS_IT = {
  NO_STATUS: 'Nessuno stato', DETRAINING: 'Disallenamento', RECOVERY: 'Recupero',
  MAINTAINING: 'Mantenimento', PRODUCTIVE: 'Produttivo', PEAKING: 'Picco di forma',
  OVERREACHING: 'Sovraccarico', STRAINED: 'Stress eccessivo', UNPRODUCTIVE: 'Improduttivo',
};
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running'];
const SWIM_TYPES = ['lap_swimming', 'open_water_swimming', 'swimming'];
const GYM_TYPE = 'strength_training';
const RECOVERY_TYPES = [...SWIM_TYPES, GYM_TYPE];
const FATIGUE_CATEGORIES = ['OVERREACHING', 'STRAINED', 'UNPRODUCTIVE'];
const LAYOFF_DAYS = 6; // il piano alterna corsa e nuoto/palestra ogni 3-4 giorni: oltre 6 senza quel tipo di uscita è già un salto di ciclo, si rientra piano

// Contenuto e link presi dalle stesse zone FC/passo calibrate in corsa.html e
// nuoto.html per questo utente — qui non si inventano nuovi ritmi, si sceglie
// quale sessione già nota è la più indicata oggi.
// Struttura delle sedute di nuoto suggerite, la stessa che si invia a Garmin (blocchi: ripetizioni x metri).
const SB = (label, kind, reps, dist, extra) => ({ label, kind, reps, distance_m: dist, stroke: 'free', equipment: [], ...(extra || {}) });
const SWIM_SPECS = {
  tecnica: { sport: 'swimming', title: 'Tecnica + Soglia', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 6, 50, { stroke: 'drill', rest_s: 20, note: 'catch-up + pausa, battuta laterale, 6-1-6' }),
    SB('Soglia', 'interval', 6, 100, { rest_s: 20, intensity: 'threshold', note: '~1:45/100 m uniforme' }),
    SB('Pullbuoy contrasto', 'interval', 4, 100, { equipment: ['pull_buoy'], rest_s: 25, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  leggero: { sport: 'swimming', title: 'Scarico leggero', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }),
    SB('Drill', 'interval', 6, 50, { stroke: 'drill', rest_s: 20, note: 'solo tecnica' }),
    SB('Aerobico facile', 'interval', 4, 100, { rest_s: 20, intensity: 'easy' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  velocitaPura: { sport: 'swimming', title: 'Velocità pura', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 4, 50, { stroke: 'drill', rest_s: 20 }),
    SB('Progressivi', 'interval', 6, 50, { rest_s: 20, note: 'da aerobico a veloce dentro ogni 50 m' }),
    SB('Sprint', 'interval', 8, 50, { rest_s: 70, intensity: 'sprint', note: 'massimali, recupero completo' }),
    SB('Sprint con palette', 'interval', 4, 50, { equipment: ['paddles'], rest_s: 60, intensity: 'sprint' }),
    SB('Aerobico di scarico', 'interval', 6, 100, { rest_s: 25, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 200, { stroke: 'any' })] },
  sprintVirate: { sport: 'swimming', title: 'Sprint & Virate', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 4, 25, { stroke: 'drill', rest_s: 20 }),
    SB('Virate esplosive', 'interval', 10, 25, { rest_s: 50, intensity: 'sprint', note: 'spinta massimale dal muro + breakout' }),
    SB('Sprint pieno', 'interval', 8, 25, { rest_s: 60, intensity: 'sprint' }),
    SB('Aerobico di scarico', 'interval', 6, 100, { rest_s: 25, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  bracciataVelocita: { sport: 'swimming', title: 'Bracciata & Velocità', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 6, 25, { stroke: 'drill', rest_s: 20, note: 'catch-up e pugno chiuso' }),
    SB('Conteggio bracciate', 'interval', 8, 50, { rest_s: 20, intensity: 'aerobic', note: 'da aerobico a soglia, conta le bracciate ogni 25 m' }),
    SB('Velocità a bracciate controllate', 'interval', 10, 25, { rest_s: 45, intensity: 'sprint', note: 'non superare di +1 le bracciate del blocco precedente' }),
    SB('Aerobico', 'interval', 5, 100, { rest_s: 20, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
};
const RUN_SESSIONS = {
  velocita: {
    label: 'Velocità · 6×400 m',
    html: `Riscaldamento 15' Z1 (FC&nbsp;&lt;123) + 4×80&nbsp;m progressivi. Poi <strong>6×400&nbsp;m</strong> a 4:30–4:50/km (FC 162–172, Z4), recupero 90″ jogging Z1. Defaticamento 10' Z1.<br><span class="reco-opt-meta">~8 km · ~50–55 min · ~560 kcal</span>`,
    link: '/pianoallenamento/corsa.html#c-mar-vel',
  },
  soglia: {
    label: 'Soglia · 3×1000 m',
    html: `Riscaldamento 12' Z1. Poi <strong>3×1000&nbsp;m</strong> a 5:20–5:40/km (FC 148–162, Z3), recupero 2' jogging Z1, seguiti da 15' Z2 continuo (5:45–6:00/km). Defaticamento 8' Z1.<br><span class="reco-opt-meta">~9,5 km · ~55 min · ~540 kcal</span>`,
    link: '/pianoallenamento/corsa.html#c-mar-sog',
  },
  lungo: {
    label: 'Lunga Z2',
    html: `<strong>8–10&nbsp;km</strong> in Z2 puro, FC&nbsp;&lt;148, passo 5:45–6:10/km (fino a 6:30 se fa caldo). Se superi 148 cammina 1–2' e riprendi.<br><span class="reco-opt-meta">~60–70 min · ~620–680 kcal</span>`,
    link: '/pianoallenamento/corsa.html#c-sab-z2',
  },
  facile: {
    label: 'Facile rigenerante',
    html: `<strong>20–30 min</strong> di corsa lenta in Z1 (FC&nbsp;&lt;123, passo &gt;6:15/km), solo per sciogliere le gambe — oggi è recupero attivo, niente ritmo.`,
    link: '/pianoallenamento/corsa.html',
    spec: { sport: 'running', title: 'Corsa facile rigenerante', steps: [{ kind: 'interval', time_s: 1500, hr_zone: 1, note: 'Z1, FC sotto 123' }] },
  },
};
const SWIM_SESSIONS = {
  tecnica: {
    label: 'Tecnica + Soglia',
    html: `<strong>~2.000 m</strong>: 400 riscaldamento (300 crawl + 100 dorso) → 300 drill (6×50) → 600 soglia (6×100 a ~1:45/100m) → 400 pullbuoy contrasto (4×100) → 200 dorso → 100 defaticante.`,
    link: '/pianoallenamento/nuoto.html#sessA',
    spec: SWIM_SPECS.tecnica,
  },
  leggero: {
    label: 'Tecnica leggera (recupero attivo)',
    html: `<strong>1.200–1.500 m</strong> a ritmo facile/aerobico, solo drill e tecnica. Niente sprint né pullbuoy pesante: oggi l'acqua serve a scaricare, non a costruire.`,
    link: '/pianoallenamento/nuoto.html',
    spec: SWIM_SPECS.leggero,
  },
};
// Tre varianti di velocità (vasca corta 25 m), stesso obiettivo (fibre veloci)
// ma angolo diverso: si ruota per giorno dell'anno invece di ripetere sempre
// la stessa, che è esattamente la varietà chiesta.
const SWIM_VELOCITA_VARIANTS = [
  {
    label: 'Velocità pura',
    html: `<strong>~2.500 m</strong>: 400 riscaldamento → 200 drill → 300 progressivi (6×50) → 400 sprint massimali (8×50, rec. 60–75″) → 200 sprint con palette (4×50) → 600 aerobico di scarico → 200 dorso → 200 defaticante.`,
    link: '/pianoallenamento/nuoto.html#sessBdom',
    spec: SWIM_SPECS.velocitaPura,
  },
  {
    label: 'Sprint & Virate',
    html: `<strong>~1.850 m</strong>: 400 riscaldamento → 100 drill → 250 virate esplosive (10×25, spinta massimale + breakout) → 200 sprint pieno (8×25) → 600 aerobico di scarico → 200 dorso → 100 defaticante.`,
    link: '/pianoallenamento/nuoto.html#sessC',
    spec: SWIM_SPECS.sprintVirate,
  },
  {
    label: 'Bracciata & Velocità',
    html: `<strong>~2.000 m</strong>: 400 riscaldamento → 150 drill → 400 conteggio bracciate progressivo (8×50) → 250 sprint a bracciate controllate (10×25, vincolo di non aumentarle) → 500 aerobico di scarico → 200 dorso → 100 defaticante.`,
    link: '/pianoallenamento/nuoto.html#sessD',
    spec: SWIM_SPECS.bracciataVelocita,
  },
];
function pickVelocitaVariant() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((new Date() - start) / 86400000);
  return SWIM_VELOCITA_VARIANTS[dayOfYear % SWIM_VELOCITA_VARIANTS.length];
}
const GYM_NOTE = 'Se hai tempo, abbina una sessione di forza (Sessione A o B, quella che non fai da più giorni).';

async function fetchJSONSafe(path, fallback) {
  try {
    const res = await fetch(path.replace(/^\/data\/([\w-]+)\.json$/, '/lodestar/mydata.php?f=$1'), { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    return fallback;
  }
}

function daysSinceDate(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now - d) / 86400000);
}

function fmtDays(d) {
  if (d === Infinity) return 'più di 3 settimane';
  if (d === 0) return 'oggi stesso';
  if (d === 1) return '1 giorno';
  return `${d} giorni`;
}

function mostRecentOfType(activities, types) {
  return activities.find(a => types.includes(a.type)) || null;
}

// Classifica una corsa in base a cosa e' successo davvero nella seduta
// (distanza e passo dei lap), non a un'etichetta prestabilita.
function classifyRun(a) {
  const name = (a.name || '').toLowerCase();
  if (name.includes('fartlek')) return 'fartlek';
  if (name.includes('progressiv')) return 'progressivo';
  if (name.includes('piramide') || name.includes('ripetute lunghe')) return 'vo2';
  if (name.includes('ripetut')) return 'velocita';
  if (name.includes('soglia')) return 'soglia';
  const laps = a.laps || [];
  if (laps.length >= 4 && laps.some(l => l.avg_pace_min_per_km != null && l.avg_pace_min_per_km <= 5.0 && l.distance_m >= 70)) return 'velocita';
  if (a.distance_km != null && a.distance_km >= 7) return 'lungo';
  if (laps.length >= 2 && laps.some(l => l.avg_pace_min_per_km != null && l.avg_pace_min_per_km > 5.0 && l.avg_pace_min_per_km <= 5.75)) return 'soglia';
  return 'facile';
}

// Sprint in vasca vengono registrati come passo molto rapido in min/km
// (~1:25/100m equivale a ~14 min/km): distingue così velocità da tecnica.
function classifySwim(a) {
  const laps = a.laps || [];
  if (laps.length >= 6 && laps.some(l => l.avg_pace_min_per_km != null && l.avg_pace_min_per_km <= 16)) return 'velocita';
  return 'tecnica';
}

function daysSinceByClass(activities, types, classify) {
  const result = {};
  for (const a of activities) {
    if (!types.includes(a.type)) continue;
    const cls = classify(a);
    if (result[cls] === undefined) result[cls] = daysSinceDate(a.date);
  }
  return result;
}

// ── Tempi e obiettivi ──
function parseTimeToSec(text) {
  if (text == null) return null;
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function fmtClock(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// Passo in min/km (numero) -> "4:36"
function paceText(minPerKm) {
  const t = Math.round(minPerKm * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Obiettivi: di default ricavati da Garmin Connect (record personali, massimo di VO2max dell'ultimo
// anno, previsioni di gara). Un eventuale data/goals.json li sostituisce campo per campo, per esempio:
// {"race_5k":"23:30","race_10k":"50:00","vo2max":50,"repeat_pace":"4:15","swim_100":"1:35","deadline":"2026-12-02"}

async function loadGoals(fitness) {
  const file = await fetchJSONSafe('/data/goals.json', null);
  return buildGoals(fitness, file);
}

function buildGoals(fitness, file) {
  const pr = (fitness && fitness.personal_records) || {};
  const pred = (fitness && fitness.race_predictions) || {};
  const goals = { deadline: null, sources: {} };   // la scadenza arriva dal piano dell'utente (home.js)
  const year = v => (v && v.date ? ` (${v.date.slice(0, 4)})` : '');

  // 10 e 5 km: tornare al proprio record se oggi si e' piu' lenti; altrimenti migliorare del 1,5% il livello attuale.
  for (const [key, recKey, predKey, label] of [['race10k', 'run_10k_s', 'time_10k_s', '10 km'], ['race5k', 'run_5k_s', 'time_5k_s', '5 km']]) {
    const rec = pr[recKey], now = pred[predKey];
    if (rec && now && rec.value < now) { goals[key] = rec.value; goals.sources[key] = `tuo record sui ${label}${year(rec)}`; }
    else if (now) { goals[key] = Math.round(Math.min(now, rec ? rec.value : now) * 0.985); goals.sources[key] = `-1,5% sul tuo livello attuale`; }
  }
  // Ripetute: il ritmo del tuo record sul chilometro.
  if (pr.run_1k_s) { goals.repeatPace = pr.run_1k_s.value / 60; goals.sources.repeatPace = `ritmo del tuo record sul km${year(pr.run_1k_s)}`; }
  // VO2max: il massimo degli ultimi 12 mesi.
  const h = (fitness && fitness.vo2max_history) || [];
  if (h.length) {
    const peak = h.reduce((m, x) => (x.value > m.value ? x : m), h[0]);
    const now = fitness.vo2max_running || h[h.length - 1].value;
    goals.vo2max = peak.value > now ? peak.value : now + 1;
    goals.sources.vo2max = peak.value > now ? `tuo massimo degli ultimi 12 mesi (${actDateLabel(peak.date)})` : 'un punto sopra il livello attuale';
  }
  // Nuoto: il ritmo del tuo record sui 400 m.
  if (pr.swim_400m_s) { goals.swim100 = pr.swim_400m_s.value / 4; goals.sources.swim100 = `ritmo del tuo record sui 400 m${year(pr.swim_400m_s)}`; }

  if (file) {
    const t = x => parseTimeToSec(x);
    if (t(file.race_5k)) { goals.race5k = t(file.race_5k); goals.sources.race5k = 'obiettivo scelto da te'; }
    if (t(file.race_10k)) { goals.race10k = t(file.race_10k); goals.sources.race10k = 'obiettivo scelto da te'; }
    if (Number(file.vo2max)) { goals.vo2max = Number(file.vo2max); goals.sources.vo2max = 'obiettivo scelto da te'; }
    if (t(file.repeat_pace)) { goals.repeatPace = t(file.repeat_pace) / 60; goals.sources.repeatPace = 'obiettivo scelto da te'; }
    if (t(file.swim_100)) { goals.swim100 = t(file.swim_100); goals.sources.swim100 = 'obiettivo scelto da te'; }
    if (file.deadline) goals.deadline = file.deadline;
  }
  return goals;
}

// VO2max: andamento recente (ultimi ~4 mesi) e distanza dal massimo dell'ultimo anno.
function vo2Trend(fitness) {
  const h = fitness && fitness.vo2max_history;
  if (!h || h.length < 3) return null;
  const last = h[h.length - 1];
  const cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - 120);
  const start = h.find(x => new Date(x.date) >= cutoff) || h[0];
  const peak = h.reduce((m, x) => (x.value > m.value ? x : m), h[0]);
  return { last, start, peak, deltaRecent: last.value - start.value, daysRecent: Math.round((new Date(last.date) - new Date(start.date)) / 86400000) };
}

// ── Prontezza ──
// Parte dal punteggio di Training Readiness di Garmin (recupero, carico, FC); se manca, da una
// stima di 70. Garmin non vede il sonno misurato da Withings, quindi quello si somma a parte, con
// pesi moderati: un solo segnale negativo abbassa la prontezza, non la azzera.
function computeReadiness(fitness, sleepNights, hardRunDaysAgo) {
  const factors = [];
  let score;
  let source;
  const tr = fitness && fitness.training_readiness;
  if (tr && tr.score != null && daysSinceDate(tr.date) <= 1) {
    score = tr.score;
    source = 'Garmin';
    const fb = { WELL_RECOVERED: 'ben recuperato', PRIME: 'in forma ottima', RECOVERED: 'recuperato', LOW_RECOVERY: 'recupero basso', LET_YOUR_BODY_RECOVER: 'lascia recuperare il corpo' }[tr.feedback] || String(tr.feedback || '').toLowerCase().replace(/_/g, ' ');
    const recHours = tr.recovery_time_min != null ? Math.round(tr.recovery_time_min / 60) : null;
    const acwrFb = { GOOD: 'carico ottimale', MODERATE: 'carico moderato', HIGH: 'carico alto', POOR: 'carico eccessivo' }[tr.acwr_feedback];
    const bits = [fb, recHours != null && recHours >= 1 ? `recupero ${recHours} h` : null, tr.acute_load != null ? `carico acuto ${tr.acute_load}` : null, acwrFb].filter(Boolean);
    factors.push({ label: bits.length ? `Garmin (${bits.join(', ')})` : 'Garmin', value: tr.score });
  } else {
    score = 70;
    source = 'stima';
    factors.push({ label: 'base', value: 70 });
    const r = fitness && fitness.acwr_ratio;
    if (r != null) {
      const d = r > 1.5 ? -20 : (r > 1.3 ? -10 : (r < 0.8 ? 5 : 0));
      if (d) { score += d; factors.push({ label: `carico ${r.toFixed(2)}`, delta: d }); }
    }
  }

  const night = (sleepNights || [])[0];
  if (night && night.sleep_score != null && daysSinceDate(night.date) <= 2) {
    const s = night.sleep_score;
    let d = s >= 80 ? 3 : (s >= 65 ? 0 : (s >= 55 ? -4 : (s >= 40 ? -9 : -15)));
    if (night.total_sleep_time_min != null && night.total_sleep_time_min < 330 && d > -9) d -= 3;
    const prev = sleepNights[1];
    if (prev && prev.sleep_score != null && prev.sleep_score < 55 && s < 55 && daysSinceDate(prev.date) <= 4) d -= 4;
    if (d) { score += d; factors.push({ label: `sonno ${s}/100`, delta: d }); }
  }

  const rhr = fitness && fitness.resting_hr;
  if (rhr && rhr.length >= 6) {
    const latest = rhr[rhr.length - 1];
    const baseline = median(rhr.slice(0, -1).slice(-7).map(x => x.value));
    const diff = latest.value - baseline;
    const d = diff >= 10 ? -8 : (diff >= 6 ? -4 : (diff <= -3 ? 2 : 0));
    if (d) { score += d; factors.push({ label: `FC a riposo ${latest.value} (media ${Math.round(baseline)})`, delta: d }); }
  }

  if (hardRunDaysAgo === 1) { score -= 6; factors.push({ label: 'corsa di qualità ieri', delta: -6 }); }
  else if (hardRunDaysAgo === 2) { score -= 2; factors.push({ label: 'corsa di qualità 2 giorni fa', delta: -2 }); }

  const cat = fitness && fitness.training_status_category;
  if (cat === 'OVERREACHING' || cat === 'STRAINED') {
    if (score > 35) { factors.push({ label: `stato "${TRAINING_STATUS_LABELS_IT[cat]}"`, delta: 35 - score }); score = 35; }
  } else if (cat === 'UNPRODUCTIVE') { score -= 4; factors.push({ label: 'stato "Improduttivo"', delta: -4 }); }
  else if (cat === 'PEAKING') { score += 3; factors.push({ label: 'picco di forma', delta: 3 }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= 72 ? 'alta' : (score >= 55 ? 'media' : (score >= 40 ? 'bassa' : 'molto bassa'));
  return { score, band, source, factors };
}

// ── Seduta di corsa: parametri che salgono gradualmente ──
function lastRunOfClass(activities, cls) {
  return activities.find(a => RUN_TYPES.includes(a.type) && classifyRun(a) === cls) || null;
}

function workReps(a, minDist, maxPace, minPace) {
  const laps = (a.laps || []).filter(l => l.avg_pace_min_per_km != null && l.distance_m >= minDist
    && l.avg_pace_min_per_km <= maxPace && l.avg_pace_min_per_km >= minPace);
  if (!laps.length) return null;
  const dist = laps.reduce((s, l) => s + l.distance_m, 0);
  return {
    reps: laps.length,
    meters: median(laps.map(l => l.distance_m)),
    pace: laps.reduce((s, l) => s + l.avg_pace_min_per_km * l.distance_m, 0) / dist,
  };
}

function roundTo(x, step) { return Math.round(x / step) * step; }

function planVelocita(activities, band, goals) {
  const last = lastRunOfClass(activities, 'velocita');
  const w = last ? workReps(last, 150, 5.0, 3.5) : null;
  let reps = w ? w.reps : 6;
  const dist = w ? Math.max(200, roundTo(w.meters, 100)) : 400;
  let pace = w ? w.pace : 4.67;
  const baseReps = dist <= 250 ? 8 : 6;
  const cap = dist <= 250 ? 12 : (dist <= 450 ? 8 : 6);
  let progress = '';
  const lastText = w ? `${w.reps}×${dist} m a ${paceText(w.pace)}/km` : null;

  if (band === 'alta') {
    const paceFirst = goals && goals.repeatPace && pace > goals.repeatPace + 0.01 && reps >= baseReps;
    if (reps < cap && !paceFirst) { reps += 1; progress = `una ripetizione in più rispetto all'ultima volta (${lastText || 'prima seduta'})`; }
    else { pace -= 3 / 60; if (reps > baseReps && !paceFirst) reps = Math.max(baseReps, reps - 2); progress = `ritmo più veloce di 3″/km rispetto all'ultima volta (${lastText || 'prima seduta'})`; }
  } else {
    const r = Math.max(4, Math.ceil(reps * 0.7));
    progress = `volume ridotto (${r} invece di ${reps} ripetizioni) per i segnali di recupero non pieni: stesso ritmo`;
    reps = r;
  }
  const rest = dist <= 250 ? 80 : 90;
  const lo = paceText(pace - 3 / 60);
  const hi = paceText(pace + 3 / 60);
  const km = 2.7 + reps * (dist / 1000) * 1.7 + 1.5;
  const min = Math.round(15 + 2 + reps * ((dist / 1000) * pace + rest / 60) + 10);
  return {
    label: `Velocità · ${reps}×${dist} m`,
    html: `Riscaldamento 15' Z1 (FC&nbsp;&lt;123) + 4×80&nbsp;m progressivi. Poi <strong>${reps}×${dist}&nbsp;m</strong> a ${lo}–${hi}/km (FC 162–172, Z4), recupero ${rest}″ jogging Z1. Defaticamento 10' Z1.<br><span class="reco-opt-meta">~${km.toFixed(1).replace('.', ',')} km · ~${min} min</span>`,
    progress, link: '/pianoallenamento/corsa.html#c-mar-vel',
    spec: { sport: 'running', title: `Velocità ${reps}×${dist} m`, steps: [
      { kind: 'warmup', time_s: 900, hr_zone: 1 },
      { kind: 'repeat', reps: 4, steps: [{ kind: 'interval', distance_m: 80, note: 'progressivo' }, { kind: 'recovery', time_s: 40 }] },
      { kind: 'repeat', reps, steps: [{ kind: 'interval', distance_m: dist, pace: [Math.round(pace * 60) - 3, Math.round(pace * 60) + 3] }, { kind: 'recovery', time_s: rest, note: 'jogging Z1' }] },
      { kind: 'cooldown', time_s: 600, hr_zone: 1 }] },
  };
}

function planSoglia(activities, band) {
  const last = lastRunOfClass(activities, 'soglia');
  const w = last ? workReps(last, 700, 5.75, 5.0) : null;
  let reps = w ? w.reps : 3;
  const dist = w ? Math.max(800, roundTo(w.meters, 200)) : 1000;
  let pace = w ? w.pace : 5.5;
  const lastText = w ? `${w.reps}×${dist} m a ${paceText(w.pace)}/km` : null;
  let progress;
  if (band === 'alta') {
    if (reps < 5) { reps += 1; progress = `una ripetizione in più rispetto all'ultima volta (${lastText || 'prima seduta'})`; }
    else { pace -= 3 / 60; progress = `ritmo più veloce di 3″/km rispetto all'ultima volta (${lastText || 'prima seduta'})`; }
  } else {
    const r = Math.max(2, reps - 1);
    progress = `volume ridotto (${r} invece di ${reps} ripetizioni): stesso ritmo`;
    reps = r;
  }
  const lo = paceText(pace - 4 / 60);
  const hi = paceText(pace + 4 / 60);
  const km = 2.2 + reps * (dist / 1000) * 1.2 + 2.5 + 1.3;
  const min = Math.round(12 + reps * ((dist / 1000) * pace + 2) + 15 + 8);
  return {
    label: `Soglia · ${reps}×${dist} m`,
    html: `Riscaldamento 12' Z1. Poi <strong>${reps}×${dist}&nbsp;m</strong> a ${lo}–${hi}/km (FC 148–162, Z3), recupero 2' jogging Z1, seguiti da 15' Z2 continuo (5:45–6:00/km). Defaticamento 8' Z1.<br><span class="reco-opt-meta">~${km.toFixed(1).replace('.', ',')} km · ~${min} min</span>`,
    progress, link: '/pianoallenamento/corsa.html#c-mar-sog',
    spec: { sport: 'running', title: `Soglia ${reps}×${dist} m`, steps: [
      { kind: 'warmup', time_s: 720, hr_zone: 1 },
      { kind: 'repeat', reps, steps: [{ kind: 'interval', distance_m: dist, pace: [Math.round(pace * 60) - 4, Math.round(pace * 60) + 4] }, { kind: 'recovery', time_s: 120, note: 'jogging Z1' }] },
      { kind: 'interval', time_s: 900, pace: [345, 360], note: 'Z2 continuo' },
      { kind: 'cooldown', time_s: 480, hr_zone: 1 }] },
  };
}

function planLungo(activities, band) {
  const last = lastRunOfClass(activities, 'lungo');
  const lastKm = last ? last.distance_km : null;
  let km = 9;
  let progress;
  if (lastKm) {
    const hrOk = last.avg_hr == null || last.avg_hr <= 150;
    if (band === 'alta' && hrOk) { km = Math.min(14, Math.max(8, Math.round((lastKm + 1) * 2) / 2)); progress = `${km > lastKm ? 'un chilometro in più' : 'stessa distanza'} rispetto all'ultima lunga (${lastKm.toFixed(1).replace('.', ',')} km)`; }
    else { km = Math.max(8, Math.round(lastKm * 2) / 2); progress = hrOk ? `stessa distanza dell'ultima lunga (${lastKm.toFixed(1).replace('.', ',')} km), senza aumentare` : `l'ultima lunga aveva FC media ${last.avg_hr}: stessa distanza, resta davvero in Z2`; }
  } else {
    progress = 'prima lunga del ciclo';
  }
  const lo = Math.max(8, km - 1);
  const min = Math.round(km * 6.9);
  return {
    label: `Lunga Z2 · ${String(km).replace('.', ',')} km`,
    html: `<strong>${String(km).replace('.', ',')}&nbsp;km</strong> in Z2 puro, FC&nbsp;&lt;148, passo 5:45–6:10/km (fino a 6:30 se fa caldo). Se superi 148 cammina 1–2' e riprendi.<br><span class="reco-opt-meta">~${min} min · ~${Math.round(km * 70)} kcal</span>`,
    progress, link: '/pianoallenamento/corsa.html#c-sab-z2',
    spec: { sport: 'running', title: `Lunga Z2 ${String(km).replace('.', ',')} km`, steps: [{ kind: 'interval', distance_m: Math.round(km * 1000), pace: [345, 375], note: 'Z2, FC sotto 148' }] },
  };
}

// ── Tendenze e obiettivi ──
function monthsLabel(days) {
  return days >= 56 ? `${Math.round(days / 7)} settimane` : `${days} giorni`;
}

// ── Stato di forma: quanto spingere, e perché ──
// Combina prontezza, stato di allenamento Garmin, carico (ACWR) e VO2max in un fattore di volume
// (1 = scheda base) usato per ripetizioni e durate delle sedute di oggi.
function formProfile(fitness, readiness) {
  const reasons = [];
  let f = { alta: 1.0, media: 0.75, bassa: 0.6, 'molto bassa': 0.5 }[readiness.band];
  const cat = fitness && fitness.training_status_category;
  const adj = {
    PRODUCTIVE: [0.05, 'stato produttivo'], MAINTAINING: [0.1, 'stato di mantenimento: serve più stimolo'],
    PEAKING: [-0.1, 'picco di forma: meno volume, più qualità'], DETRAINING: [-0.15, 'ripresa graduale dopo il calo di forma'],
    UNPRODUCTIVE: [-0.05, 'stato improduttivo: stimolo diverso'], RECOVERY: [-0.2, 'fase di recupero'],
  }[cat];
  if (adj) { f += adj[0]; reasons.push(adj[1]); }
  const r = fitness && fitness.acwr_ratio;
  if (r != null) {
    if (r > 1.3) { f -= 0.15; reasons.push(`carico alto (${r.toFixed(2).replace('.', ',')})`); }
    else if (r < 0.8) { f += 0.1; reasons.push(`carico basso (${r.toFixed(2).replace('.', ',')}): c'è margine per salire`); }
  }
  f = Math.max(0.5, Math.min(1.2, f));
  return { factor: f, reasons, text: `${reasons.length ? reasons.join(', ') + '; ' : ''}volume ×${f.toFixed(2).replace('.', ',')}` };
}

// Ritmi di riferimento (s/km) dalle previsioni di gara di Garmin: seguono la forma del momento.
function racePaces(fitness) {
  const rp = fitness && fitness.race_predictions;
  return { p5: rp && rp.time_5k_s ? rp.time_5k_s / 5 : 300, p10: rp && rp.time_10k_s ? rp.time_10k_s / 10 : 322 };
}

function countOfClass(activities, cls) {
  return activities.filter(a => RUN_TYPES.includes(a.type) && classifyRun(a) === cls).length;
}

function rangeText(range) {
  return `${paceText(range[0] / 60)}–${paceText(range[1] / 60)}/km`;
}

// ── Fartlek: tre varianti a rotazione ──
function planFartlek(activities, band, form, paces) {
  const done = countOfClass(activities, 'fartlek');
  const variant = done % 3;
  const centre = band === 'alta' ? paces.p5 + 3 : paces.p10 - 2; // alta: ritmo 5 km; altrimenti ritmo 10 km
  const pr = [Math.round(centre - 4), Math.round(centre + 4)];
  const steps = [{ kind: 'warmup', time_s: 720, hr_zone: 1 }];
  let title, body, minutes;

  if (variant === 0) {
    const reps = Math.max(4, Math.min(10, Math.round((6 + Math.min(done, 3)) * form.factor)));
    steps.push({ kind: 'repeat', reps, steps: [{ kind: 'interval', time_s: 120, pace: pr }, { kind: 'recovery', time_s: 60, note: 'corsa lenta Z1' }] });
    title = `Fartlek ${reps}×(2′ + 1′)`;
    body = `<strong>${reps}×(2' veloce + 1' lento)</strong>: i 2' a ${rangeText(pr)} (${band === 'alta' ? 'ritmo da 5 km' : 'ritmo da 10 km'}), l'1' in corsa lenta Z1`;
    minutes = 12 + reps * 3 + 10;
  } else if (variant === 1) {
    const ups = form.factor >= 0.85 ? [60, 120, 180, 240, 180, 120, 60] : [60, 120, 180, 120, 60];
    ups.forEach(t => {
      steps.push({ kind: 'interval', time_s: t, pace: pr });
      steps.push({ kind: 'recovery', time_s: Math.max(45, Math.round(t / 2)), note: 'lento' });
    });
    title = `Fartlek a piramide ${ups.map(t => t / 60).join('-')}`;
    body = `<strong>Piramide ${ups.map(t => t / 60 + "'").join(' · ')}</strong> veloci a ${rangeText(pr)}, con recupero lento pari alla metà del tratto veloce`;
    minutes = 12 + Math.round(ups.reduce((s, t) => s + t * 1.5, 0) / 60) + 10;
  } else {
    const reps = Math.max(6, Math.min(12, Math.round(10 * form.factor)));
    const sh = [Math.round(paces.p5 - 6), Math.round(paces.p5 + 2)];
    steps.push({ kind: 'repeat', reps, steps: [{ kind: 'interval', time_s: 30, pace: sh }, { kind: 'recovery', time_s: 90, note: 'lento' }] });
    title = `Fartlek di allunghi ${reps}×30″`;
    body = `<strong>${reps}×(30″ forte + 90″ lento)</strong>: gli allunghi a ${rangeText(sh)}, sciolti e rilassati, il resto in corsa lenta`;
    minutes = 12 + reps * 2 + 10;
  }
  steps.push({ kind: 'cooldown', time_s: 600, hr_zone: 1 });
  return {
    label: title,
    html: `Riscaldamento 12' Z1 (FC&nbsp;&lt;123). Poi ${body}. Defaticamento 10' Z1.<br><span class="reco-opt-meta">~${minutes} min · variante ${variant + 1} di 3</span>`,
    progress: done ? `tu hai già fatto ${done} fartlek: ${variant === 0 ? 'si riparte dal classico 2′/1′ con una ripetizione in più' : 'oggi cambia la variante per non ripetere lo stesso stimolo'}` : 'prima volta: si parte da una variante semplice',
    link: '/pianoallenamento/corsa.html', spec: { sport: 'running', title, steps },
  };
}

// ── Progressivo: tre blocchi a ritmo crescente ──
function planProgressivo(band, form, paces) {
  const total = Math.max(30, Math.min(60, 5 * Math.round(45 * form.factor / 5)));
  const z2 = Math.round(total * 0.45), mid = Math.round(total * 0.33), thr = total - z2 - mid;
  const midP = [Math.round(paces.p10 + 14), Math.round(paces.p10 + 26)];
  const thrP = [Math.round(paces.p10 - 4), Math.round(paces.p10 + 6)];
  const title = `Progressivo ${total}′`;
  return {
    label: title,
    html: `Riscaldamento 10' Z1. Poi <strong>${total}' progressivi</strong>: ${z2}' in Z2 (5:45–6:15/km) → ${mid}' a ritmo medio (${rangeText(midP)}) → ${thr}' a ritmo da 10 km (${rangeText(thrP)}). Defaticamento 8' Z1.<br><span class="reco-opt-meta">~${total + 18} min · FC in salita da Z2 a Z3</span>`,
    progress: 'ritmi ricavati dalle previsioni di gara di Garmin di oggi, quindi seguono la tua forma',
    link: '/pianoallenamento/corsa.html',
    spec: { sport: 'running', title, steps: [
      { kind: 'warmup', time_s: 600, hr_zone: 1 },
      { kind: 'interval', time_s: z2 * 60, pace: [345, 375], note: 'Z2' },
      { kind: 'interval', time_s: mid * 60, pace: midP, note: 'ritmo medio' },
      { kind: 'interval', time_s: thr * 60, pace: thrP, note: 'ritmo da 10 km' },
      { kind: 'cooldown', time_s: 480, hr_zone: 1 }] },
  };
}

// ── Ripetute lunghe / piramide (stimolo da VO2max) ──
function planVo2(activities, band, form, paces) {
  const done = countOfClass(activities, 'vo2');
  const pyramid = done % 2 === 1;
  const steps = [{ kind: 'warmup', time_s: 720, hr_zone: 1 }];
  let title, body, minutes;
  if (!pyramid) {
    const reps = Math.max(3, Math.min(6, Math.round((4 + Math.min(done, 2)) * form.factor)));
    const pr = [Math.round(paces.p5 + 2 - 4), Math.round(paces.p5 + 2 + 4)];
    steps.push({ kind: 'repeat', reps, steps: [{ kind: 'interval', distance_m: 1000, pace: pr }, { kind: 'recovery', time_s: 150, note: 'jogging Z1' }] });
    title = `Ripetute lunghe ${reps}×1000 m`;
    body = `<strong>${reps}×1000&nbsp;m</strong> a ${rangeText(pr)} (ritmo da 5 km), recupero 2'30″ jogging Z1`;
    minutes = 12 + reps * (Math.round((paces.p5 + 2) / 60 * 10) / 10 + 2.5) + 10;
  } else {
    const ds = form.factor >= 0.85 ? [400, 800, 1200, 800, 400] : [400, 800, 800, 400];
    const offset = { 400: -8, 800: -2, 1200: 3 };
    ds.forEach(d => {
      const c = paces.p5 + offset[d];
      steps.push({ kind: 'interval', distance_m: d, pace: [Math.round(c - 3), Math.round(c + 3)] });
      steps.push({ kind: 'recovery', time_s: d <= 400 ? 90 : (d <= 800 ? 120 : 150), note: 'jogging Z1' });
    });
    title = `Piramide ${ds.join('-')}`;
    body = `<strong>Piramide ${ds.join(' – ')} m</strong> a ritmo da 5 km (più veloce sui 400, più controllato sui 1200), recuperi di 90″–2'30″ in jogging`;
    minutes = 12 + Math.round(ds.reduce((s, d) => s + d / 1000 * paces.p5 / 60 + 1.8, 0)) + 10;
  }
  steps.push({ kind: 'cooldown', time_s: 600, hr_zone: 1 });
  return {
    label: title,
    html: `Riscaldamento 12' Z1 + 4×80&nbsp;m progressivi. Poi ${body}. Defaticamento 10' Z1.<br><span class="reco-opt-meta">~${Math.round(minutes)} min · FC 162–172 (Z4)</span>`,
    progress: done ? `alterna con ${pyramid ? 'le ripetute lunghe' : 'la piramide'} per non ripetere lo stesso stimolo` : 'stimolo diverso dalle ripetute corte: tempo più a lungo vicino al VO2max',
    link: '/pianoallenamento/corsa.html', spec: { sport: 'running', title, steps },
  };
}

// ── Scelta del tipo di qualità: a rotazione, mai due volte di fila lo stesso ──
const QUALITY_TYPES = ['velocita', 'soglia', 'fartlek', 'progressivo', 'vo2'];

function pickQuality(runGaps, lastQuality, band, fitness, goals, vo2Push) {
  const cat = fitness && fitness.training_status_category;
  let best = null;
  for (const t of QUALITY_TYPES) {
    let sc = Math.min(30, runGaps[t] ?? 30);
    if (t === lastQuality) sc -= 100;
    if (vo2Push && (t === 'velocita' || t === 'vo2')) sc += 6;
    if (vo2Push && t === 'fartlek') sc += 3;
    if (goals && goals.race10k && (t === 'soglia' || t === 'progressivo')) sc += 3;
    if (goals && goals.repeatPace && t === 'velocita') sc += 3;
    if (band === 'media' && (t === 'velocita' || t === 'vo2')) sc -= 6;
    if (cat === 'DETRAINING' && (t === 'velocita' || t === 'vo2')) sc -= 8;
    if (best === null || sc > best.sc) best = { t, sc };
  }
  return best.t;
}

// ── Nuoto: più famiglie di sedute, adattate alla forma ──
const SWIM_EXTRA_SPECS = {
  resistenza: { sport: 'swimming', title: 'Resistenza aerobica', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 4, 50, { stroke: 'drill', rest_s: 20 }),
    SB('Aerobico continuo', 'interval', 3, 400, { rest_s: 30, intensity: 'aerobic', note: 'respiro ogni 3, bracciata lunga' }),
    SB('Pull', 'interval', 4, 100, { equipment: ['pull_buoy'], rest_s: 20, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  gambePull: { sport: 'swimming', title: 'Gambe e pull', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Gambe con pinne', 'interval', 6, 50, { stroke: 'any', equipment: ['fins', 'kickboard'], rest_s: 20, note: 'gambe, tavola davanti' }),
    SB('Gambe senza pinne', 'interval', 4, 50, { stroke: 'any', equipment: ['kickboard'], rest_s: 25, note: 'gambe' }),
    SB('Pull e palette', 'interval', 6, 100, { equipment: ['pull_buoy', 'paddles'], rest_s: 20, intensity: 'aerobic' }),
    SB('Aerobico libero', 'interval', 4, 100, { rest_s: 20, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  piramide: { sport: 'swimming', title: 'Piramide', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 4, 50, { stroke: 'drill', rest_s: 20 }),
    ...[50, 100, 150, 200, 150, 100, 50].map(d => SB(`Piramide ${d}`, 'interval', 1, d, { rest_s: 20, intensity: 'aerobic' })),
    SB('Sprint', 'interval', 4, 50, { rest_s: 45, intensity: 'fast' }),
    SB('Aerobico', 'interval', 4, 100, { rest_s: 20, intensity: 'aerobic' }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
  misti: { sport: 'swimming', title: 'Misti e stili', blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }), SB('Riscaldamento dorso', 'warmup', 1, 100, { stroke: 'back' }),
    SB('Drill', 'interval', 4, 50, { stroke: 'drill', rest_s: 20, note: 'un drill per stile' }),
    SB('Misti', 'interval', 4, 100, { stroke: 'im', rest_s: 25 }),
    SB('Dorso', 'interval', 4, 50, { stroke: 'back', rest_s: 20 }), SB('Rana', 'interval', 4, 50, { stroke: 'breast', rest_s: 20 }),
    SB('Stile libero con pull', 'interval', 4, 100, { equipment: ['pull_buoy'], rest_s: 20, intensity: 'aerobic' }),
    SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] },
};
const SWIM_ALL_SPECS = { ...SWIM_SPECS, ...SWIM_EXTRA_SPECS };
const SWIM_LINKS = { tecnica: '/pianoallenamento/nuoto.html#sessA', velocitaPura: '/pianoallenamento/nuoto.html#sessBdom', sprintVirate: '/pianoallenamento/nuoto.html#sessC', bracciataVelocita: '/pianoallenamento/nuoto.html#sessD' };
const SWIM_FAMILIES = [
  { key: 'tecnica', match: ['soglia'] }, { key: 'resistenza', match: ['resistenza'] },
  { key: 'gambePull', match: ['gambe'] }, { key: 'piramide', match: ['piramide'] }, { key: 'misti', match: ['misti'] },
];
const SWIM_EQ_IT = { fins: 'pinne', kickboard: 'tavola', paddles: 'palette', pull_buoy: 'pull', snorkel: 'snorkel' };

function dayOfYear() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  return Math.floor((new Date() - start) / 86400000);
}

// Famiglia di nuoto meno recente (dal nome delle attivita'), a pari merito si ruota per giorno.
function pickSwimFamily(activities) {
  const swims = activities.filter(a => SWIM_TYPES.includes(a.type));
  const gaps = SWIM_FAMILIES.map(fam => {
    const hit = swims.find(a => fam.match.some(m => (a.name || '').toLowerCase().includes(m)));
    return { key: fam.key, gap: hit ? daysSinceDate(hit.date) : Infinity };
  });
  const maxGap = Math.max(...gaps.map(g => g.gap));
  const tied = gaps.filter(g => g.gap === maxGap);
  return tied[dayOfYear() % tied.length].key;
}

function swimHtml(spec) {
  const total = spec.blocks.reduce((s, b) => s + b.reps * b.distance_m, 0);
  const parts = spec.blocks.map(b => `${b.reps > 1 ? b.reps + '×' : ''}${b.distance_m} ${b.label.toLowerCase()}${b.equipment && b.equipment.length ? ` (${b.equipment.map(e => SWIM_EQ_IT[e] || e).join(' + ')})` : ''}`);
  return `<strong>~${total.toLocaleString('it-IT')} m</strong>: ${parts.join(' → ')}.`;
}

// Adatta la seduta alla forma: ripetizioni dei blocchi principali scalate (±) e ritmo di soglia dall'ultima nuotata.
function buildSwimSession(key, form, activities) {
  const base = SWIM_ALL_SPECS[key];
  const last = activities.find(a => SWIM_TYPES.includes(a.type) && (a.distance_km || 0) >= 0.8);
  const st = last && swimLapStats(last);
  const thr = st ? fmtSwimPace100(st.median * 0.985) : null;
  const f = form.factor;
  const blocks = base.blocks.map(b => {
    const nb = { ...b };
    const main = b.kind === 'interval' && b.stroke !== 'drill' && !/dorso|rana/i.test(b.label) && b.reps >= 4;
    if (main && Math.abs(f - 1) > 0.05) nb.reps = Math.max(Math.max(2, b.reps - 3), Math.min(b.reps + 2, Math.round(b.reps * f)));
    if (b.intensity === 'threshold' && thr) nb.note = `ritmo ~${thr}`;
    return nb;
  });
  const spec = { ...base, blocks };
  return { label: spec.title, html: swimHtml(spec), link: SWIM_LINKS[key] || '/pianoallenamento/nuoto.html', spec };
}

function computeTrends(activities, fitness, goals) {
  const lines = [];
  const f1 = x => x.toFixed(1).replace('.', ',');
  const v = vo2Trend(fitness);
  if (v) {
    let txt = `VO2max ${f1(v.last.value)}`;
    if (v.daysRecent >= 14) txt += `: ${v.deltaRecent >= 0 ? '+' : ''}${f1(v.deltaRecent)} in ${monthsLabel(v.daysRecent)} (${f1(v.start.value)} → ${f1(v.last.value)})`;
    if (v.peak.value - v.last.value >= 1) txt += `, ${f1(v.peak.value - v.last.value)} sotto il tuo massimo di ${f1(v.peak.value)} (${actDateLabel(v.peak.date)})`;
    lines.push(txt);
  }
  const rp = fitness && fitness.race_predictions;
  const rph = fitness && fitness.race_predictions_history;
  if (rp && rp.time_10k_s) {
    let txt = `10 km previsti da Garmin ${fmtClock(rp.time_10k_s)}`;
    if (rph && rph.length >= 2) {
      const base = rph[0];
      const diff = rp.time_10k_s - base.time_10k_s;
      txt += ` (${diff <= 0 ? '' : '+'}${Math.round(diff)}″ da ${actDateLabel(base.date)})`;
    }
    lines.push(txt);
  }
  const reps = activities.filter(a => RUN_TYPES.includes(a.type) && classifyRun(a) === 'velocita')
    .map(a => ({ date: a.date, w: workReps(a, 150, 5.0, 3.5) })).filter(x => x.w && x.w.reps >= 3);
  if (reps.length >= 2) {
    const newest = reps[0], oldest = reps[reps.length - 1];
    lines.push(`ripetute ${paceText(oldest.w.pace)} → ${paceText(newest.w.pace)}/km (${actDateLabel(oldest.date)} → ${actDateLabel(newest.date)})`);
  }

  const goalLines = [];
  if (goals) {
    const src = k => (goals.sources && goals.sources[k] ? ` · ${goals.sources[k]}` : '');
    const pct = (a, b) => `${(100 * (a - b) / a).toFixed(1).replace('.', ',')}%`;
    if (goals.race10k && rp && rp.time_10k_s) goalLines.push(`10 km in ${fmtClock(goals.race10k)}${src('race10k')}: oggi ${fmtClock(rp.time_10k_s)}, mancano ${fmtClock(Math.max(0, rp.time_10k_s - goals.race10k))} (${pct(rp.time_10k_s, goals.race10k)})`);
    if (goals.race5k && rp && rp.time_5k_s) goalLines.push(`5 km in ${fmtClock(goals.race5k)}${src('race5k')}: oggi ${fmtClock(rp.time_5k_s)}, mancano ${fmtClock(Math.max(0, rp.time_5k_s - goals.race5k))}`);
    if (goals.repeatPace && reps.length) goalLines.push(`ripetute a ${paceText(goals.repeatPace)}/km${src('repeatPace')}: ultime ${paceText(reps[0].w.pace)}/km`);
    if (goals.vo2max && fitness && fitness.vo2max_running) goalLines.push(`VO2max ${f1(goals.vo2max)}${src('vo2max')}: mancano ${f1(Math.max(0, goals.vo2max - fitness.vo2max_running))}`);
    if (goals.deadline) goalLines.push(`scadenza: ${actDateLabel(goals.deadline)}`);
  }
  return { lines, goalLines };
}

function swimProgressNote(activities, band) {
  const swims = activities.filter(a => SWIM_TYPES.includes(a.type) && (a.distance_km || 0) >= 0.8);
  if (!swims.length) return '';
  const last = swims[0];
  const st = swimLapStats(last);
  const meters = Math.round((last.distance_km || 0) * 1000);
  if (!st) return `Ultima nuotata: ${meters} m.`;
  const next = band === 'alta' ? Math.min(3000, Math.round((meters + 100) / 50) * 50) : meters;
  return `Ultima nuotata: ${meters} m con ritmo mediano ${fmtSwimPace100(st.median)}. ${band === 'alta' ? `Oggi punta a ~${next} m, mantenendo o migliorando di 1″ il ritmo sulle ripetute.` : 'Oggi mantieni volume e ritmo: nessun aumento.'}`;
}

function computeRecommendation(activities, fitness, sleepNights, goals) {
  const recentRun = mostRecentOfType(activities, RUN_TYPES);
  const recentRecovery = mostRecentOfType(activities, RECOVERY_TYPES);
  const daysSinceRun = recentRun ? daysSinceDate(recentRun.date) : Infinity;
  const daysSinceRecovery = recentRecovery ? daysSinceDate(recentRecovery.date) : Infinity;
  const lastRunClass = recentRun ? classifyRun(recentRun) : null;
  const lastRunWasHard = !!(recentRun && lastRunClass !== 'facile');
  const hardRunDaysAgo = lastRunWasHard ? daysSinceRun : null;

  const readiness = computeReadiness(fitness, sleepNights, hardRunDaysAgo);
  const band = readiness.band;
  const recoveryMode = band === 'molto bassa';
  const lowMode = band === 'bassa';
  const justRanHard = lastRunWasHard && daysSinceRun <= 1;

  const runLayoff = daysSinceRun >= LAYOFF_DAYS;
  const swimLayoff = daysSinceRecovery >= LAYOFF_DAYS;

  let preferred;
  let rationale;
  if (recoveryMode) {
    preferred = 'nuoto';
    rationale = 'Prontezza molto bassa: oggi niente corsa, solo scarico.';
  } else if (justRanHard && band !== 'alta') {
    preferred = 'nuoto';
    rationale = `Hai corso con qualità ${daysSinceRun === 0 ? 'oggi' : 'ieri'}: dopo uno sforzo duro meglio alternare con acqua o pesi.`;
  } else if (daysSinceRun !== daysSinceRecovery) {
    preferred = daysSinceRun > daysSinceRecovery ? 'corsa' : 'nuoto';
    rationale = preferred === 'corsa'
      ? `Non corri da ${fmtDays(daysSinceRun)}, contro ${fmtDays(daysSinceRecovery)} per nuoto/palestra: la corsa è l'attività più indietro.`
      : `Non fai nuoto/palestra da ${fmtDays(daysSinceRecovery)}, contro ${fmtDays(daysSinceRun)} per la corsa: oggi tocca ad acqua/pesi.`;
  } else {
    preferred = 'corsa';
    rationale = 'La frequenza di corsa e nuoto/palestra delle ultime settimane è equilibrata: via libera a entrambe, scegli in base a come ti senti.';
  }

  const runGaps = daysSinceByClass(activities, RUN_TYPES, classifyRun);
  const v2 = vo2Trend(fitness);
  const vo2Push = !!(v2 && (v2.peak.value - v2.last.value >= 2 || (v2.daysRecent >= 28 && v2.deltaRecent <= 0.3)));
  const focusSpeed = !!(goals && (goals.repeatPace || goals.vo2max)) || vo2Push;
  const form = formProfile(fitness, readiness);
  const paces = racePaces(fitness);
  const lastQualityRun = activities.find(a => RUN_TYPES.includes(a.type) && QUALITY_TYPES.includes(classifyRun(a)));
  const lastQuality = lastQualityRun ? classifyRun(lastQualityRun) : null;
  let runChoice;
  if (recoveryMode || runLayoff) runChoice = 'facile';
  else if (lowMode || (justRanHard && band !== 'alta')) runChoice = 'base';
  else if ((runGaps.lungo ?? Infinity) >= 6) runChoice = 'lungo';
  else runChoice = pickQuality(runGaps, lastQuality, band, fitness, goals, vo2Push);

  let run;
  if (runChoice === 'velocita') run = planVelocita(activities, band, goals);
  else if (runChoice === 'soglia') run = planSoglia(activities, band);
  else if (runChoice === 'fartlek') run = planFartlek(activities, band, form, paces);
  else if (runChoice === 'progressivo') run = planProgressivo(band, form, paces);
  else if (runChoice === 'vo2') run = planVo2(activities, band, form, paces);
  else if (runChoice === 'lungo') run = planLungo(activities, band);
  else if (runChoice === 'base') run = {
    label: 'Corsa aerobica Z2',
    html: `<strong>35–45 min</strong> in Z2, FC&nbsp;&lt;148, passo 5:45–6:10/km, senza ritmo né ripetute: oggi si costruisce base senza accumulare fatica.`,
    link: '/pianoallenamento/corsa.html#c-sab-z2',
    spec: { sport: 'running', title: 'Corsa aerobica Z2', steps: [{ kind: 'interval', time_s: 2400, pace: [345, 375], note: 'Z2, FC sotto 148' }] },
  };
  else run = RUN_SESSIONS.facile;

  const swimGaps = daysSinceByClass(activities, SWIM_TYPES, classifySwim);
  const swimChoice = (recoveryMode || lowMode || swimLayoff)
    ? (swimLayoff && !recoveryMode && !lowMode ? 'tecnica' : 'leggero')
    : ((swimGaps.velocita ?? Infinity) > (swimGaps.tecnica ?? Infinity) ? 'velocita' : 'tecnica');
  let swim;
  if (swimChoice === 'leggero') swim = SWIM_SESSIONS.leggero;
  else if (swimChoice === 'velocita') swim = buildSwimSession(['velocitaPura', 'sprintVirate', 'bracciataVelocita'][dayOfYear() % 3], form, activities);
  else swim = buildSwimSession(swimLayoff ? 'tecnica' : pickSwimFamily(activities), form, activities);

  const runNote = runLayoff
    ? `Rientro dopo una pausa di ${fmtDays(daysSinceRun)}: oggi si riparte facile, non con lunga o qualità.`
    : ((run.progress ? `Progressione: ${run.progress}.` : '') + (['velocita', 'vo2'].includes(runChoice) && vo2Push ? ' Il VO2max è sotto il tuo massimo: questo è lo stimolo che lo fa salire.' : '') + (['velocita', 'soglia', 'fartlek', 'progressivo', 'vo2', 'lungo'].includes(runChoice) ? ` Adattata allo stato di forma: ${form.text}.` : '')).trim();
  const swimNote = swimLayoff && !recoveryMode
    ? `Rientro dopo una pausa di ${fmtDays(daysSinceRecovery)}: oggi tecnica, non sprint.`
    : ((recoveryMode || lowMode) ? '' : [swimProgressNote(activities, band), `Adattata allo stato di forma: ${form.text}.`, GYM_NOTE].filter(Boolean).join(' '));

  const trends = computeTrends(activities, fitness, goals);
  return { preferred, rationale, recoveryMode, readiness, form, run, swim, runNote, swimNote, trends, runChoice, swimChoice };
}

function renderRecommendation(model) {
  const box = document.getElementById('reco-box');
  const prefIcon = model.preferred === 'corsa' ? '🏃' : '🏊';
  const prefLabel = model.preferred === 'corsa' ? 'Corsa' : 'Nuoto / Palestra';
  const r = model.readiness;
  const parts = r.factors.map(f => f.value != null ? `${f.label} ${f.value}` : `${f.label} ${f.delta > 0 ? '+' : '−'}${Math.abs(f.delta)}`).join(' · ');
  const bandText = { alta: 'alta: seduta di qualità con progressione', media: 'media: qualità a volume ridotto', bassa: 'bassa: lavoro aerobico, niente ripetute', 'molto bassa': 'molto bassa: solo scarico' }[r.band];
  const trendLines = model.trends.lines.length ? `<div class="reco-sig"><b>Andamento</b> ${model.trends.lines.join(' · ')}</div>` : '';
  const goalLines = model.trends.goalLines.length ? `<div class="reco-sig"><b>Obiettivi</b> ${model.trends.goalLines.join(' · ')}</div>` : '';
  box.innerHTML = `
    <div class="reco-head">
      <div class="reco-icon">${prefIcon}</div>
      <div>
        <div class="reco-title">Attività preferibile in base alle ultime settimane: ${prefLabel}</div>
        <div class="reco-text">${model.rationale}</div>
      </div>
    </div>
    <div class="reco-signals">
      <div class="reco-sig"><b>Forma di oggi: ${bandText}</b><div class="reco-sig-detail">Dipende da: ${parts}</div></div>
      ${trendLines}${goalLines}
    </div>
    <div class="reco-options">
      <div class="reco-opt${model.preferred === 'corsa' ? ' reco-opt-pref' : ''}">
        <div class="reco-opt-hdr">🏃 Se opti per la corsa <span class="reco-opt-tag">${model.run.label}</span>${model.run.by ? `<span class="reco-opt-tag">📚 Libreria · ${model.run.by}</span>` : ''}</div>
        <div class="reco-opt-body">${model.run.html}</div>
        ${model.runNote ? `<div class="reco-opt-note">${model.runNote}</div>` : ''}
        <a class="reco-link" href="${model.run.link}">Dettaglio scheda →</a>
        <div class="reco-send" data-sport="run"></div>
      </div>
      <div class="reco-opt${model.preferred === 'nuoto' ? ' reco-opt-pref' : ''}">
        <div class="reco-opt-hdr">🏊 Se opti per nuoto/palestra <span class="reco-opt-tag">${model.swim.label}</span>${model.swim.by ? `<span class="reco-opt-tag">📚 Libreria · ${model.swim.by}</span>` : ''}</div>
        <div class="reco-opt-body">${model.swim.html}</div>
        ${model.swimNote ? `<div class="reco-opt-note">${model.swimNote}</div>` : ''}
        <a class="reco-link" href="${model.swim.link}">Dettaglio scheda →</a>
        <div class="reco-send" data-sport="swim"></div>
      </div>
    </div>
    ${model.gym ? `<div class="reco-opt" style="margin-top:14px">
        <div class="reco-opt-hdr">💪 In più, forza <span class="reco-opt-tag">${model.gym.label}</span>${model.gym.by && model.gym.by !== 'Lodestar' ? `<span class="reco-opt-tag">📚 Libreria · ${model.gym.by}</span>` : ''}</div>
        <div class="reco-opt-body">${model.gym.html}</div>
        <a class="reco-link" href="${model.gym.link}">Apri in libreria →</a>
        <div class="reco-send" data-sport="gym"></div>
      </div>` : ''}`;
}

// Pulsante "Invia all'orologio" sotto ogni seduta consigliata: crea l'allenamento su Garmin Connect e lo
// mette in calendario (poi arriva sull'orologio alla sincronizzazione). Solo per il titolare dell'account Garmin.
function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function todayISO() { return isoLocal(new Date()); }

async function attachSendButtons(model) {
  try {
    const res = await fetch('/coach-api.php?action=mine', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const info = await res.json();
    if (!info.can_send) return;
    for (const [key, plan] of [['run', model.run], ['swim', model.swim], ['gym', model.gym]]) {
      const slot = document.querySelector(`.reco-send[data-sport="${key}"]`);
      if (!slot || !plan || !plan.spec) continue;
      slot.innerHTML = '<input type="date" class="reco-date" title="Giorno in calendario"> <button type="button" class="cw-btn">Invia all\'orologio</button> <span class="reco-send-msg"></span>';
      const dateInput = slot.querySelector('.reco-date');
      const btn = slot.querySelector('button');
      const msg = slot.querySelector('.reco-send-msg');
      dateInput.value = isoLocal(new Date());
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        msg.textContent = 'Invio a Garmin in corso…';
        try {
          const r = await fetch('/coach-api.php?action=send_plan', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF': info.csrf },
            body: JSON.stringify({ plan: plan.spec, date: dateInput.value || null }),
          });
          const out = await r.json();
          if (!r.ok) throw new Error(out.error || 'Errore ' + r.status);
          msg.textContent = '✅ Inviato' + (out.scheduled ? ' e messo in calendario' : '') + ': sull\'orologio dopo la sincronizzazione.';
        } catch (e) {
          msg.textContent = e.message;
          btn.disabled = false;
        }
      });
    }
  } catch (err) {
    console.warn('Pulsante di invio non disponibile:', err);
  }
}
