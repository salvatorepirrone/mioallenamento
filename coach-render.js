// Mostra un allenamento di nuoto strutturato (pagina del coach e riquadro nella home).
var CoachRender = (function () {
  var EQ = { fins: 'pinne', kickboard: 'tavola', paddles: 'palette', pull_buoy: 'pull', snorkel: 'snorkel' };
  var STROKE = { any: '', free: 'stile libero', back: 'dorso', breast: 'rana', fly: 'farfalla', im: 'misti', mixed: 'misto', drill: 'drill' };
  var INTENSITY = { easy: 'facile', aerobic: 'aerobico', threshold: 'soglia', fast: 'veloce', sprint: 'sprint' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function equipmentText(list) {
    return (list || []).map(function (e) { return EQ[e] || e; }).join(' + ');
  }

  function blockHtml(b) {
    var head = (b.reps > 1 ? b.reps + '×' : '') + b.distance_m + ' m';
    var meta = [];
    if (b.label) meta.push(esc(b.label));
    if (STROKE[b.stroke]) meta.push(esc(STROKE[b.stroke]));
    if (b.equipment && b.equipment.length) meta.push('<span class="cw-eq">' + esc(equipmentText(b.equipment)) + '</span>');
    if (b.intensity) meta.push(esc(INTENSITY[b.intensity] || b.intensity));
    if (b.rest_s) meta.push('rec. ' + b.rest_s + '″');
    var html = '<li><b>' + head + '</b> ' + meta.join(' · ');
    if (b.note) html += '<div class="cw-note">' + esc(b.note) + '</div>';
    if (b.alternate) {
      ['odd', 'even'].forEach(function (k) {
        var v = b.alternate[k] || {};
        var txt = [];
        if (v.equipment && v.equipment.length) txt.push('<span class="cw-eq">' + esc(equipmentText(v.equipment)) + '</span>');
        else txt.push('senza attrezzi');
        if (v.note) txt.push(esc(v.note));
        html += '<div class="cw-note">' + (k === 'odd' ? 'dispari' : 'pari') + ': ' + txt.join(' — ') + '</div>';
      });
    }
    return html + '</li>';
  }

  function total(p) {
    return p.total_m != null ? p.total_m : (p.blocks || []).reduce(function (s, b) { return s + b.reps * b.distance_m; }, 0);
  }

  function html(p) {
    return '<div class="cw-title">' + esc(p.title || 'Nuoto') + '</div>' +
      '<ul class="cw-list">' + (p.blocks || []).map(blockHtml).join('') + '</ul>' +
      '<div class="cw-total">Totale: ' + total(p).toLocaleString('it-IT') + ' m' + (p.pool_length_m ? ' · vasca da ' + p.pool_length_m + ' m' : '') + '</div>';
  }

  function apiFactory(csrf) {
    return function (action, payload) {
      var opts = payload === undefined ? { cache: 'no-store', credentials: 'same-origin' } : {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(payload),
      };
      return fetch('/coach-api.php?action=' + action, opts).then(function (res) {
        return res.json().then(function (d) {
          if (!res.ok) throw new Error(d.error || ('Errore ' + res.status));
          return d;
        });
      });
    };
  }

  function fmtDate(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function actionBtn(label, secondary, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cw-btn' + (secondary ? ' secondary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // Scheda di un programma in libreria. ctx: {csrf, canSend, isCoach, me, reload}
  function libraryCard(p, ctx) {
    var api = apiFactory(ctx.csrf);
    var div = document.createElement('div');
    div.className = 'cw-card';
    var sends = (p.sends || []).map(function (s) {
      return 'inviato' + (s.date ? ' (calendario ' + fmtDate(s.date) + ')' : ' (libreria Garmin)');
    });
    div.innerHTML =
      '<div class="cw-meta">inserito da ' + esc(p.created_by) + (p.date ? ' · assegnato al ' + esc(fmtDate(p.date)) : '') + '</div>' +
      html(p.parsed) +
      (sends.length ? '<div class="cw-meta">✅ ' + esc(sends.join(' · ')) + '</div>' : '') +
      '<div class="cw-actions"></div><div class="cw-msg"></div>';
    var actions = div.querySelector('.cw-actions');
    var msg = div.querySelector('.cw-msg');
    function run(btn, promise, okText) {
      btn.disabled = true;
      msg.textContent = 'Un momento…';
      promise.then(function () { msg.textContent = okText || ''; ctx.reload(); })
        .catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
    }
    function dateInput(title, value) {
      var i = document.createElement('input');
      i.type = 'date'; i.title = title; i.value = value || '';
      return i;
    }

    if (ctx.canSend) {
      var sendDate = dateInput('Giorno in calendario (facoltativo: senza data va solo nella libreria Garmin)', p.date);
      var sendBtn = actionBtn("Invia all'orologio", false, function () {
        run(sendBtn, api('send', { id: p.id, date: sendDate.value || null }),
          'Inviato a Garmin' + (sendDate.value ? ' e messo in calendario.' : ' (nella tua libreria allenamenti).'));
      });
      actions.appendChild(sendDate);
      actions.appendChild(sendBtn);
    }
    if (ctx.isCoach) {
      var assignDate = dateInput('Giorno da assegnare all\'atleta', p.date);
      var assignBtn = actionBtn('Assegna', true, function () {
        run(assignBtn, api('assign', { id: p.id, date: assignDate.value || null }));
      });
      actions.appendChild(assignDate);
      actions.appendChild(assignBtn);
      if (p.created_by === ctx.me) {
        var delBtn = actionBtn('Elimina', true, function () {
          if (confirm('Eliminare questo programma dalla libreria?')) run(delBtn, api('delete', { id: p.id }));
        });
        actions.appendChild(delBtn);
      }
    }
    return div;
  }

  // Disegna la libreria in un contenitore; carica i dati e si ridisegna dopo ogni azione.
  function library(container, onData) {
    function load() {
      apiFactory('')('library').then(function (data) {
        if (onData) onData(data);
        container.innerHTML = '';
        if (!data.programs.length) { container.textContent = 'La libreria è ancora vuota.'; return; }
        data.programs.forEach(function (p) {
          container.appendChild(libraryCard(p, { csrf: data.csrf, canSend: data.can_send, isCoach: data.is_coach, me: data.me, reload: load }));
        });
      }).catch(function (e) { container.textContent = e.message; });
    }
    load();
  }

  return { html: html, esc: esc, api: apiFactory, library: library, fmtDate: fmtDate };
})();
