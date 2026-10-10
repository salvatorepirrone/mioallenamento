// Lodestar — pagina Collegamenti: Garmin (accesso una tantum, nessuna password conservata), Withings (OAuth) e sincronizzazione.
const $ = id => document.getElementById(id);
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let csrf = '';
let state = null;

async function cnApi(action, payload) {
  const opt = payload === undefined ? { cache: 'no-store', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(payload) };
  const res = await fetch('/lodestar/connect-api.php?action=' + action, opt);
  let d = null; try { d = await res.json(); } catch (e) { /* non JSON */ }
  if (!res.ok) throw new Error((d && d.error) || 'Errore ' + res.status);
  if (d && d.csrf) csrf = d.csrf;
  return d;
}

function when(ts) { return ts ? new Date(ts * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

function renderGarmin(extra) {
  const ok = state.connected.garmin;
  if (ok) {
    $('cn-garmin').innerHTML = `<div class="reco-title">✅ Garmin collegato${state.garmin_name ? ' · ' + E(state.garmin_name) : ''}</div>
      <div class="ld-muted">Attività, training readiness, VO2max, FC a riposo e peso arrivano da Garmin Connect.</div>
      ${state.legacy ? '<div class="ld-muted">Account gestito dal server.</div>' : '<div style="margin-top:8px"><button class="ld-btn ghost" id="g-off" type="button">Scollega Garmin</button></div>'}`;
    const off = $('g-off'); if (off) off.onclick = () => disconnect('garmin');
    return;
  }
  const mfa = extra && extra.mfa;
  $('cn-garmin').innerHTML = `<div class="reco-title">Collega Garmin Connect</div>
    <div class="ld-muted" style="margin:4px 0 8px">Inserisci email e password del tuo account Garmin. Servono una sola volta per l'accesso: non vengono salvate. Se hai la verifica in due passaggi, ti chiederemo il codice.</div>
    ${mfa ? `<div class="ld-adapt">Garmin ha inviato un codice di verifica alla tua email o al telefono: inseriscilo qui sotto.</div>
      <div class="cn-row"><input id="g-code" inputmode="numeric" maxlength="10" placeholder="Codice di verifica" autocomplete="one-time-code"> <button class="ld-btn gold" id="g-mfa" type="button">Conferma codice</button></div>`
    : `<div class="cn-row"><input id="g-email" type="email" placeholder="Email Garmin" autocomplete="off"> <input id="g-pw" type="password" placeholder="Password Garmin" autocomplete="off"> <button class="ld-btn gold" id="g-go" type="button">Collega</button></div>`}
    <div id="g-msg" class="ld-muted" style="margin-top:6px">${extra && extra.msg ? extra.msg : ''}</div>`;
  if (mfa) $('g-mfa').onclick = () => garminStep('garmin_mfa', { code: $('g-code').value });
  else $('g-go').onclick = () => garminStep('garmin_start', { email: $('g-email').value, password: $('g-pw').value });
}

async function garminStep(action, payload) {
  const btn = document.querySelector('#cn-garmin button'); if (btn) btn.disabled = true;
  $('g-msg').textContent = 'Un momento… (può servire fino a mezzo minuto)';
  try {
    let st = (await cnApi(action, payload)).status || {};
    for (let i = 0; i < 20 && st.state === 'starting'; i++) { await new Promise(r => setTimeout(r, 2000)); st = (await cnApi('garmin_status')).status || {}; }
    if (st.state === 'mfa_required') { renderGarmin({ mfa: true }); return; }
    if (st.state === 'ok') { await load(); startSync(); return; }
    renderGarmin({ msg: `<span class="ld-err">${E(st.error || 'Accesso non riuscito: riprova.')}</span>` });
  } catch (e) { renderGarmin({ msg: `<span class="ld-err">${E(e.message)}</span>` }); }
}

function renderWithings() {
  if (state.connected.withings) {
    $('cn-withings').innerHTML = `<div class="reco-title">✅ Withings collegato</div>
      <div class="ld-muted">Peso, composizione corporea e sonno arrivano dalla tua bilancia e dal tuo tracker Withings.</div>
      ${state.legacy ? '<div class="ld-muted">Account gestito dal server.</div>' : '<div style="margin-top:8px"><button class="ld-btn ghost" id="w-off" type="button">Scollega Withings</button></div>'}`;
    const off = $('w-off'); if (off) off.onclick = () => disconnect('withings');
    return;
  }
  $('cn-withings').innerHTML = `<div class="reco-title">Collega Withings</div>
    <div class="ld-muted" style="margin:4px 0 8px">Ti portiamo sul sito di Withings per autorizzare la lettura di peso e sonno, poi torni qui.</div>
    <button class="ld-btn gold" id="w-go" type="button">Collega Withings</button> <span id="w-msg" class="ld-muted"></span>`;
  $('w-go').onclick = async () => {
    try { location.href = (await cnApi('withings_url')).url; } catch (e) { $('w-msg').innerHTML = `<span class="ld-err">${E(e.message)}</span>`; }
  };
}

async function disconnect(service) {
  if (!confirm('Scollegare ' + (service === 'garmin' ? 'Garmin' : 'Withings') + '? I dati di questo servizio verranno cancellati da Lodestar.')) return;
  try { await cnApi('disconnect', { service }); await load(); } catch (e) { $('cn-msg').innerHTML = `<div class="ld-err">${E(e.message)}</div>`; }
}

function renderSync() {
  const any = state.connected.garmin || state.connected.withings;
  const s = state.sync || {};
  const res = s.results || {};
  const lines = Object.keys(res).map(k => `${k === 'garmin' ? 'Garmin' : 'Withings'}: ${res[k].ok ? '✅ ok' : '<span class="ld-err">' + E(res[k].error || 'errore') + '</span>'}`).join(' · ');
  $('cn-sync').innerHTML = !any ? '<div class="ld-muted">Collega almeno un servizio per sincronizzare i dati.</div>'
    : `<div class="ld-muted">${s.state === 'running' ? '⏳ Sincronizzazione in corso… la prima può richiedere qualche minuto.' : (s.finished ? 'Ultima sincronizzazione: ' + when(s.finished) : 'Non ancora sincronizzato.')}${lines ? ' · ' + lines : ''}</div>
       <div style="margin-top:8px"><button class="ld-btn" id="s-go" type="button" ${s.state === 'running' ? 'disabled' : ''}>🔄 Sincronizza ora</button></div>
       <div class="ld-muted" style="margin-top:6px">Lodestar sincronizza da sola quando apri il sito (al massimo ogni 20 minuti).</div>`;
  const b = $('s-go'); if (b) b.onclick = startSync;
}

async function startSync() {
  try { await cnApi('sync_start', {}); } catch (e) { /* già in corso */ }
  pollSync();
}
async function pollSync() {
  for (let i = 0; i < 400; i++) {
    const s = (await cnApi('sync_status')).sync || {};
    state.sync = s; renderSync();
    if (s.state !== 'running') return;
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function load() {
  state = await cnApi('status');
  renderGarmin(); renderWithings(); renderSync();
}

(async function init() {
  const q = new URLSearchParams(location.search);
  try {
    await load();
    if (q.get('code') && q.get('state')) {                       // ritorno da Withings
      $('cn-msg').innerHTML = '<div class="ld-card">⏳ Completo il collegamento con Withings… (fino a un minuto)</div>';
      history.replaceState(null, '', location.pathname);
      try { await cnApi('withings_callback', { code: q.get('code'), state: q.get('state') }); $('cn-msg').innerHTML = '<div class="ld-card ld-ok">✅ Withings collegato.</div>'; await load(); startSync(); }
      catch (e) { $('cn-msg').innerHTML = `<div class="ld-card ld-err">${E(e.message)}</div>`; }
    } else if (state.sync && state.sync.state === 'running') pollSync();
  } catch (e) { $('cn-msg').innerHTML = `<div class="ld-err">${E(e.message)}</div>`; }
})();
