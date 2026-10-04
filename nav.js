if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js').catch(function (err) {
      console.warn('Service worker non registrato:', err);
    });
  });
}

(function () {
  function setOpen(open) {
    document.body.classList.toggle('nav-open', open);
  }

  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('nav-open'));
    });
  }

  var backdrop = document.querySelector('.nav-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function () { setOpen(false); });
  }

  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (window.innerWidth < 900) setOpen(false);
    });
  });

  // ── Voce "Accessi": solo per gli amministratori (il server decide, non il browser) ──
  var links = document.querySelector('.nav-links');
  if (links && !links.querySelector('a[href="accessi.php"]')) {
    fetch('/whoami.php', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.admin) return;
        var a = document.createElement('a');
        a.href = 'accessi.php';
        a.innerHTML = '<span class="dot" style="background:#9aa5ad"></span>Accessi 🔐';
        links.appendChild(a);
      })
      .catch(function () {});
  }

  // ── Tasto "Aggiorna dati" (forza subito il sync Garmin/Withings) ──
  var nav = document.querySelector('nav');
  if (nav) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-refresh-btn';
    btn.textContent = '🔄 Aggiorna dati';
    nav.appendChild(btn);

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = '⏳ Aggiornamento...';
      fetch('/refresh-sync.php', { method: 'POST' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            btn.textContent = '✅ Aggiornato!';
            setTimeout(function () { location.reload(); }, 1200);
          } else {
            throw new Error(data.error || 'Errore sconosciuto');
          }
        })
        .catch(function (err) {
          console.error('Refresh fallito:', err);
          btn.textContent = '❌ Errore, riprova';
          btn.disabled = false;
        });
    });
  }
})();
