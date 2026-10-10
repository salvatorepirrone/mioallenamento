// Lodestar — pagina Piano: creazione guidata e visualizzazione a settimane.
const PHASE_LABEL = { base: 'Base', sviluppo: 'Sviluppo', picco: 'Picco', scarico: 'Scarico' };
const PHASE_COLOR = { base: '#7ab8f5', sviluppo: '#2E6DA4', picco: '#d9822b', scarico: '#7bc47f' };
const DAY_IT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const ACT_TYPES = { running: RUN_TYPES, swimming: SWIM_TYPES, strength: [GYM_TYPE] };
const DIST = { running: [['5', '5 km'], ['10', '10 km'], ['21.0975', 'Mezza maratona'], ['42.195', 'Maratona'], ['other', 'Altra distanza']],
               swimming: [['750', '750 m'], ['1500', '1500 m'], ['1900', '1900 m (olimpico)'], ['3800', '3800 m (Ironman)'], ['other', 'Altra distanza']] };
const $ = id => document.getElementById(id);
const state = { plan: null, csrf: '', activities: [], fitness: null, canSend: false };

function dayLabel(iso) { const d = new Date(iso + 'T12:00:00'); return `${DAY_IT[d.getDay()]} ${d.getDate()} ${MESI_IT[d.getMonth()]}`; }

async function pApi(action, payload) {
  const opt = payload === undefined ? { cache: 'no-store', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': state.csrf }, body: JSON.stringify(payload) };
  const res = await fetch('/lodestar/piano-api.php?action=' + action, opt);
  let d = null; try { d = await res.json(); } catch (e) { /* non JSON */ }
  if (!res.ok) throw new Error((d && d.error) || 'Errore ' + res.status);
  if (d && d.csrf) { state.csrf = d.csrf; LibUI.setCsrf(d.csrf); }
  return d;
}

// ---------- form ----------
function fillDistances() {
  const sport = $('f-sport').value;
  $('f-dist').innerHTML = DIST[sport].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('f-unit').textContent = sport === 'running' ? 'km' : 'm';
  onDistChange();
}
function onDistChange() { $('f-dist-other-wrap').hidden = $('f-dist').value !== 'other'; }
function onGoalChange() {
  const ev = document.querySelector('input[name=goal]:checked').value === 'event';
  $('f-dist-wrap').hidden = !ev; $('f-name-wrap').hidden = !ev; if (!ev) $('f-dist-other-wrap').hidden = true; else onDistChange();
  $('f-date-label').textContent = ev ? "Data dell'evento" : 'Data di fine del piano';
}
function syncActs() {
  const sport = $('f-sport').value;
  document.querySelectorAll('.pl-acts input').forEach(c => { if (c.value === sport) { c.checked = true; c.disabled = true; } else c.disabled = false; });
}

function readForm() {
  const ev = document.querySelector('input[name=goal]:checked').value === 'event';
  const sport = $('f-sport').value;
  const input = { sport, days: Number($('f-days').value), activities: [...document.querySelectorAll('.pl-acts input:checked')].map(c => c.value) };
  const date = $('f-date').value;
  if (!date) throw new Error(ev ? "Scegli la data dell'evento." : 'Scegli la data di fine del piano.');
  if (ev) {
    input.eventDate = date; input.eventName = $('f-name').value.trim();
    const v = $('f-dist').value === 'other' ? Number($('f-dist-other').value) : Number($('f-dist').value);
    if (!(v > 0)) throw new Error('Indica la distanza.');
    if (sport === 'running') input.distanceKm = v; else input.distanceM = v;
  } else input.endDate = date;
  return input;
}

// ---------- visualizzazione ----------
function doneOn(date, sport) {
  const types = ACT_TYPES[sport] || [];
  return state.activities.some(a => a.date === date && types.includes(a.type));
}

function sessionHtml(s, date) {
  if (s.role === 'event') return `<div class="pl-sess pl-event">🏁 <b>${LibUI.e(s.title)}</b>${s.km ? ` · ${Math.round(s.km * 10) / 10} km` : ''}</div>`;
  const icon = s.sport === 'running' ? '🏃' : (s.sport === 'swimming' ? '🏊' : '🏋️');
  const done = doneOn(date, s.sport);
  const past = date < todayISO();
  const status = done ? '<span class="ld-ok">✅ fatto</span>' : (past ? '<span class="ld-muted">non registrato</span>' : '');
  const meta = [s.km ? (s.sport === 'swimming' ? Math.round(s.km * 1000) + ' m' : s.km + ' km') : '', s.min ? '~' + s.min + ' min' : ''].filter(Boolean).join(' · ');
  const send = s.sport === 'strength' ? '' : (state.canSend && !past ? `<div class="reco-send"><button type="button" class="cw-btn" data-send="${s.id}" data-date="${date}">${s.sent ? 'Reinvia' : "Invia all'orologio"} (${dayLabel(date)})</button> <span class="reco-send-msg"></span></div>` : '');
  return `<details class="pl-sess${done ? ' pl-done' : ''}" data-sid="${s.id}"><summary>${icon} <b>${LibUI.e(s.title)}</b> <span class="ld-muted">${meta}</span> ${status}${s.sent ? ' <span class="ld-badge alt">inviato</span>' : ''}</summary>
    ${LibUI.html(s.spec)}${send}</details>`;
}

function weekHtml(w, current) {
  const sessions = w.days.flatMap(d => d.sessions.filter(s => s.role !== 'event'));
  const done = w.days.reduce((n, d) => n + d.sessions.filter(s => s.role !== 'event' && doneOn(d.date, s.sport)).length, 0);
  const vol = [w.runKm ? w.runKm + ' km corsa' : '', w.swimM ? w.swimM + ' m nuoto' : ''].filter(Boolean).join(' · ');
  const rows = w.days.map(d => `<div class="pl-day"><div class="pl-date${d.date === todayISO() ? ' today' : ''}">${dayLabel(d.date)}</div><div>${d.sessions.map(s => sessionHtml(s, d.date)).join('')}</div></div>`).join('');
  return `<details class="pl-week" ${current ? 'open' : ''}><summary><span class="pl-phase" style="background:${PHASE_COLOR[w.phase]}">${PHASE_LABEL[w.phase]}</span>
    <b>Settimana ${w.n}</b>${w.down ? ' <span class="ld-badge alt">scarico</span>' : ''} <span class="ld-muted">${dayLabel(w.monday)} · ${vol || 'palestra'} · ${done}/${sessions.length} fatte</span></summary>${rows}</details>`;
}

function renderPlan() {
  const p = state.plan, m = p.meta;
  const today = todayISO();
  const end = m.eventDate || m.endDate;
  const left = daysBetween(today, end);
  const total = p.weeks.length;
  const cur = Math.max(0, p.weeks.findIndex(w => daysBetween(w.monday, today) >= 0 && daysBetween(w.monday, today) < 7));
  const curWeek = today < p.weeks[0].monday ? 0 : (today > end ? total - 1 : cur);
  const allSess = p.weeks.flatMap(w => w.days.flatMap(d => d.sessions.filter(s => s.role !== 'event').map(s => ({ s, date: d.date }))));
  const due = allSess.filter(x => x.date <= today);
  const done = due.filter(x => doneOn(x.date, x.s.sport)).length;
  const maxKm = Math.max(1, ...p.weeks.map(w => w.runKm + w.swimM / 1000 * 0.6));
  const bars = p.weeks.map((w, i) => `<div class="pl-bar${i === curWeek ? ' now' : ''}" title="Sett. ${w.n}: ${w.runKm} km, ${w.swimM} m"><div style="height:${Math.max(4, Math.round((w.runKm + w.swimM / 1000 * 0.6) / maxKm * 100))}%;background:${PHASE_COLOR[w.phase]}"></div></div>`).join('');
  const goalTxt = m.eventDate
    ? `${m.eventName ? LibUI.e(m.eventName) + ' · ' : ''}${m.sport === 'running' ? (Math.round(m.distanceKm * 10) / 10 + ' km').replace('.', ',') : (m.distanceM + ' m')} · ${dayLabel(m.eventDate)}`
    : `Piano fino al ${dayLabel(m.endDate)}`;
  const nextSess = allSess.find(x => x.date >= today);
  $('pl-view').innerHTML = `<div class="ld-card">
      <div class="pl-top"><div><div class="reco-title">${goalTxt}</div>
      <div class="ld-muted">${left >= 0 ? (left === 0 ? 'Oggi è il giorno!' : `mancano ${left} giorni · settimana ${curWeek + 1} di ${total}`) : 'Piano concluso'} · ${m.days} giorni a settimana · ${m.activities.map(a => ({ running: 'corsa', swimming: 'nuoto', strength: 'palestra' }[a])).join(', ')}</div>
      ${m.evPace ? `<div class="ld-muted">Ritmo previsto in gara (stima da Garmin): ${paceText(m.evPace / 60)}/km</div>` : ''}</div>
      <div><button class="ld-btn ghost" id="pl-new" type="button">Nuovo piano</button></div></div>
      <div class="pl-bars">${bars}</div>
      <div class="pl-legend">${Object.keys(PHASE_LABEL).map(k => `<span><i style="background:${PHASE_COLOR[k]}"></i>${PHASE_LABEL[k]}</span>`).join('')}</div>
      <div class="ld-muted" style="margin-top:6px">Aderenza finora: <b>${done}/${due.length}</b> sedute fatte${nextSess ? ` · prossima: <b>${LibUI.e(nextSess.s.title)}</b> (${dayLabel(nextSess.date)})` : ''}</div>
    </div>
    <div class="sec">Settimane</div>${p.weeks.map((w, i) => weekHtml(w, i === curWeek)).join('')}`;

  $('pl-new').onclick = () => showForm(true);
}

function showForm(replacing) {
  $('pl-create').hidden = false; $('pl-cancel').hidden = !state.plan;
  $('pl-create-title').textContent = replacing ? 'Nuovo piano (sostituisce quello attuale)' : 'Crea il tuo piano personalizzato';
  $('pl-create').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-send]'); if (!b) return;
  const sid = b.dataset.send, date = b.dataset.date;
  const sess = state.plan.weeks.flatMap(w => w.days.flatMap(d => d.sessions)).find(s => s.id === sid);
  const msg = b.parentElement.querySelector('.reco-send-msg');
  b.disabled = true; msg.textContent = 'Un momento…';
  try {
    await LibUI.api('send_plan', { plan: sess.spec, date });
    sess.sent = true;
    await pApi('save', { plan: state.plan }).catch(() => {});
    msg.textContent = 'Inviato: sull\'orologio dopo la sincronizzazione.';
  } catch (e) { msg.textContent = e.message; b.disabled = false; }
});

(async function init() {
  fillDistances(); onGoalChange(); syncActs();
  $('f-sport').onchange = () => { fillDistances(); syncActs(); };
  $('f-dist').onchange = onDistChange;
  document.querySelectorAll('input[name=goal]').forEach(r => r.onchange = onGoalChange);
  $('pl-cancel').onclick = () => { $('pl-create').hidden = true; };
  $('pl-go').onclick = async () => {
    const msg = $('pl-msg'); msg.textContent = '';
    try {
      const plan = generatePlan(readForm(), state.activities, state.fitness);
      $('pl-go').disabled = true; msg.textContent = 'Salvo il piano…';
      await pApi('save', { plan });
      state.plan = plan; $('pl-create').hidden = true; msg.textContent = '';
      renderPlan(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { msg.innerHTML = `<span class="ld-err">${LibUI.e(e.message)}</span>`; }
    $('pl-go').disabled = false;
  };
  try {
    const [d, acts, fit, mine] = await Promise.all([
      pApi('get'), fetchJSONSafe('/data/garmin-activities.json', []), fetchJSONSafe('/data/garmin-fitness.json', null),
      LibUI.api('mine').catch(() => ({ can_send: false })),
    ]);
    state.activities = acts; state.fitness = fit; state.canSend = !!mine.can_send; state.plan = d.plan;
    if (state.plan) { $('pl-view').innerHTML = ''; renderPlan(); } else { $('pl-view').innerHTML = '<div class="ld-card"><div class="reco-title">Ancora nessun piano</div><div class="ld-muted">Scegli un evento di riferimento o una data di fine, le attività che pratichi e quanti giorni puoi allenarti: Lodestar costruisce il percorso settimana per settimana.</div></div>'; showForm(false); }
  } catch (e) { $('pl-view').innerHTML = `<div class="ld-err">${LibUI.e(e.message)}</div>`; }
})();
