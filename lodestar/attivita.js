// Lodestar — pagina Attività: commento generale + elenco degli ultimi allenamenti (con dettaglio dei lap).
const ACT_TYPE_LABELS = {
  running: 'Corsa', trail_running: 'Corsa', treadmill_running: 'Corsa (tapis roulant)',
  lap_swimming: 'Piscina', open_water_swimming: 'Nuoto', swimming: 'Nuoto',
  strength_training: 'Pesi', hiking: 'Escursionismo',
  road_biking: 'Ciclismo', cycling: 'Ciclismo', mountain_biking: 'MTB',
};
const SWIM_STYLE_LABELS = { freestyle: 'Crawl', backstroke: 'Dorso', breaststroke: 'Rana', butterfly: 'Farfalla', drill: 'Drill', mixed: 'Misto', im: 'Misti' };

function actTypeLabel(t) { return ACT_TYPE_LABELS[t] || t || '—'; }

function fmtDuration(min) {
  if (min == null) return '—';
  const totalSec = Math.round(min * 60);
  const h = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtDistance(type, km) {
  if (km == null) return '—';
  if (SWIM_TYPES.includes(type)) return Math.round(km * 1000).toLocaleString('it-IT') + ' m';
  return km.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
}

function renderActivityRow(a, i) {
  const hasLaps = a.laps && a.laps.length > 1;
  const rowId = `act-laps-${i}`;
  const clickAttr = hasLaps ? ` class="act-row-clickable" onclick="document.getElementById('${rowId}').classList.toggle('hidden')"` : '';
  const mainRow = `
    <tr${clickAttr}>
      <td>${actDateLabel(a.date)}</td>
      <td class="fase">${actTypeLabel(a.type)}${hasLaps ? ' 🔻' : ''}</td>
      <td>${fmtDistance(a.type, a.distance_km)}</td>
      <td>${fmtDuration(a.duration_min)}</td>
      <td>${a.avg_hr ?? '—'}/${a.max_hr ?? '—'}</td>
      <td>${a.calories != null ? Math.round(a.calories) : '—'}</td>
    </tr>`;
  if (!hasLaps) return mainRow;
  const lapRows = a.laps.map(l => `
    <tr>
      <td colspan="2" style="padding-left:24px;color:var(--muted)">Lap ${l.lap}${l.style ? ' · ' + (SWIM_STYLE_LABELS[l.style] || l.style) + (l.drill ? ' (tecnica)' : '') : ''}</td>
      <td>${l.distance_m != null ? Math.round(l.distance_m) + ' m' : '—'}</td>
      <td>${SWIM_TYPES.includes(a.type) ? fmtSwimPace100(l.avg_pace_min_per_km) : fmtPace(l.avg_pace_min_per_km)}</td>
      <td>${l.avg_hr ?? '—'}/${l.max_hr ?? '—'}</td>
      <td></td>
    </tr>`).join('');
  return mainRow + `
    <tr id="${rowId}" class="hidden"><td colspan="6" style="padding:0">
      <table class="act-table" style="margin:0"><tbody>${lapRows}</tbody></table>
    </td></tr>`;
}

// ── Commento generale: confronto ultimi 7 giorni / 7 precedenti, mix di intensità, passo, riposo, carico ──
function inWindow(a, from, to) { const d = daysSinceDate(a.date); return d >= from && d <= to; }
const kmOf = list => list.reduce((s, a) => s + (a.distance_km || 0), 0);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

function buildComments(acts, fitness) {
  const out = [];
  if (!acts.length) return ['Nessuna attività sincronizzata: appena Garmin ne registra qualcuna qui compare il commento.'];

  const last = acts[0];
  const since = daysSinceDate(last.date);
  const w1 = acts.filter(a => inWindow(a, 0, 6));
  const w0 = acts.filter(a => inWindow(a, 7, 13));
  const runs1 = w1.filter(a => RUN_TYPES.includes(a.type)), runs0 = w0.filter(a => RUN_TYPES.includes(a.type));
  const swim1 = w1.filter(a => SWIM_TYPES.includes(a.type)), swim0 = w0.filter(a => SWIM_TYPES.includes(a.type));
  const gym1 = w1.filter(a => a.type === GYM_TYPE), gym0 = w0.filter(a => a.type === GYM_TYPE);

  // Frequenza e riposo
  out.push(`<b>Frequenza</b> — ultimi 7 giorni: ${plural(w1.length, 'allenamento', 'allenamenti')} (${runs1.length} corsa, ${swim1.length} nuoto, ${gym1.length} pesi) contro ${w0.length} della settimana prima. ` +
    (since === 0 ? 'Ti sei allenato oggi.' : (since === 1 ? 'Ultimo allenamento ieri.' : `Ultimo allenamento ${fmtDays(since)} fa.`)));
  const activeDays = new Set(w1.map(a => a.date)).size;
  if (activeDays >= 6) out.push('<b>Riposo</b> — hai allenato 6-7 giorni su 7: inserisci almeno un giorno davvero libero.');
  else if (activeDays <= 2 && since >= 3) out.push('<b>Continuità</b> — settimana leggera e pausa in corso: riparti con una seduta facile, senza recuperare il tempo perso.');

  // Volumi
  const parts = [];
  if (runs1.length || runs0.length) parts.push(`corsa ${kmOf(runs1).toFixed(1).replace('.', ',')} km (prima ${kmOf(runs0).toFixed(1).replace('.', ',')})`);
  if (swim1.length || swim0.length) parts.push(`nuoto ${Math.round(kmOf(swim1) * 1000)} m (prima ${Math.round(kmOf(swim0) * 1000)})`);
  if (parts.length) {
    let verdict = '';
    const r1 = kmOf(runs1), r0 = kmOf(runs0);
    if (r0 > 0 && r1 > r0 * 1.3) verdict = ' Il volume di corsa è salito di oltre il 30%: occhio ad aumentare ancora.';
    else if (r0 > 0 && r1 < r0 * 0.6 && r1 > 0) verdict = ' Volume di corsa in calo: va bene se è scarico voluto.';
    out.push(`<b>Volumi</b> — ${parts.join(' · ')}.${verdict}`);
  }

  // Mix di intensità sulle corse delle ultime due settimane
  const runs14 = [...runs1, ...runs0];
  if (runs14.length >= 2) {
    const q = runs14.filter(a => QUALITY_TYPES.includes(classifyRun(a)));
    const names = { velocita: 'ripetute', soglia: 'soglia', fartlek: 'fartlek', progressivo: 'progressivo', vo2: 'ripetute lunghe' };
    const qTxt = q.length ? q.map(a => `${names[classifyRun(a)]} (${actDateLabel(a.date)})`).join(', ') : 'nessuna';
    const share = Math.round(q.length / runs14.length * 100);
    out.push(`<b>Intensità</b> — su ${runs14.length} corse in 14 giorni, di qualità: ${qTxt} (${share}%). ` +
      (share > 50 ? 'Troppa qualità: aggiungi corse facili in Z2.' : (share === 0 ? 'Tutto facile: nelle prossime uscite puoi inserire una seduta di qualità.' : 'Buon equilibrio facile/qualità.')));
  }

  // Passo medio sulle corse facili/lunghe: ultime 3 vs precedenti 3
  const steady = acts.filter(a => RUN_TYPES.includes(a.type) && a.distance_km >= 4 && ['facile', 'lungo'].includes(classifyRun(a)) && a.duration_min);
  if (steady.length >= 4) {
    const pace = a => a.duration_min / a.distance_km;
    const n = Math.min(3, Math.floor(steady.length / 2));
    const recent = median(steady.slice(0, n).map(pace)), before = median(steady.slice(n, n * 2).map(pace));
    const hr = list => median(list.filter(a => a.avg_hr).map(a => a.avg_hr));
    const hrR = hr(steady.slice(0, n)), hrB = hr(steady.slice(n, n * 2));
    const diff = Math.round((recent - before) * 60);
    let t = `ritmo delle corse facili ${fmtPace(recent)} (prima ${fmtPace(before)})`;
    if (hrR && hrB) t += `, FC media ${Math.round(hrR)} (prima ${Math.round(hrB)})`;
    let verdict = '';
    if (diff <= -5 && (!hrR || !hrB || hrR <= hrB + 2)) verdict = ' Vai più veloce a parità di sforzo: segno di miglioramento aerobico.';
    else if (diff >= 8 && hrR && hrB && hrR >= hrB) verdict = ' Più lento e con più battiti: possibile fatica accumulata.';
    out.push(`<b>Passo</b> — ${t}.${verdict}`);
  }

  // Nuoto: ritmo mediano sui lap
  const swimPace = list => median(list.map(a => swimLapStats(a)).filter(Boolean).map(s => s.median));
  const swimAll = acts.filter(a => SWIM_TYPES.includes(a.type));
  if (swimAll.length >= 4) {
    const n = Math.floor(swimAll.length / 2);
    const rec = swimPace(swimAll.slice(0, Math.min(3, n))), bef = swimPace(swimAll.slice(Math.min(3, n), Math.min(3, n) * 2));
    if (rec && bef) {
      const d = Math.round((rec - bef) * 6);
      out.push(`<b>Nuoto</b> — ritmo mediano sui lap ${fmtSwimPace100(rec)} (prima ${fmtSwimPace100(bef)}). ${d <= -1 ? 'Stai scendendo di passo.' : (d >= 2 ? 'Un po\' più lento: curare tecnica e recuperi.' : 'Ritmo stabile.')}`);
    }
  }

  // Forza
  if (!gym1.length && !gym0.length) out.push('<b>Forza</b> — nessuna seduta di pesi in due settimane: una sessione A o B aiuterebbe corsa e nuoto.');

  // Carico Garmin
  const tr = fitness && fitness.training_readiness;
  const cat = fitness && fitness.training_status_category;
  const bits = [];
  if (cat) bits.push(`stato di allenamento "${TRAINING_STATUS_LABELS_IT[cat] || cat}"`);
  if (tr && tr.acute_load != null) bits.push(`carico acuto ${tr.acute_load}`);
  if (tr && tr.acwr_feedback) bits.push({ GOOD: 'rapporto carico ottimale', MODERATE: 'carico moderato', HIGH: 'carico alto', POOR: 'carico eccessivo' }[tr.acwr_feedback] || null);
  if (bits.filter(Boolean).length) out.push(`<b>Carico (Garmin)</b> — ${bits.filter(Boolean).join(', ')}.`);
  return out;
}

async function init() {
  const [acts, fitness] = await Promise.all([
    fetchJSONSafe('/data/garmin-activities.json', []),
    fetchJSONSafe('/data/garmin-fitness.json', null),
  ]);
  const tbody = document.getElementById('act-table-body');
  tbody.innerHTML = acts.length ? acts.slice(0, 20).map(renderActivityRow).join('')
    : '<tr><td colspan="6" style="color:var(--muted);text-align:center">Nessuna attività sincronizzata ancora</td></tr>';
  let lines;
  try { lines = buildComments(acts, fitness); } catch (e) { console.warn(e); lines = ['Commento non disponibile.']; }
  document.getElementById('ld-comments').innerHTML = '<div class="ld-panel-body">' + lines.map(l => `<p class="ld-line">${l}</p>`).join('') + '</div>';
}
init();
