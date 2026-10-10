// Lodestar — nutrizione: obiettivi giornalieri, pasti consigliati (pranzo e cena) e diario in linguaggio naturale.
// Gli obiettivi sono STIME ragionate (peso, andamento, attivita' recenti): servono a orientare, non a prescrivere.

const CAT_LABELS = { carne: '🥩 Carne', pesce: '🐟 Pesce', pollo: '🍗 Pollo', legumi: '🫘 Legumi', uova: '🥚 Uova e latticini' };
const SLOT_LABELS = { colazione: 'Colazione', pranzo: 'Pranzo', cena: 'Cena', spuntino: 'Spuntino' };

const nutriState = { csrf: '', recipes: [], meals: [], me: '', canManage: false, weights: [], activities: [], profile: null };

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function nutriApi(action, body) {
  const opt = { credentials: 'same-origin', cache: 'no-store' };
  if (body) {
    opt.method = 'POST';
    opt.headers = { 'Content-Type': 'application/json', 'X-CSRF': nutriState.csrf };
    opt.body = JSON.stringify(body);
  }
  const res = await fetch('/lodestar/nutrizione-api.php?action=' + action, opt);
  let out = null;
  try { out = await res.json(); } catch (e) { /* risposta non JSON */ }
  if (!res.ok) throw new Error((out && out.error) || 'Errore ' + res.status);
  if (out && out.csrf) nutriState.csrf = out.csrf;
  return out;
}

async function nutriLoad() {
  const [rec, meals, weights, acts, prof] = await Promise.all([
    nutriApi('recipes'), nutriApi('meals&days=21'),
    fetchJSONSafe('/data/withings-weight.json', []), fetchJSONSafe('/data/garmin-activities.json', []),
    fetchJSONSafe('/lodestar/profile-api.php?action=get', { profile: null }),
  ]);
  nutriState.profile = (prof && prof.profile) || null;
  nutriState.recipes = rec.recipes; nutriState.me = rec.me; nutriState.canManage = rec.can_manage;
  nutriState.meals = meals.meals; nutriState.weights = weights; nutriState.activities = acts;
}

// ---------- obiettivi giornalieri ----------
function weightInfo(weights) {
  const w = (weights || []).filter(x => x.weight != null);
  if (!w.length) return { kg: 75, trend: null };
  const avg = list => list.reduce((s, x) => s + x.weight, 0) / list.length;
  const recent = w.filter(x => daysSinceDate(x.date) <= 10), before = w.filter(x => daysSinceDate(x.date) > 10 && daysSinceDate(x.date) <= 24);
  const trend = recent.length >= 2 && before.length >= 2 ? avg(recent) - avg(before) : null; // kg in ~2 settimane
  return { kg: w[0].weight, trend };
}

function dailyTarget() {
  const { kg, trend } = weightInfo(nutriState.weights);
  const acts = nutriState.activities;
  const last14 = acts.filter(a => daysSinceDate(a.date) >= 0 && daysSinceDate(a.date) < 14).reduce((s, a) => s + (a.calories || 0), 0);
  const todayKcal = acts.filter(a => a.date === todayISO()).reduce((s, a) => s + (a.calories || 0), 0);
  const pr = nutriState.profile;
  let base = kg * 30;                                    // senza profilo: stima di massima sul peso
  let baseTxt = `peso ${kg.toFixed(1).replace('.', ',')} kg`;
  if (pr && pr.sex && pr.birth_year && pr.height_cm) {   // con il profilo: formula di Mifflin-St Jeor per il metabolismo basale
    const age = new Date().getFullYear() - pr.birth_year;
    const bmr = 10 * kg + 6.25 * pr.height_cm - 5 * age + (pr.sex === 'm' ? 5 : -161);
    base = bmr * ({ low: 1.2, mid: 1.35, high: 1.5 }[pr.activity] || 1.35);
    baseTxt = `peso ${kg.toFixed(1).replace('.', ',')} kg, metabolismo ~${Math.round(bmr)} kcal`;
  }
  const allowance = 0.7 * Math.max(last14 / 14, todayKcal); // media giornaliera di movimento (o quanto fatto oggi, se di piu')
  let goal = (pr && pr.goal) || 'lose';
  const reached = pr && pr.target_weight_kg && ((goal === 'lose' && kg <= pr.target_weight_kg + 0.3) || (goal === 'gain' && kg >= pr.target_weight_kg - 0.3));
  let deficit = 450;
  let why = 'deficit moderato di 450 kcal';
  if (reached) { goal = 'maintain'; }
  if (goal === 'maintain') { deficit = 0; why = reached ? 'peso obiettivo raggiunto: mantenimento' : 'mantenimento del peso'; }
  else if (goal === 'gain') {
    deficit = -300; why = 'surplus di 300 kcal per mettere massa';
    if (trend != null && trend >= 0.8) { deficit = -150; why = 'peso già in salita veloce: surplus ridotto a 150 kcal'; }
  } else if (trend != null && trend <= -1.2) { deficit = 200; why = 'peso già in calo veloce: deficit ridotto a 200 kcal'; }
  else if (trend != null && trend >= 0.3) { deficit = 550; why = 'peso in aumento: deficit di 550 kcal'; }
  else if (trend != null && trend < -0.5) { deficit = 350; why = 'peso in calo: deficit di 350 kcal'; }
  const kcal = Math.round((base + allowance - deficit) / 10) * 10;
  const protein = Math.round(kg * (goal === 'gain' ? 1.8 : 1.9));
  const fat = Math.round(kg * 0.9);
  const carbs = Math.max(Math.round(kg * 2.5), Math.round((kcal - protein * 4 - fat * 9) / 4));
  const parts = [baseTxt, `movimento medio ~${Math.round(allowance)} kcal/giorno`, why];
  return { kcal, protein, carbs, fat, kg, why: parts.join(' · ') };
}

// Categorie di ricette adatte all'alimentazione scelta nel profilo.
function allowedCats() {
  const d = nutriState.profile && nutriState.profile.diet;
  return d === 'veg' ? ['legumi', 'uova'] : (d === 'pesce' ? ['pesce', 'legumi', 'uova'] : Object.keys(CAT_LABELS));
}

function mealsOn(date) { return nutriState.meals.filter(m => m.date === date); }
function sumMeals(list) { return list.reduce((t, m) => ({ kcal: t.kcal + (m.kcal || 0), protein: t.protein + (m.protein || 0), carbs: t.carbs + (m.carbs || 0), fat: t.fat + (m.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 }); }

// Budget del pasto da proporre: cio' che resta nella giornata, diviso tra i pasti principali ancora da fare.
function slotBudget(slot, target) {
  const today = mealsOn(todayISO());
  const eaten = sumMeals(today).kcal;
  const has = s => today.some(m => m.slot === s);
  const reserve = target.kcal * 0.08 + (has('colazione') ? 0 : target.kcal * 0.18);
  const avail = Math.max(target.kcal * 0.3, target.kcal - eaten - reserve);
  const open = ['pranzo', 'cena'].filter(s => !has(s));
  let share = 1;
  if (open.length === 2) share = slot === 'pranzo' ? 0.55 : 0.45;
  return Math.max(450, Math.min(1000, Math.round(avail * share / 10) * 10));
}

// ---------- scelta del pasto ----------
const CAT_WORDS = {
  pollo: /pollo|tacchino|petto/i, pesce: /pesce|salmone|tonno|merluzzo|orata|branzino|gamber|polpo|sgombro|calamar|cozze|vongol/i,
  carne: /manzo|carne|maiale|vitello|hamburger|bistecca|salsiccia|prosciutto|bresaola|ragù|ragu|polpett|wurstel|salame/i,
  legumi: /ceci|lenticchi|fagioli|piselli|legumi|tofu|hummus|soia/i, uova: /uov|frittata|omelette|formaggio|ricotta|mozzarella|parmigiano|feta|yogurt|latte/i,
};
function mealCategories(m) {
  if (m.category) return [m.category];
  const txt = (m.text || '') + ' ' + (m.summary || '');
  return Object.keys(CAT_WORDS).filter(c => CAT_WORDS[c].test(txt));
}

function hash(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

function rankRecipes(slot, budget, target, filter) {
  const recent = nutriState.meals.filter(m => daysSinceDate(m.date) <= 2);
  const veryRecent = nutriState.meals.filter(m => daysSinceDate(m.date) <= 7);
  const catRecent = {}; recent.forEach(m => mealCategories(m).forEach(c => { catRecent[c] = (catRecent[c] || 0) + 1; }));
  const todayCats = new Set(mealsOn(todayISO()).flatMap(mealCategories));
  const usedIds = new Set(veryRecent.map(m => m.recipe_id).filter(Boolean));
  const trainingHeavy = nutriState.activities.some(a => daysSinceDate(a.date) <= 0 && (a.calories || 0) >= 350);
  const ok = allowedCats();
  const list = nutriState.recipes.filter(r => ok.includes(r.category) && (r.meal === 'entrambi' || r.meal === slot) && (!filter || r.category === filter));
  return list.map(r => {
    const portion = Math.max(0.7, Math.min(1.4, Math.round(budget / r.kcal * 20) / 20));
    const kcal = r.kcal * portion;
    let score = -Math.abs(kcal - budget) / budget * 3;
    score += Math.min(1, (r.protein * portion * 4 / kcal) / 0.28) * 1.2;       // proteine alte
    if (trainingHeavy) score += Math.min(1, (r.carbs * 4 / r.kcal) / 0.5) * 0.6; // giorni di allenamento: piu' carboidrati
    score -= (catRecent[r.category] || 0) * 0.7;                                  // varia la proteina rispetto agli ultimi giorni
    if (todayCats.has(r.category)) score -= 0.8;
    if (usedIds.has(r.id)) score -= 1.5;
    score += (hash(r.id + todayISO() + slot) % 100) / 100 * 0.6;                  // varieta' stabile nel giorno
    return { recipe: r, portion, score };
  }).sort((a, b) => b.score - a.score);
}

// Pasto da mostrare: l'n-esimo della classifica (n cresce a ogni "Cambia"; il filtro categoria e' dell'utente).
const pick = {};  // { pranzo: {n, filter}, cena: {...} } per la sessione della pagina
function currentPick(slot, target) {
  const st = pick[slot] || (pick[slot] = { n: 0, filter: null });
  const ranked = rankRecipes(slot, slotBudget(slot, target), target, st.filter);
  if (!ranked.length) return { st, ranked, choice: null };
  return { st, ranked, choice: ranked[st.n % ranked.length] };
}

function why(slot, choice, target) {
  const r = choice.recipe;
  const bits = [`~${Math.round(r.kcal * choice.portion)} kcal per stare nell'obiettivo di oggi`];
  const recent = nutriState.meals.filter(m => daysSinceDate(m.date) <= 2 && mealCategories(m).includes(r.category));
  bits.push(recent.length ? `${CAT_LABELS[r.category].replace(/^\S+\s/, '').toLowerCase()} già presente di recente: scelta alternativa` : `cambia la fonte di proteine rispetto agli ultimi giorni`);
  if (r.protein * choice.portion >= 40) bits.push(`${Math.round(r.protein * choice.portion)} g di proteine per il recupero`);
  return bits.join(' · ');
}

const f1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');

function mealCardHTML(slot, target) {
  const { st, ranked, choice } = currentPick(slot, target);
  const label = SLOT_LABELS[slot];
  const logged = mealsOn(todayISO()).find(m => m.slot === slot);
  const chips = allowedCats().map(c => `<button type="button" class="ld-cat${st.filter === c ? ' on' : ''}" data-act="filter" data-slot="${slot}" data-cat="${c}">${CAT_LABELS[c]}</button>`).join('')
    + `<button type="button" class="ld-cat${st.filter ? '' : ' on'}" data-act="filter" data-slot="${slot}" data-cat="">🎲 Qualsiasi</button>`;
  if (logged) {
    return `<div class="ld-meal ld-meal-done"><div class="ld-meal-slot">${label}</div><div class="ld-meal-name">✅ ${esc(logged.summary)}</div>
      <div class="ld-muted">${logged.kcal} kcal · P ${logged.protein} g · C ${logged.carbs} g · G ${logged.fat} g — già registrato oggi</div></div>`;
  }
  if (!choice) return `<div class="ld-meal"><div class="ld-meal-slot">${label}</div><div class="ld-muted">Nessuna ricetta disponibile${st.filter ? ' per questa scelta' : ''}.</div><div class="ld-cats">${chips}</div></div>`;
  const r = choice.recipe, p = choice.portion;
  const ings = r.ingredients.map(i => `${esc(i.name)} ${Math.round(i.grams * p / 5) * 5} g`).join(' · ');
  return `<div class="ld-meal">
    <div class="ld-meal-slot">${label} <span class="ld-badge">${CAT_LABELS[r.category]}</span></div>
    <div class="ld-meal-name">${esc(r.name)}</div>
    <div class="ld-macros"><b>${Math.round(r.kcal * p)}</b> kcal · P ${Math.round(r.protein * p)} g · C ${Math.round(r.carbs * p)} g · G ${Math.round(r.fat * p)} g · porzione ×${f1(p)} · ${r.time_min} min</div>
    <div class="ld-ings">${ings}</div>
    <details class="ld-steps"><summary>Preparazione</summary>${esc(r.steps)}</details>
    <div class="ld-why">${esc(why(slot, choice, target))}</div>
    <div class="ld-meal-actions">
      <button type="button" class="ld-btn" data-act="eat" data-slot="${slot}">✅ L'ho mangiato</button>
      <button type="button" class="ld-btn ghost" data-act="change" data-slot="${slot}">🔄 Cambia</button>
      <span class="ld-muted">${ranked.length} opzioni</span>
    </div>
    <div class="ld-cats" ${st.open ? '' : 'hidden'}><span class="ld-muted">Cosa ti va di mangiare?</span> ${chips}</div>
  </div>`;
}

function budgetHTML(target) {
  const today = mealsOn(todayISO());
  const eaten = sumMeals(today);
  const pct = Math.min(100, Math.round(eaten.kcal / target.kcal * 100));
  const rest = target.kcal - eaten.kcal;
  return `<div class="ld-budget">
    <div class="ld-budget-top"><b>Obiettivo di oggi ~${target.kcal} kcal</b><span>${eaten.kcal} mangiate · ${rest >= 0 ? 'restano ' + rest : 'sopra di ' + (-rest)}</span></div>
    <div class="ld-bar"><div style="width:${pct}%"></div></div>
    <div class="ld-muted">Proteine ${eaten.protein}/${target.protein} g · Carboidrati ${eaten.carbs}/${target.carbs} g · Grassi ${eaten.fat}/${target.fat} g</div>
    <div class="ld-muted" style="margin-top:3px">Stima: ${esc(target.why)}.${nutriState.profile ? '' : ' <a class="reco-link" href="/lodestar/profilo.html">Completa il profilo per obiettivi su misura →</a>'}</div></div>`;
}

function diaryHTML() {
  const today = mealsOn(todayISO());
  const rows = today.map(m => `<div class="ld-diary-row"><span><b>${SLOT_LABELS[m.slot] || m.slot}</b> · ${esc(m.summary)} ${m.source === 'ai' ? '<span class="ld-badge" title="Calorie stimate da Claude: approssimative">stima</span>' : ''}</span><span>${m.kcal} kcal <button type="button" class="ld-x" data-act="del" data-id="${m.id}" title="Elimina">✕</button></span></div>`).join('');
  return `<div class="ld-diary">
    <div class="ld-diary-title">Cosa hai mangiato oggi?</div>
    ${rows || '<div class="ld-muted">Ancora niente di registrato.</div>'}
    <div class="ld-log"><textarea id="ld-logtext" rows="2" maxlength="1500" placeholder="Scrivilo come lo diresti a voce: es. «a colazione cappuccino e due fette biscottate con marmellata»"></textarea>
    <button type="button" class="ld-btn gold" data-act="log">Calcola e registra</button></div>
    <div class="ld-muted" id="ld-logmsg">Le calorie sono stimate da Claude, quindi approssimative: i prossimi consigli si adattano a quanto hai già mangiato.</div></div>`;
}

function renderNutritionPanel(el) {
  const target = dailyTarget();
  const keepText = (document.getElementById('ld-logtext') || {}).value || '';
  el.innerHTML = budgetHTML(target) + `<div class="ld-meals-grid">${mealCardHTML('pranzo', target)}${mealCardHTML('cena', target)}</div>` + diaryHTML();
  const ta = document.getElementById('ld-logtext'); if (ta) ta.value = keepText;
}

async function initNutritionPanel(el) {
  try {
    await nutriLoad();
  } catch (e) {
    el.innerHTML = `<div class="ld-err">Nutrizione non disponibile: ${esc(e.message)}</div>`;
    return;
  }
  renderNutritionPanel(el);
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const slot = b.dataset.slot, act = b.dataset.act, target = dailyTarget();
    const st = pick[slot] || (pick[slot] = { n: 0, filter: null });
    if (act === 'change') { st.n++; st.open = true; renderNutritionPanel(el); return; }
    if (act === 'filter') { st.filter = b.dataset.cat || null; st.n = 0; st.open = true; renderNutritionPanel(el); return; }
    b.disabled = true;
    try {
      if (act === 'eat') {
        const { choice } = currentPick(slot, target);
        const out = await nutriApi('log_meal', { recipe_id: choice.recipe.id, portion: choice.portion, slot, date: todayISO() });
        nutriState.meals.unshift(out.meal);
        for (const k of ['pranzo', 'cena']) if (pick[k]) pick[k] = { n: 0, filter: null };
      } else if (act === 'del') {
        await nutriApi('delete_meal', { id: b.dataset.id });
        nutriState.meals = nutriState.meals.filter(m => m.id !== b.dataset.id);
      } else if (act === 'log') {
        const text = document.getElementById('ld-logtext').value.trim();
        if (!text) { b.disabled = false; return; }
        document.getElementById('ld-logmsg').textContent = '⏳ Calcolo le calorie…';
        const out = await nutriApi('log_meal', { text, date: todayISO() });
        nutriState.meals.unshift(out.meal);
        document.getElementById('ld-logtext').value = '';
      }
      renderNutritionPanel(el);
    } catch (e) {
      b.disabled = false;
      const msg = document.getElementById('ld-logmsg');
      if (msg) msg.innerHTML = `<span class="ld-err">${esc(e.message)}</span>`;
    }
  });
}
