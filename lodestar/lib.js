// Lodestar — librerie di allenamenti (corsa, nuoto, palestra): visualizzazione, invio all'orologio, inserimento dei coach.
// Le voci vengono dal catalogo di base (catalog.js) e dagli allenamenti inseriti dai coach (coach-api.php).

const LibUI = (function () {
  const EQ = { fins: 'pinne', kickboard: 'tavola', paddles: 'palette', pull_buoy: 'pull', snorkel: 'snorkel' };
  const STROKE = { any: '', free: 'stile libero', back: 'dorso', breast: 'rana', fly: 'farfalla', im: 'misti', mixed: 'misto', drill: 'drill' };
  const INTENSITY = { easy: 'facile', aerobic: 'aerobico', threshold: 'soglia', fast: 'veloce', sprint: 'sprint' };
  const STEP = { warmup: 'Riscaldamento', interval: 'Lavoro', recovery: 'Recupero', cooldown: 'Defaticamento' };
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const dur = s => (s % 60 === 0 ? `${s / 60}′` : (s < 120 ? `${s}″` : `${mmss(s)}`));
  const dist = m => (m >= 1000 ? `${(m / 1000).toLocaleString('it-IT')} km` : `${m} m`);

  function runStep(st) {
    const size = st.distance_m ? dist(st.distance_m) : dur(st.time_s);
    let target = st.pace ? `${mmss(st.pace[0])}–${mmss(st.pace[1])}/km` : (st.hr_zone ? `Z${st.hr_zone}` : '');
    if (target.charAt(0) === 'Z' && st.note && st.note.indexOf(target) === 0) target = '';   // la nota ripete gia' la zona
    const label = st.kind === 'interval' && st.single ? 'Corsa' : (STEP[st.kind] || st.kind);
    return `<b>${label}</b> ${size}${target ? ' · ' + target : ''}${st.note ? ` <span class="cw-note">${e(st.note)}</span>` : ''}`;
  }

  function runHtml(p) {
    const lone = p.steps.length === 1 && p.steps[0].kind === 'interval';                     // una corsa continua: non e' un "lavoro" tra altri passi
    const items = p.steps.map(st => st.kind === 'repeat'
      ? `<li><b>${st.reps}×</b><ul>${st.steps.map(s => `<li>${runStep(s)}</li>`).join('')}</ul></li>`
      : `<li>${runStep(lone ? Object.assign({}, st, { single: true }) : st)}</li>`).join('');
    const tot = totals(p);
    return `<ul class="cw-list">${items}</ul><div class="ld-muted">Totale: ~${(tot.m / 1000).toFixed(1).replace('.', ',')} km · ~${Math.round(tot.s / 60)} min (stima)</div>`;
  }

  // Stima di distanza e durata di una corsa: i tratti a tempo valgono in base al ritmo (o 6:00/km se non indicato).
  function totals(p) {
    let m = 0, s = 0;
    (function walk(steps, times) {
      steps.forEach(st => {
        if (st.kind === 'repeat') { walk(st.steps, times * st.reps); return; }
        const pace = st.pace ? (st.pace[0] + st.pace[1]) / 2 : 360;
        if (st.distance_m) { m += st.distance_m * times; s += st.distance_m / 1000 * pace * times; }
        else { s += st.time_s * times; m += st.time_s / pace * 1000 * times; }
      });
    })(p.steps, 1);
    return { m: Math.round(m), s: Math.round(s) };
  }

  function swimHtml(p) {
    const eqText = l => (l || []).map(x => EQ[x] || x).join(' + ');
    const items = p.blocks.map(b => {
      const meta = [];
      if (b.label) meta.push(e(b.label));
      if (STROKE[b.stroke]) meta.push(e(STROKE[b.stroke]));
      if (b.equipment && b.equipment.length) meta.push(`<span class="cw-eq">${e(eqText(b.equipment))}</span>`);
      if (b.intensity) meta.push(e(INTENSITY[b.intensity] || b.intensity));
      if (b.rest_s) meta.push(`rec. ${b.rest_s}″`);
      let h = `<li><b>${b.reps > 1 ? b.reps + '×' : ''}${b.distance_m} m</b> ${meta.join(' · ')}`;
      if (b.note) h += `<div class="cw-note">${e(b.note)}</div>`;
      if (b.alternate) ['odd', 'even'].forEach(k => {
        const v = b.alternate[k] || {};
        h += `<div class="cw-note">${k === 'odd' ? 'dispari' : 'pari'}: ${[v.equipment && v.equipment.length ? eqText(v.equipment) : 'senza attrezzi', v.note].filter(Boolean).map(e).join(' — ')}</div>`;
      });
      return h + '</li>';
    }).join('');
    const total = p.total_m != null ? p.total_m : p.blocks.reduce((s, b) => s + b.reps * b.distance_m, 0);
    return `<ul class="cw-list">${items}</ul><div class="ld-muted">Totale: ${total.toLocaleString('it-IT')} m${p.pool_length_m ? ' · vasca da ' + p.pool_length_m + ' m' : ''}</div>`;
  }

  function strengthHtml(p) {
    const items = p.exercises.map(x => {
      const amount = x.seconds ? `${x.sets}×${x.seconds}″` : `${x.sets}×${x.reps || '?'}`;
      return `<li><b>${e(x.name)}</b> ${amount}${x.weight_kg ? ' · ' + x.weight_kg + ' kg' : ''}${x.rest_s ? ' · rec. ' + x.rest_s + '″' : ''}${x.note ? `<div class="cw-note">${e(x.note)}</div>` : ''}</li>`;
    }).join('');
    return `<ul class="cw-list">${items}</ul>`;
  }

  function html(p) {
    const sport = p.sport || (p.blocks ? 'swimming' : 'running');
    return sport === 'running' ? runHtml(p) : (sport === 'strength' ? strengthHtml(p) : swimHtml(p));
  }

  let csrf = '';
  async function api(action, payload) {
    const opt = payload === undefined ? { cache: 'no-store', credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(payload) };
    const res = await fetch('/coach-api.php?action=' + action, opt);
    let d = null;
    try { d = await res.json(); } catch (x) { /* non JSON */ }
    if (!res.ok) throw new Error((d && d.error) || 'Errore ' + res.status);
    if (d && d.csrf) csrf = d.csrf;
    return d;
  }

  function sendBox(onSend, canSend, sport) {
    if (!canSend) return '';
    return `<div class="reco-send"><input type="date" class="reco-date" title="Giorno in calendario (facoltativo)"> <button type="button" class="cw-btn" data-send>Invia all'orologio</button> <span class="reco-send-msg"></span></div>`;
  }

  return { html, e, api, sendBox, totals, setCsrf: v => { csrf = v; }, getCsrf: () => csrf };
})();

// ---------- libreria unica: allenamenti Lodestar + allenamenti dei coach ----------
// Categoria di un allenamento inserito da un coach, dedotta dalla struttura (quelli di base hanno la categoria nel catalogo).
function libCategory(sport, spec) {
  if (sport === 'strength') return 'forza';
  if (sport === 'running') {
    const t = LibUI.totals(spec);
    const flat = [];
    (function walk(steps, inRepeat) { steps.forEach(st => { if (st.kind === 'repeat') walk(st.steps, true); else flat.push({ st, inRepeat }); }); })(spec.steps, false);
    const fast = flat.some(x => x.st.kind === 'interval' && x.st.pace && (x.st.pace[0] + x.st.pace[1]) / 2 < 330);
    const repeats = spec.steps.some(st => st.kind === 'repeat') || flat.filter(x => x.st.kind === 'interval').length >= 3;
    if (fast || repeats) return 'qualita';
    if (t.m >= 11000 || t.s >= 4200) return 'lungo';
    return t.s <= 1800 ? 'recupero' : 'base';
  }
  const blocks = spec.blocks || [];
  const meters = b => b.reps * b.distance_m;
  const total = blocks.reduce((s, b) => s + meters(b), 0) || 1;
  const fast = blocks.filter(b => b.intensity === 'fast' || b.intensity === 'sprint').reduce((s, b) => s + meters(b), 0);
  const drill = blocks.filter(b => b.stroke === 'drill').reduce((s, b) => s + meters(b), 0);
  if (fast >= 200) return 'velocita';
  if (drill / total >= 0.25) return 'tecnica';
  if (total <= 1500 && !blocks.some(b => b.intensity === 'threshold')) return 'leggero';
  return 'resistenza';
}

// Riduce il volume di un allenamento (solo al ribasso) per adattarlo alla forma: ripetizioni, tratti continui, serie.
function scaleSpec(spec, factor) {
  if (!(factor < 0.95)) return spec;
  const f = Math.max(0.5, factor);
  const copy = JSON.parse(JSON.stringify(spec));
  delete copy.total_m; delete copy.total_s;   // i totali si ricalcolano dopo la riduzione
  if (copy.steps) {
    const hasRepeat = copy.steps.some(st => st.kind === 'repeat');
    copy.steps.forEach(st => {
      if (st.kind === 'repeat') st.reps = Math.max(2, Math.round(st.reps * f));
      else if (!hasRepeat && st.kind === 'interval') {
        if (st.distance_m) st.distance_m = Math.round(st.distance_m * Math.max(0.7, f) / 100) * 100;
        else if (st.time_s) st.time_s = Math.round(st.time_s * Math.max(0.7, f) / 60) * 60;
      }
    });
  }
  if (copy.blocks) copy.blocks.forEach(b => { if (b.kind === 'interval' && b.reps >= 3 && !b.alternate) b.reps = Math.max(2, Math.round(b.reps * f)); });
  if (copy.exercises && f < 0.8) copy.exercises.forEach(x => { x.sets = Math.max(2, x.sets - 1); });
  return copy;
}

// Tutte le librerie in una volta: { running:[...], swimming:[...], strength:[...], meta }.
// Ogni voce: { id, source: 'lodestar' | 'coach', createdBy, sport, title, spec, cat, note, date, sends }.
async function loadAllLibraries() {
  let data = { programs: [], csrf: '', me: '', is_coach: false, can_send: false };
  try { data = await LibUI.api('library'); } catch (e) { console.warn('Libreria dei coach non disponibile:', e.message); }
  const out = { running: [], swimming: [], strength: [], meta: { me: data.me, isCoach: data.is_coach, isAdmin: !!data.is_admin, canSend: data.can_send, athletes: data.athletes || [] } };
  data.programs.forEach(p => {
    const sport = p.sport || 'swimming';
    if (!out[sport]) return;
    const spec = Object.assign({ sport }, p.parsed);
    out[sport].push({ id: p.id, source: 'coach', createdBy: p.created_by, sport, title: p.title, spec, cat: (p.parsed && p.parsed.category) || libCategory(sport, spec), catChosen: !!(p.parsed && p.parsed.category), note: '', date: p.date, assignments: p.assignments || [], sends: p.sends || [] });
  });
  [['running', RUN_CATALOG], ['swimming', SWIM_CATALOG], ['strength', GYM_CATALOG]].forEach(([sport, list]) => {
    list.forEach(c => out[sport].push({ id: c.id, source: 'lodestar', createdBy: 'Lodestar', sport, title: c.title, spec: c.spec, cat: c.cat, note: c.note || '', date: null, assignments: [], sends: [] }));
  });
  return out;
}

// ---------- pagina di una libreria ----------
async function initLibrary(sport) {
  const cfg = SPORT_CONFIG[sport];
  const box = document.getElementById('lib-list');
  const libs = await loadAllLibraries();
  const meta = libs.meta, canSend = meta.canSend;
  const entries = libs[sport];
  let filter = 'all';

  const card = e => {
    const coach = e.source === 'coach';
    const mine = coach && e.createdBy === meta.me;
    const sendHtml = LibUI.sendBox(null, canSend, sport);
    const catSelect = coach && meta.isCoach && (mine || meta.isAdmin) ? `<div class="reco-send"><label class="ld-muted">Categoria <select data-cat-select>${Object.entries(LIB_CATS[sport]).map(([k, l]) => `<option value="${k}"${e.cat === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label> <span class="ld-muted">${e.catChosen ? 'scelta da te' : 'dedotta dal sito: confermala o cambiala'}</span></div>` : '';
    const assigned = coach && meta.isCoach && e.assignments.length
      ? `<div class="ld-muted">Assegnato a: ${e.assignments.map(a => `<span class="ld-badge alt">${LibUI.e(a.user)} · ${LibUI.e(a.date)} <a href="#" data-unassign="${LibUI.e(a.user)}" title="Togli l'assegnazione">✕</a></span>`).join(' ')}</div>` : '';
    const athleteOpts = (meta.athletes || []).map(u => `<option value="${LibUI.e(u)}">${LibUI.e(u)}</option>`).join('');
    const extra = catSelect + assigned + (coach && meta.isCoach ? `<div class="reco-send"><label class="ld-muted">Atleta <select data-assign-user>${athleteOpts}</select></label> <input type="date" class="reco-date" data-assign-date title="Giorno da assegnare all'atleta"> <button type="button" class="cw-btn secondary" data-assign>Assegna</button>${mine ? ' <button type="button" class="cw-btn secondary" data-del>Elimina</button>' : ''}</div>` : '');
    const sends = e.sends.length ? `<div class="ld-muted">✅ inviato ${e.sends.map(s => s.date || 'libreria Garmin').join(' · ')}</div>` : '';
    const info = [e.note, !(coach && meta.isCoach) && e.date ? 'assegnato al ' + e.date : ''].filter(Boolean).join(' · ');
    return `<div ${coach ? 'data-prog' : 'data-base'}="${e.id}" id="e-${e.id}"><div class="ld-recipe ld-wk"><div class="ld-recipe-head"><b>${LibUI.e(e.title)}</b>
      <span class="ld-badge">${LibUI.e(LIB_CATS[sport][e.cat] || e.cat)}</span> <span class="ld-badge alt">${coach ? '📚 Coach · ' + LibUI.e(e.createdBy) : '✦ Lodestar'}</span></div>
      ${info ? `<div class="ld-muted" style="margin-bottom:6px">${LibUI.e(info)}</div>` : ''}${LibUI.html(e.spec)}${sends}${sendHtml}${extra}<div class="cw-msg ld-muted"></div></div></div>`;
  };

  function draw() {
    const cats = Object.keys(LIB_CATS[sport]).filter(k => entries.some(e => e.cat === k));
    const chip = (v, label) => `<button type="button" class="ld-cat${filter === v ? ' on' : ''}" data-filter="${v}">${label}</button>`;
    const shown = entries.filter(e => filter === 'all' || filter === e.cat || (filter === 'coach' && e.source === 'coach') || (filter === 'lodestar' && e.source === 'lodestar'));
    shown.sort((a, b) => (a.source === b.source ? 0 : (a.source === 'coach' ? -1 : 1)));
    box.innerHTML = `<div class="ld-filters">${chip('all', `Tutti (${entries.length})`)}${cats.map(k => chip(k, LIB_CATS[sport][k])).join('')}<span class="ld-sep"></span>${chip('coach', '📚 Coach')}${chip('lodestar', '✦ Lodestar')}</div>
      <div class="ld-recipes">${shown.map(card).join('') || '<div class="ld-muted">Nessun allenamento con questo filtro.</div>'}</div>`;
    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView({ block: 'center' }); }
  }
  draw();

  box.addEventListener('click', async ev => {
    const chipBtn = ev.target.closest('[data-filter]');
    if (chipBtn) { filter = chipBtn.dataset.filter; draw(); return; }
    const un = ev.target.closest('[data-unassign]');
    if (un) {
      ev.preventDefault();
      const w = un.closest('[data-prog]');
      try { await LibUI.api('assign', { id: w.dataset.prog, date: null, user: un.dataset.unassign }); initLibraryRefresh(sport); } catch (err) { w.querySelector('.cw-msg').textContent = err.message; }
      return;
    }
    const b = ev.target.closest('button'); if (!b) return;
    const wrap = b.closest('[data-prog],[data-base]');
    if (!wrap) return;
    const msg = wrap.querySelector('.cw-msg');
    const dateInput = wrap.querySelector('.reco-date:not([data-assign-date])');
    const run = async (promise, ok) => {
      b.disabled = true; msg.textContent = 'Un momento…';
      try { await promise; msg.textContent = ok || ''; if (b.hasAttribute('data-del') || b.hasAttribute('data-assign')) return initLibraryRefresh(sport); }
      catch (err) { msg.textContent = err.message; }
      b.disabled = false;
    };
    if (b.hasAttribute('data-send')) {
      const date = (dateInput && dateInput.value) || null;
      const done = 'Inviato a Garmin' + (date ? ' e messo in calendario.' : ' (nella tua libreria allenamenti).');
      if (wrap.dataset.prog) await run(LibUI.api('send', { id: wrap.dataset.prog, date }), done);
      else await run(LibUI.api('send_plan', { plan: entries.find(x => x.id === wrap.dataset.base).spec, date }), done);
    } else if (b.hasAttribute('data-assign')) {
      const date = wrap.querySelector('[data-assign-date]').value || null;
      if (!date) { msg.textContent = 'Scegli il giorno.'; return; }
      await run(LibUI.api('assign', { id: wrap.dataset.prog, date, user: wrap.querySelector('[data-assign-user]').value }), 'Assegnato.');
    } else if (b.hasAttribute('data-del')) {
      if (confirm('Eliminare questo allenamento dalla libreria?')) await run(LibUI.api('delete', { id: wrap.dataset.prog }));
    }
  });

  box.addEventListener('change', async ev => {
    const sel = ev.target.closest('[data-cat-select]'); if (!sel) return;
    const wrap = sel.closest('[data-prog]'); const msg = wrap.querySelector('.cw-msg');
    try { await LibUI.api('set_category', { id: wrap.dataset.prog, category: sel.value }); msg.textContent = 'Categoria aggiornata.'; const e = entries.find(x => x.id === wrap.dataset.prog); if (e) { e.cat = sel.value; e.catChosen = true; } }
    catch (err) { msg.textContent = err.message; }
  });

  // inserimento (coach e admin)
  const form = document.getElementById('lib-form');
  if (form && meta.isCoach) {
    form.hidden = false;
    let parsed = null;
    const $ = id => document.getElementById(id);
    $('lib-text').placeholder = cfg.placeholder;
    $('lib-user').innerHTML = (meta.athletes || []).map(u => `<option value="${LibUI.e(u)}">${LibUI.e(u)}</option>`).join('');
    $('lib-parse').onclick = async () => {
      const text = $('lib-text').value.trim(); if (!text) return;
      $('lib-parse').disabled = true; $('lib-msg').textContent = 'Analisi in corso…';
      try {
        parsed = (await LibUI.api('parse', { text, sport })).parsed;
        const guess = libCategory(sport, parsed);
        parsed.category = guess;
        $('lib-preview-body').innerHTML = `<div class="ld-recipe-head"><b>${LibUI.e(parsed.title)}</b></div>
          <div style="margin:4px 0 8px"><label class="ld-muted">Categoria <select id="lib-cat">${Object.entries(LIB_CATS[sport]).map(([k, l]) => `<option value="${k}"${k === guess ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <span class="ld-muted">proposta dal sito, cambiala se non è giusta: serve al consiglio del giorno</span></div>` + LibUI.html(parsed);
        $('lib-cat').onchange = () => { parsed.category = $('lib-cat').value; };
        $('lib-preview').hidden = false; $('lib-msg').textContent = '';
      } catch (err) { parsed = null; $('lib-preview').hidden = true; $('lib-msg').innerHTML = `<span class="ld-err">${LibUI.e(err.message)}</span>`; }
      $('lib-parse').disabled = false;
    };
    $('lib-save').onclick = async () => {
      if (!parsed) return;
      $('lib-save').disabled = true;
      try {
        if ($('lib-cat')) parsed.category = $('lib-cat').value;
        await LibUI.api('save', { text: $('lib-text').value.trim(), parsed, date: $('lib-date').value || null, user: $('lib-user').value || undefined });
        $('lib-text').value = ''; $('lib-date').value = ''; $('lib-preview').hidden = true; parsed = null;
        $('lib-msg').innerHTML = '<span class="ld-ok">Inserito in libreria.</span>';
        initLibraryRefresh(sport);
      } catch (err) { $('lib-msg').innerHTML = `<span class="ld-err">${LibUI.e(err.message)}</span>`; }
      $('lib-save').disabled = false;
    };
  }
}

function initLibraryRefresh(sport) {
  const old = document.getElementById('lib-list');
  const fresh = old.cloneNode(false);   // toglie i listener del giro precedente
  old.parentNode.replaceChild(fresh, old);
  const form = document.getElementById('lib-form');
  if (form) form.hidden = true;
  return initLibrary(sport);
}
