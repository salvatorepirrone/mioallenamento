// Lodestar — generatore del piano personalizzato.
// Dato un evento (o una data di fine), le attività praticate e i giorni disponibili costruisce un piano a settimane:
// fasi (base, sviluppo, picco, scarico), volumi che salgono al massimo del ~10% a settimana con una settimana di scarico ogni quarta,
// sedute prese dallo stile della libreria. Parte dal livello reale (ultime settimane su Garmin) e dai ritmi previsti da Garmin.

const PLAN_ROLE_LABEL = { easy: 'Corsa facile', long: 'Lungo', quality: 'Qualità', swim: 'Nuoto', gym: 'Palestra', event: 'Evento' };

function isoAdd(iso, days) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoLocal(d); }
function mondayOf(iso) { const d = new Date(iso + 'T12:00:00'); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoLocal(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

// Livello di partenza dalle ultime 4 settimane di attività.
function planBaseline(activities) {
  const last = activities.filter(a => daysSinceDate(a.date) >= 0 && daysSinceDate(a.date) < 28);
  const runs = last.filter(a => RUN_TYPES.includes(a.type));
  const swims = last.filter(a => SWIM_TYPES.includes(a.type));
  return {
    runKm: runs.reduce((s, a) => s + (a.distance_km || 0), 0) / 4,
    longRunKm: runs.reduce((m, a) => Math.max(m, a.distance_km || 0), 0),
    swimM: swims.reduce((s, a) => s + (a.distance_km || 0) * 1000, 0) / 4,
    longSwimM: swims.reduce((m, a) => Math.max(m, (a.distance_km || 0) * 1000), 0),
  };
}

// Ritmo (s/km) a cui si prevede di correre la distanza dell'evento.
function eventPace(fitness, distKm) {
  const rp = (fitness && fitness.race_predictions) || {};
  const p = racePaces(fitness);
  if (distKm <= 5.5) return p.p5;
  if (distKm <= 11) return p.p10;
  if (distKm <= 22 && rp.time_half_s) return rp.time_half_s / 21.0975;
  if (distKm <= 22) return p.p10 + 10;
  if (rp.time_marathon_s) return rp.time_marathon_s / 42.195;
  return p.p10 + 25;
}

const PEAK_KM = [[5.5, 32], [11, 42], [22, 55], [43, 68], [Infinity, 80]];     // volume settimanale massimo per la distanza dell'evento
const LONG_CAP = [[5.5, 14], [11, 18], [22, 24], [43, 32], [Infinity, 36]];    // lungo massimo
const pickBy = (table, d) => table.find(([lim]) => d <= lim)[1];

function phaseOf(i, total, taper) {
  if (i >= total - taper) return 'scarico';
  const n = total - taper;
  if (i < n * 0.4) return 'base';
  if (i < n * 0.8) return 'sviluppo';
  return 'picco';
}

// Sedute di corsa a partire dal ritmo di riferimento.
function mkRun(title, steps) {
  const spec = { sport: 'running', title, steps };
  const t = LibUI.totals(spec);
  return { sport: 'running', title, spec, km: t.m / 1000, min: Math.round(t.s / 60) };
}
const range = (c, d) => [Math.round(c - d), Math.round(c + d)];

function easyRun(km, p10) {
  const lo = Math.round(p10 + 45), hi = Math.round(p10 + 80);
  return mkRun(`Corsa facile ${Math.round(km * 10) / 10} km`.replace('.', ','), [{ kind: 'interval', distance_m: Math.round(km * 10) * 100, pace: [lo, hi], note: 'Z2, conversazione possibile' }]);
}
function longRun(km, p10, withFinish, evPace) {
  const lo = Math.round(p10 + 45), hi = Math.round(p10 + 80);
  if (withFinish && km >= 12) {
    const fin = Math.round(km * 0.2 * 10) * 100;
    return mkRun(`Lungo ${Math.round(km)} km con finale a ritmo gara`, [
      { kind: 'interval', distance_m: Math.round(km * 1000) - fin, pace: [lo, hi], note: 'Z2' },
      { kind: 'interval', distance_m: fin, pace: range(evPace, 4), note: 'ritmo gara' }]);
  }
  return mkRun(`Lungo ${Math.round(km)} km`, [{ kind: 'interval', distance_m: Math.round(km * 10) * 100, pace: [lo, hi], note: 'Z2, FC sotto 148' }]);
}
function qualityRun(phase, k, paces, evPace, distKm, maxKm) {
  const { p5, p10 } = paces;
  const warm = { kind: 'warmup', time_s: 720, hr_zone: 1 }, cool = { kind: 'cooldown', time_s: 600, hr_zone: 1 };
  const rec = (s, note) => ({ kind: 'recovery', time_s: s, note: note || 'jogging Z1' });
  // prova da nMax ripetizioni in giu' finche' la seduta sta nel tetto di volume (min 2 ripetizioni)
  const fit = (nMax, build) => { let n = nMax, r = build(n); while (n > 3 && r.km > maxKm) { n--; r = build(n); } return r; };
  if (phase === 'base') {            // fartlek e progressivi: stimolo leggero, senza ritmi rigidi
    if (k % 2 === 0) return fit(Math.min(10, 5 + Math.floor(k / 2)), reps => mkRun(`Fartlek ${reps}×(2′ + 1′)`, [warm, { kind: 'repeat', reps, steps: [{ kind: 'interval', time_s: 120, pace: range(p10 - 2, 5) }, rec(60, 'corsa lenta')] }, cool]));
    return mkRun('Progressivo a tre blocchi', [warm, { kind: 'interval', time_s: 900, pace: [p10 + 40, p10 + 55], note: 'facile' }, { kind: 'interval', time_s: 900, pace: [p10 + 18, p10 + 28], note: 'medio' }, { kind: 'interval', time_s: 600, pace: [p10 - 2, p10 + 8], note: 'sostenuto' }, cool]);
  }
  if (phase === 'sviluppo') {        // soglia e ripetute
    if (k % 2 === 0) return fit(Math.min(5, 3 + Math.floor(k / 2)), n => mkRun(`Soglia ${n}×1000 m`, [warm, { kind: 'repeat', reps: n, steps: [{ kind: 'interval', distance_m: 1000, pace: range(p10 + 6, 5) }, rec(120)] }, cool]));
    return fit(Math.min(10, 6 + k), n => mkRun(`Ripetute ${n}×400 m`, [warm, { kind: 'repeat', reps: n, steps: [{ kind: 'interval', distance_m: 400, pace: range(p5 + 2, 5) }, rec(90)] }, cool]));
  }
  if (phase === 'picco') {           // lavoro specifico a ritmo gara
    const unit = distKm <= 6 ? 800 : (distKm <= 12 ? 1000 : 2000);
    return fit(Math.min(distKm <= 12 ? 6 : 5, 3 + k), n => mkRun(`Ritmo gara ${n}×${unit} m`, [warm, { kind: 'repeat', reps: n, steps: [{ kind: 'interval', distance_m: unit, pace: range(evPace, 3) }, rec(unit >= 2000 ? 180 : 120)] }, cool]));
  }
  return mkRun('Richiami 4×400 m', [warm, { kind: 'repeat', reps: 4, steps: [{ kind: 'interval', distance_m: 400, pace: range(evPace, 4) }, rec(90)] }, cool]);  // scarico: gambe vive
}

// Sedute di nuoto: rotazione dalla libreria; per eventi di nuoto, un lungo continuo che cresce fino a ~1,2x la distanza.
const SWIM_ROTATION = { base: ['tecnica', 'gambePull', 'resistenza'], sviluppo: ['resistenza', 'piramide', 'tecnica'], picco: ['velocitaPura', 'resistenza', 'misti'], scarico: ['leggero', 'tecnica'] };
function swimSession(phase, k) {
  const keys = SWIM_ROTATION[phase].filter(x => SWIM_ALL_SPECS[x]);
  const spec = SWIM_ALL_SPECS[keys[k % keys.length]];
  const total = spec.blocks.reduce((s, b) => s + b.reps * b.distance_m, 0);
  return { sport: 'swimming', title: spec.title, spec, km: total / 1000, min: Math.round(total / 1000 * 32) };
}
function longSwim(meters, label) {
  const m = Math.max(600, Math.round(meters / 100) * 100);
  const main = Math.max(300, m - 400);
  const reps = main >= 1600 ? Math.ceil(main / 800) : (main >= 800 ? 2 : 1);
  const each = Math.round(main / reps / 50) * 50;
  const spec = { sport: 'swimming', title: `${label} ${m} m`, blocks: [
    SB('Riscaldamento', 'warmup', 1, 300, { stroke: 'any' }),
    SB('Continuo aerobico', 'interval', reps, each, { rest_s: 30, intensity: 'aerobic', note: 'ritmo regolare, respiro ogni 3' }),
    SB('Defaticante', 'cooldown', 1, 100, { stroke: 'any' })] };
  const total = 300 + reps * each + 100;
  return { sport: 'swimming', title: spec.title, spec, km: total / 1000, min: Math.round(total / 1000 * 32) };
}

const GYM_SESSION = (k, light) => {
  const g = GYM_CATALOG[k % 2];
  return { sport: 'strength', title: light ? g.title + ' (leggera)' : g.title, spec: light ? { ...g.spec, exercises: g.spec.exercises.map(x => ({ ...x, sets: Math.max(2, x.sets - 1) })) } : g.spec, km: 0, min: 45 };
};

// Giorni della settimana (0 = lunedi') usati per N giorni di allenamento.
const DAY_SLOTS = { 2: [1, 5], 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6] };

// Quante sedute per sport, dati giorni e attivita'.
function planMix(primary, acts, n) {
  const swimW = acts.includes('swimming'), gymW = acts.includes('strength'), runW = acts.includes('running');
  let run = 0, swim = 0, gym = 0;
  if (primary === 'swimming') {
    swim = Math.max(1, Math.ceil(n * 0.5));
    let r = n - swim;
    if (gymW && r >= 2) { gym = 1; r--; }
    if (runW) run = r; else swim += r;
  } else {
    swim = swimW && n >= 2 ? 1 : 0;
    gym = gymW && n >= 4 ? 1 : 0;
    run = Math.max(Math.ceil(n / 2), n - swim - gym);
    while (run + swim + gym > n) { if (gym) gym--; else if (swim) swim--; else break; }
    if (!swimW && !gymW) run = n;
    if (n === 6 && swimW && gymW) { run = 4; }
  }
  return { run, swim, gym };
}

// Piano completo. in: { sport, eventName, distanceKm | distanceM, eventDate | endDate, activities:[], days, start }
function generatePlan(input, activities, fitness) {
  const primary = input.sport;
  const acts = Array.from(new Set([primary, ...(input.activities || [])]));
  const start = input.start || todayISO();
  const end = input.eventDate || input.endDate;
  const hasEvent = !!input.eventDate;
  const totalDays = daysBetween(start, end);
  if (totalDays < 13) throw new Error('Servono almeno due settimane tra oggi e la data finale.');
  if (totalDays > 300) throw new Error('Il piano può coprire al massimo 40 settimane.');
  const n = Math.max(2, Math.min(6, Number(input.days) || 4));
  const base = planBaseline(activities);
  const paces = racePaces(fitness);
  const distKm = primary === 'running' ? (Number(input.distanceKm) || 10) : 10;
  const evPace = primary === 'running' ? eventPace(fitness, distKm) : paces.p10 + 10;
  const weeks0 = mondayOf(start);
  const nWeeks = Math.floor(daysBetween(weeks0, end) / 7) + 1;
  const taper = hasEvent ? (primary === 'running' && distKm > 25 ? 2 : 1) : 1;
  const mix = planMix(primary, acts, n);
  const slots = DAY_SLOTS[n];

  // volumi settimanali
  const startKm = Math.max(base.runKm, mix.run * 4, 10);
  const peakKm = Math.min(pickBy(PEAK_KM, distKm), Math.max(startKm * Math.pow(1.09, (nWeeks - taper) * 0.75), startKm + 4));
  const longCap = pickBy(LONG_CAP, distKm);
  const evSwim = primary === 'swimming' ? (Number(input.distanceM) || 1500) : 0;
  const startSwim = Math.max(base.swimM, 800);
  const peakSwim = primary === 'swimming' ? Math.max(startSwim * 1.4, evSwim * 1.8) : Math.max(startSwim * 1.3, 1800);

  const weeks = [];
  let prevKm = startKm;
  for (let i = 0; i < nWeeks; i++) {
    const phase = phaseOf(i, nWeeks, taper);
    const buildWeeks = Math.max(1, nWeeks - taper - 1);
    const down = phase !== 'scarico' && (i + 1) % 4 === 0;
    let km = startKm + (peakKm - startKm) * Math.min(1, i / buildWeeks);
    if (phase !== 'scarico') km = Math.min(km, prevKm * 1.1 + (i === 0 ? 0 : 0));
    const ramp = Math.round(km * 10) / 10;
    if (!down && phase !== 'scarico') prevKm = ramp;
    km = down ? ramp * 0.75 : (phase === 'scarico' ? prevKm * (nWeeks - i === 1 && taper === 1 ? 0.55 : 0.7) : ramp);
    const f = Math.min(1, i / Math.max(1, nWeeks - taper - 1));
    const swimM = (down ? 0.8 : (phase === 'scarico' ? 0.6 : 1)) * (startSwim + (peakSwim - startSwim) * f);

    const roles = [];
    for (let r = 0; r < mix.run; r++) roles.push(r === 0 && mix.run >= 2 ? 'long' : 'run');
    for (let s = 0; s < mix.swim; s++) roles.push('swim');
    for (let g = 0; g < mix.gym; g++) roles.push('gym');
    const runRoles = roles.filter(r => r === 'long' || r === 'run');
    const sessions = [];
    const qualityCount = mix.run >= 5 && phase !== 'base' && phase !== 'scarico' ? 2 : (mix.run >= 3 || (mix.run === 2 && phase !== 'scarico') ? 1 : 0);
    if (primary === 'swimming' && mix.run >= 1 && mix.run <= 1) { /* una sola corsa: facile */ }
    const eventWeek = hasEvent && date_in_week(isoAdd(weeks0, i * 7), end);
    const longKm = mix.run >= 2 ? Math.min(longCap, Math.max(5, km * ({ 2: 0.55, 3: 0.4 }[mix.run] || 0.32))) * (eventWeek ? 0.6 : 1) : 0;
    const quals = [];
    for (let q = 0; q < qualityCount; q++) quals.push(qualityRun(phase, i * 2 + q, paces, evPace, distKm, Math.max(6, km * ({ 2: 0.45, 3: 0.32 }[mix.run] || (qualityCount > 1 ? 0.22 : 0.28)))));
    const qualKm = quals.reduce((s, x) => s + x.km, 0);
    const easyCount = runRoles.length - (mix.run >= 2 ? 1 : 0) - quals.length;
    const easyKm = easyCount > 0 ? Math.max(4, Math.min(14, (km - longKm - qualKm) / easyCount)) : 0;
    const runSessions = [];
    if (mix.run >= 2) runSessions.push({ role: eventWeek ? 'easy' : 'long', s: longRun(longKm, paces.p10, phase === 'picco' && distKm >= 10 && !eventWeek, evPace) });
    quals.forEach(q => runSessions.push({ role: 'quality', s: q }));
    for (let e = 0; e < Math.max(0, easyCount); e++) runSessions.push({ role: 'easy', s: easyRun(easyKm, paces.p10) });
    if (mix.run === 1) runSessions.splice(0, runSessions.length, { role: 'easy', s: easyRun(primary === 'running' ? Math.max(4, Math.min(14, km)) : Math.min(8, Math.max(4, base.runKm * 0.5)), paces.p10) });

    const swimSessions = [];
    for (let s = 0; s < mix.swim; s++) {
      if (primary === 'swimming' && s === 0) {
        const m = (evSwim || swimM) * (0.6 + 0.6 * f) * (down ? 0.8 : (phase === 'scarico' ? 0.5 : 1));
        swimSessions.push({ role: 'long', s: longSwim(Math.max(m, 800), phase === 'scarico' ? 'Nuoto facile' : 'Nuoto continuo') });
      } else swimSessions.push({ role: 'swim', s: swimSession(phase, i + s) });
    }
    const gymSessions = [];
    for (let g = 0; g < mix.gym; g++) gymSessions.push({ role: 'gym', s: GYM_SESSION(i + g, phase === 'scarico' || down) });

    // assegnazione ai giorni: lunghi in fondo, qualita' a meta' settimana, poi il resto; mai due sedute dure vicine se evitabile
    const queue = [...runSessions.filter(x => x.role === 'long'), ...swimSessions.filter(x => x.role === 'long'), ...runSessions.filter(x => x.role === 'quality'), ...swimSessions.filter(x => x.role === 'swim'), ...gymSessions, ...runSessions.filter(x => x.role === 'easy')];
    const dayOf = new Array(slots.length).fill(null);
    const place = (item, idx) => { dayOf[idx] = item; };
    const monday0 = isoAdd(weeks0, i * 7);
    const free = slots.map((_, k) => k).filter(k => { const d = isoAdd(monday0, slots[k]); return d >= start && d <= end && !(hasEvent && d === end); });
    const take = pred => { const idx = free.find(pred); if (idx !== undefined) free.splice(free.indexOf(idx), 1); return idx; };
    queue.forEach(item => {
      let idx;
      if (item.role === 'long') idx = take(k => k === slots.length - 1) ?? take(() => true);
      else if (item.role === 'quality') idx = take(k => k === 1 || k === 0 && slots.length === 2) ?? take(k => k === Math.floor(slots.length / 2) - 0) ?? take(() => true);
      else if (item.s.sport === 'strength') idx = take(k => slots[k] === 0 || slots[k] === 2 || slots[k] === 3) ?? take(() => true);
      else idx = take(() => true);
      if (idx !== undefined) place(item, idx);
    });
    const monday = isoAdd(weeks0, i * 7);
    const days = [];
    slots.forEach((wd, k) => {
      const date = isoAdd(monday, wd);
      if (date < start || date > end || (hasEvent && date === end)) return;
      const item = dayOf[k];
      if (item) days.push({ date, sessions: [{ id: `w${i + 1}-${wd}`, role: item.role, sport: item.s.sport, title: item.s.title, spec: item.s.spec, km: Math.round(item.s.km * 10) / 10, min: item.s.min }] });
    });
    if (hasEvent && date_in_week(monday, end)) days.push({ date: end, sessions: [{ id: 'event', role: 'event', sport: primary, title: input.eventName || 'Evento', spec: null, km: primary === 'running' ? distKm : (evSwim / 1000), min: 0 }] });
    days.sort((a, b) => a.date.localeCompare(b.date));
    const wkm = days.flatMap(d => d.sessions).filter(s => s.sport === 'running' && s.role !== 'event').reduce((s, x) => s + x.km, 0);
    const wswim = days.flatMap(d => d.sessions).filter(s => s.sport === 'swimming' && s.role !== 'event').reduce((s, x) => s + x.km * 1000, 0);
    weeks.push({ n: i + 1, phase, down, monday, runKm: Math.round(wkm * 10) / 10, swimM: Math.round(wswim / 50) * 50, days });
  }
  return {
    version: 1, created: todayISO(),
    meta: { sport: primary, eventName: input.eventName || '', distanceKm: input.distanceKm || null, distanceM: input.distanceM || null,
            eventDate: input.eventDate || null, endDate: input.endDate || null, activities: acts, days: n, start,
            evPace: primary === 'running' ? Math.round(evPace) : null, baseline: { runKm: Math.round(base.runKm), swimM: Math.round(base.swimM) } },
    weeks,
  };
}
function date_in_week(monday, d) { const k = daysBetween(monday, d); return k >= 0 && k < 7; }
