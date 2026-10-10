// Lodestar — pagina Libreria ricette: diario settimanale, inserimento ricette a parole, elenco con filtri.
let filterCat = '', filterMeal = '', filterText = '';
let draft = null;

function renderWeek() {
  const t = dailyTarget();
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = isoLocal(d), day = mealsOn(iso), s = sumMeals(day);
    const pct = Math.min(100, Math.round(s.kcal / t.kcal * 100));
    rows.push(`<div class="ld-weekrow"><span>${i === 0 ? 'Oggi' : actDateLabel(iso)}</span><div class="ld-bar"><div style="width:${pct}%"></div></div>
      <span>${day.length ? s.kcal + ' kcal · P ' + s.protein + ' g' : '—'}</span></div>`);
  }
  document.getElementById('ld-week').innerHTML = rows.join('') + `<div class="ld-muted" style="margin-top:6px">Obiettivo giornaliero stimato ~${t.kcal} kcal. Registra i pasti dalla <a class="reco-link" href="/lodestar/">Home</a>.</div>`;
}

function recipeCard(r) {
  const canDelete = nutriState.canManage || (!r.seed && r.added_by === nutriState.me);
  const ings = r.ingredients.map(i => `${esc(i.name)} ${i.grams} g`).join(' · ');
  return `<div class="ld-recipe"><div class="ld-recipe-head"><b>${esc(r.name)}</b> <span class="ld-badge">${CAT_LABELS[r.category]}</span>
    <span class="ld-badge alt">${r.meal === 'entrambi' ? 'pranzo/cena' : r.meal}</span></div>
    <div class="ld-macros"><b>${r.kcal}</b> kcal · P ${r.protein} g · C ${r.carbs} g · G ${r.fat} g · ${r.time_min} min</div>
    <details class="ld-steps"><summary>Ingredienti e preparazione</summary><div class="ld-ings">${ings}</div><div style="margin-top:6px">${esc(r.steps)}</div>
    <div class="ld-muted" style="margin-top:6px">Inserita da ${esc(r.added_by || '—')}${canDelete ? ` · <a href="#" data-del="${r.id}" class="reco-link">elimina</a>` : ''}</div></details></div>`;
}

function renderList() {
  const q = filterText.toLowerCase();
  const list = nutriState.recipes.filter(r => (!filterCat || r.category === filterCat) && (!filterMeal || r.meal === 'entrambi' || r.meal === filterMeal)
    && (!q || (r.name + ' ' + r.ingredients.map(i => i.name).join(' ')).toLowerCase().includes(q)));
  document.getElementById('r-list').innerHTML = list.length ? `<div class="ld-recipes">${list.map(recipeCard).join('')}</div>` : '<div class="ld-muted">Nessuna ricetta con questi filtri.</div>';
}

function renderFilters() {
  const cats = Object.keys(CAT_LABELS).map(c => `<button type="button" class="ld-cat${filterCat === c ? ' on' : ''}" data-cat="${c}">${CAT_LABELS[c]}</button>`).join('');
  const meals = ['pranzo', 'cena'].map(m => `<button type="button" class="ld-cat${filterMeal === m ? ' on' : ''}" data-meal="${m}">${SLOT_LABELS[m]}</button>`).join('');
  document.getElementById('r-filters').innerHTML = `<button type="button" class="ld-cat${!filterCat ? ' on' : ''}" data-cat="">Tutte</button>${cats} <span class="ld-sep"></span>${meals}
    <input id="r-search" type="search" placeholder="Cerca ricetta o ingrediente" value="${esc(filterText)}">`;
  document.getElementById('r-search').addEventListener('input', e => { filterText = e.target.value; renderList(); });
}

document.getElementById('r-filters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if ('cat' in b.dataset) filterCat = b.dataset.cat;
  if ('meal' in b.dataset) filterMeal = filterMeal === b.dataset.meal ? '' : b.dataset.meal;
  renderFilters(); renderList();
});

document.getElementById('r-list').addEventListener('click', async e => {
  const a = e.target.closest('[data-del]'); if (!a) return;
  e.preventDefault();
  if (!confirm('Eliminare questa ricetta dalla libreria?')) return;
  try { await nutriApi('delete_recipe', { id: a.dataset.del }); nutriState.recipes = nutriState.recipes.filter(r => r.id !== a.dataset.del); renderList(); }
  catch (err) { alert(err.message); }
});

function renderPreview() {
  const box = document.getElementById('r-preview');
  if (!draft) { box.innerHTML = ''; return; }
  const catOpts = Object.keys(CAT_LABELS).map(c => `<option value="${c}"${draft.category === c ? ' selected' : ''}>${CAT_LABELS[c]}</option>`).join('');
  const mealOpts = ['entrambi', 'pranzo', 'cena'].map(m => `<option value="${m}"${draft.meal === m ? ' selected' : ''}>${m === 'entrambi' ? 'pranzo e cena' : m}</option>`).join('');
  box.innerHTML = `<div class="ld-recipe" style="margin-top:12px"><div class="ld-muted">Controlla la scheda (valori per una porzione${draft.servings_in_text > 1 ? ', ricetta divisa in ' + draft.servings_in_text : ''}):</div>
    <div class="ld-recipe-head"><input id="d-name" value="${esc(draft.name)}" style="flex:1;min-width:200px;padding:6px;border:1px solid var(--border);border-radius:8px;font:inherit">
    <select id="d-cat">${catOpts}</select><select id="d-meal">${mealOpts}</select></div>
    <div class="ld-macros"><b>${draft.kcal}</b> kcal · P ${draft.protein} g · C ${draft.carbs} g · G ${draft.fat} g · ${draft.time_min} min</div>
    <div class="ld-ings">${draft.ingredients.map(i => esc(i.name) + ' ' + i.grams + ' g').join(' · ')}</div>
    <div class="ld-muted" style="margin:6px 0">${esc(draft.steps)}</div>
    <button class="ld-btn gold" id="d-save" type="button">Inserisci in libreria</button> <button class="ld-btn ghost" id="d-cancel" type="button">Annulla</button></div>`;
  document.getElementById('d-cancel').onclick = () => { draft = null; renderPreview(); };
  document.getElementById('d-save').onclick = async () => {
    draft.name = document.getElementById('d-name').value; draft.category = document.getElementById('d-cat').value; draft.meal = document.getElementById('d-meal').value;
    try {
      const out = await nutriApi('save_recipe', { recipe: draft });
      nutriState.recipes.unshift(out.recipe); draft = null; renderPreview(); renderList();
      document.getElementById('r-text').value = '';
      document.getElementById('r-msg').innerHTML = '<span class="ld-ok">Ricetta inserita.</span>';
    } catch (err) { document.getElementById('r-msg').innerHTML = `<span class="ld-err">${esc(err.message)}</span>`; }
  };
}

document.getElementById('r-parse').addEventListener('click', async ev => {
  const text = document.getElementById('r-text').value.trim();
  const msg = document.getElementById('r-msg');
  if (!text) return;
  ev.target.disabled = true; msg.textContent = '⏳ Analizzo la ricetta…';
  try { draft = (await nutriApi('parse_recipe', { text })).recipe; msg.textContent = ''; renderPreview(); }
  catch (err) { msg.innerHTML = `<span class="ld-err">${esc(err.message)}</span>`; }
  ev.target.disabled = false;
});

(async () => {
  try { await nutriLoad(); } catch (e) { document.getElementById('r-list').innerHTML = `<div class="ld-err">${esc(e.message)}</div>`; return; }
  renderWeek(); renderFilters(); renderList();
})();
