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
    const target = st.pace ? `${mmss(st.pace[0])}–${mmss(st.pace[1])}/km` : (st.hr_zone ? `Z${st.hr_zone}` : '');
    return `<b>${STEP[st.kind] || st.kind}</b> ${size}${target ? ' · ' + target : ''}${st.note ? ` <span class="cw-note">${e(st.note)}</span>` : ''}`;
  }

  function runHtml(p) {
    const items = p.steps.map(st => st.kind === 'repeat'
      ? `<li><b>${st.reps}×</b><ul>${st.steps.map(s => `<li>${runStep(s)}</li>`).join('')}</ul></li>`
      : `<li>${runStep(st)}</li>`).join('');
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
    if (sport === 'strength') return '<div class="ld-muted">Invio all\'orologio non ancora disponibile per la palestra.</div>';
    if (!canSend) return '';
    return `<div class="reco-send"><input type="date" class="reco-date" title="Giorno in calendario (facoltativo)"> <button type="button" class="cw-btn" data-send>Invia all'orologio</button> <span class="reco-send-msg"></span></div>`;
  }

  return { html, e, api, sendBox, totals, setCsrf: v => { csrf = v; }, getCsrf: () => csrf };
})();

// ---------- pagina di una libreria ----------
async function initLibrary(sport) {
  const cfg = SPORT_CONFIG[sport];
  const box = document.getElementById('lib-list');
  let data;
  try { data = await LibUI.api('library'); } catch (err) { box.innerHTML = `<div class="ld-err">${LibUI.e(err.message)}</div>`; return; }
  const programs = data.programs.filter(p => p.sport === sport);
  const canSend = data.can_send;

  const card = (title, tag, body, meta, extra, sendHtml) => `<div class="ld-recipe ld-wk"><div class="ld-recipe-head"><b>${LibUI.e(title)}</b> <span class="ld-badge">${LibUI.e(tag)}</span></div>
    ${meta ? `<div class="ld-muted" style="margin-bottom:6px">${meta}</div>` : ''}${body}${sendHtml}${extra || ''}<div class="cw-msg ld-muted"></div></div>`;

  const coachCards = programs.map(p => {
    const mine = p.created_by === data.me;
    const extra = data.is_coach ? `<div class="reco-send"><input type="date" class="reco-date" data-assign-date title="Giorno da assegnare all'atleta" value="${p.date || ''}"> <button type="button" class="cw-btn secondary" data-assign>Assegna</button>${mine ? ' <button type="button" class="cw-btn secondary" data-del>Elimina</button>' : ''}</div>` : '';
    const sends = (p.sends || []).length ? `<div class="ld-muted">✅ inviato ${(p.sends || []).map(s => s.date || 'libreria Garmin').join(' · ')}</div>` : '';
    return `<div data-prog="${p.id}">` + card(p.title, 'Coach · ' + p.created_by, LibUI.html(p.parsed) + sends, p.date ? 'assegnato al ' + p.date : '', extra, LibUI.sendBox(null, canSend, sport)) + '</div>';
  }).join('');

  const baseCards = cfg.catalog.map(c => `<div data-base="${c.id}">` + card(c.title, c.tag, LibUI.html(c.spec), c.note, '', LibUI.sendBox(null, canSend, sport)) + '</div>').join('');

  box.innerHTML = `<div class="sec">Dai coach</div>${coachCards ? `<div class="ld-recipes">${coachCards}</div>` : `<div class="ld-muted">Ancora nessun allenamento dei coach per la ${cfg.noun}.</div>`}
    <div class="sec">Allenamenti di base Lodestar</div><div class="ld-recipes">${baseCards}</div>`;

  box.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const wrap = b.closest('[data-prog],[data-base]');
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
      else await run(LibUI.api('send_plan', { plan: cfg.catalog.find(c => c.id === wrap.dataset.base).spec, date }), done);
    } else if (b.hasAttribute('data-assign')) {
      await run(LibUI.api('assign', { id: wrap.dataset.prog, date: wrap.querySelector('[data-assign-date]').value || null }), 'Assegnato.');
    } else if (b.hasAttribute('data-del')) {
      if (confirm('Eliminare questo allenamento dalla libreria?')) await run(LibUI.api('delete', { id: wrap.dataset.prog }));
    }
  });

  // inserimento (coach e admin)
  const form = document.getElementById('lib-form');
  if (form && data.is_coach) {
    form.hidden = false;
    let parsed = null;
    const $ = id => document.getElementById(id);
    $('lib-text').placeholder = cfg.placeholder;
    $('lib-parse').onclick = async () => {
      const text = $('lib-text').value.trim(); if (!text) return;
      $('lib-parse').disabled = true; $('lib-msg').textContent = 'Analisi in corso…';
      try {
        parsed = (await LibUI.api('parse', { text, sport })).parsed;
        $('lib-preview-body').innerHTML = `<div class="ld-recipe-head"><b>${LibUI.e(parsed.title)}</b></div>` + LibUI.html(parsed);
        $('lib-preview').hidden = false; $('lib-msg').textContent = '';
      } catch (err) { parsed = null; $('lib-preview').hidden = true; $('lib-msg').innerHTML = `<span class="ld-err">${LibUI.e(err.message)}</span>`; }
      $('lib-parse').disabled = false;
    };
    $('lib-save').onclick = async () => {
      if (!parsed) return;
      $('lib-save').disabled = true;
      try {
        await LibUI.api('save', { text: $('lib-text').value.trim(), parsed, date: $('lib-date').value || null });
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
