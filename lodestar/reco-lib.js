// Lodestar — il consiglio del giorno attinge alla libreria unica (allenamenti Lodestar + dei coach).
// Il motore (engine.js) decide COSA serve oggi (recupero, base, lungo, qualita'; nuoto leggero, tecnica, velocita'; forza);
// qui, se in libreria ci sono allenamenti dei coach di quella categoria non fatti da poco, uno di questi prende il posto della
// seduta generata dal motore (ridotta alla forma del momento). Senza voci dei coach resta la seduta adattata dal motore.

const RECO_RUN_CATS = { facile: ['recupero'], base: ['base', 'recupero'], lungo: ['lungo'], velocita: ['qualita'], soglia: ['qualita'], fartlek: ['qualita'], progressivo: ['qualita'], vo2: ['qualita'] };
const RECO_SWIM_CATS = { leggero: ['leggero'], velocita: ['velocita'], tecnica: ['tecnica', 'resistenza'] };

function recoRecentlyDone(title, activities, days) {
  const t = String(title).toLowerCase();
  return activities.some(a => daysSinceDate(a.date) <= days && (a.name || '').toLowerCase().includes(t));
}

// Sceglie in rotazione (stabile nel giorno) tra gli allenamenti dei coach della categoria e la seduta adattata dal motore (null).
function recoPickCoach(entries, cats, activities) {
  const pool = entries.filter(e => e.source === 'coach' && cats.includes(e.cat) && !recoRecentlyDone(e.title, activities, 10));
  if (!pool.length) return null;
  const i = dayOfYear() % (pool.length + 1);
  return i === pool.length ? null : pool[i];
}

function recoFromEntry(entry, factor) {
  const spec = scaleSpec(entry.spec, factor);
  const scaled = spec !== entry.spec;
  return {
    label: entry.title, by: entry.createdBy, entryId: entry.id, spec,
    html: LibUI.html(spec) + (scaled ? `<div class="reco-opt-meta">Volume ridotto per la forma di oggi (×${Math.max(0.5, factor).toFixed(2).replace('.', ',')})</div>` : ''),
  };
}

function applyLibrary(model, library, activities) {
  const factor = Math.min(1, model.form ? model.form.factor : 1);
  const note = by => `Presa dalla libreria: allenamento di ${by}.`;
  const runEntry = recoPickCoach(library.running || [], RECO_RUN_CATS[model.runChoice] || [], activities);
  if (runEntry) {
    const r = recoFromEntry(runEntry, factor);
    model.run = Object.assign(r, { link: '/lodestar/corsa.html#e-' + runEntry.id });
    model.runNote = note(runEntry.createdBy);
  }
  const swimEntry = recoPickCoach(library.swimming || [], RECO_SWIM_CATS[model.swimChoice] || [], activities);
  if (swimEntry) {
    const r = recoFromEntry(swimEntry, factor);
    model.swim = Object.assign(r, { link: '/lodestar/nuoto.html#e-' + swimEntry.id });
    model.swimNote = note(swimEntry.createdBy);
  }
  // forza: una seduta della libreria (Lodestar o coach), a rotazione e non fatta da poco
  const gymPool = (library.strength || []).filter(e => !recoRecentlyDone(e.title, activities, 6));
  if (gymPool.length && !model.recoveryMode) {
    const done30 = activities.filter(a => a.type === GYM_TYPE && daysSinceDate(a.date) <= 30).length;
    const e = gymPool[done30 % gymPool.length];
    const r = recoFromEntry(e, factor);
    model.gym = Object.assign(r, { link: '/lodestar/palestra.html#e-' + e.id });
    model.swimNote = (model.swimNote || '').replace(GYM_NOTE, '').trim();
  }
  return model;
}
