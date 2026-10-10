// Lodestar — guida del primo accesso: profilo, collegamenti Garmin e Withings, poi la home.
async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('Errore ' + res.status);
  return res.json();
}

function step(n, done, title, text, href, cta) {
  return `<div class="wz-step${done ? ' done' : ''}"><div class="wz-num">${done ? '✓' : n}</div>
    <div class="wz-body"><div class="reco-title">${title}</div><div class="ld-muted">${text}</div></div>
    <a class="ld-btn${done ? ' ghost' : ' gold'}" href="${href}">${done ? 'Modifica' : cta}</a></div>`;
}

let csrf = '';
(async () => {
  let profile = null, hints = null, hintsSource = '', conn = { connected: { garmin: false, withings: false } };
  try {
    const p = await getJSON('/lodestar/profile-api.php?action=get');
    profile = p.profile; csrf = p.csrf; hints = p.hints; hintsSource = p.hints_source || '';
    conn = await getJSON('/lodestar/connect-api.php?action=status');
  } catch (e) { document.getElementById('wz').innerHTML = `<div class="ld-err">${String(e.message).replace(/</g, '&lt;')}</div>`; return; }
  // Il profilo viene per ultimo: sesso, anno di nascita e altezza arrivano da Garmin o Withings, resta da scegliere il resto.
  const have = hints ? [hints.sex ? 'sesso' : null, hints.birth_year ? 'anno di nascita' : null, hints.height_cm ? 'altezza' : null].filter(Boolean) : [];
  const missing = ['sesso', 'anno di nascita', 'altezza'].filter(x => !have.includes(x)).concat(['obiettivo di peso', 'vita quotidiana', 'alimentazione']);
  const profileText = have.length
    ? `Ho già letto da ${hintsSource || 'Garmin'}: ${have.join(', ')}. Ti restano: ${missing.join(', ')}.`
    : 'Sesso, età, altezza, obiettivo e alimentazione: servono per calcolare calorie e pasti su misura. Se prima colleghi Garmin o Withings, parte dei dati si compila da sola.';
  document.getElementById('wz').innerHTML =
    step(1, conn.connected.garmin, 'Collega Garmin', 'Attività, training readiness, VO2max e FC a riposo: sono la base dei consigli di allenamento. Se non usi Garmin puoi saltare.', '/lodestar/collegamenti.html?from=benvenuto', 'Collega Garmin') +
    step(2, conn.connected.withings, 'Collega Withings', 'Peso, composizione corporea e sonno dalla tua bilancia e dal tuo tracker. Facoltativo.', '/lodestar/collegamenti.html?from=benvenuto', 'Collega Withings') +
    step(3, !!profile, 'Completa il profilo', profileText, '/lodestar/profilo.html?from=benvenuto', 'Completa il profilo');
  document.getElementById('wz-go').onclick = async () => {
    try { await fetch('/lodestar/profile-api.php?action=onboarded', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: '{}' }); } catch (e) { /* si riprova la prossima volta */ }
    location.href = '/lodestar/';
  };
})();
