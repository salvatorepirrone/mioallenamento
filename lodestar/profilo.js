// Lodestar — pagina Profilo.
const P = id => document.getElementById(id);
let pfCsrf = '';

async function pfApi(action, payload) {
  const opt = payload === undefined ? { cache: 'no-store', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': pfCsrf }, body: JSON.stringify(payload) };
  const res = await fetch('/lodestar/profile-api.php?action=' + action, opt);
  let d = null; try { d = await res.json(); } catch (e) { /* non JSON */ }
  if (!res.ok) throw new Error((d && d.error) || 'Errore ' + res.status);
  if (d && d.csrf) pfCsrf = d.csrf;
  return d;
}

function fill(p) {
  if (!p) return;
  P('p-sex').value = p.sex || ''; P('p-birth').value = p.birth_year || ''; P('p-height').value = p.height_cm || '';
  P('p-goal').value = p.goal || 'lose'; P('p-target').value = p.target_weight_kg || '';
  P('p-activity').value = p.activity || 'mid'; P('p-diet').value = p.diet || 'all';
}

P('p-save').onclick = async () => {
  const st = P('p-status');
  st.textContent = 'Salvo…';
  try {
    await pfApi('save', { profile: {
      sex: P('p-sex').value, birth_year: Number(P('p-birth').value), height_cm: Number(P('p-height').value), goal: P('p-goal').value,
      target_weight_kg: P('p-target').value, activity: P('p-activity').value, diet: P('p-diet').value } });
    st.innerHTML = '<span class="ld-ok">✅ Profilo salvato: gli obiettivi di nutrizione si aggiornano da subito.</span>';
  } catch (e) { st.innerHTML = `<span class="ld-err">${String(e.message).replace(/</g, '&lt;')}</span>`; }
};

(async () => {
  try { fill((await pfApi('get')).profile); } catch (e) { P('pf-msg').innerHTML = `<div class="ld-err">${String(e.message).replace(/</g, '&lt;')}</div>`; }
})();
