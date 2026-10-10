// Lodestar — menu laterale, service worker e voci comuni (riusa le classi di /style.css e di nav.js).
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/service-worker.js').catch(function () {});
    });
  }

  // Pagine non ancora migrate nella nuova app: per ora rimandano alla versione esistente.
  var LINKS = [
    { id: 'home', href: '/lodestar/', label: 'Home', dot: '#e8b64b' },
    { id: 'corsa', href: '/lodestar/corsa.html', label: 'Libreria corsa', dot: '#f55a5a' },
    { id: 'nuoto', href: '/lodestar/nuoto.html', label: 'Libreria nuoto', dot: '#7ab8f5' },
    { id: 'palestra', href: '/lodestar/palestra.html', label: 'Libreria palestra', dot: '#c85af5' },
    { id: 'nutrizione', href: '/lodestar/nutrizione.html', label: 'Libreria ricette 🥗', dot: '#f5965a' },
    { id: 'attivita', href: '/lodestar/attivita.html', label: 'Attività 📈', dot: '#2E6DA4' },
    { id: 'piano', href: '/lodestar/piano.html', label: 'Piano 🎯', dot: '#2E6DA4' },
  ];
  var TOOLS = [
    { href: '/pianoallenamento/peso.html', label: 'Peso ⚖️', dot: '#f5c85a' },
    { href: '/pianoallenamento/callback.html', label: 'Sonno 😴', dot: '#5af5c8' },
    { href: '/pianoallenamento/editor.html', label: 'Editor FIT', dot: '#f55ac8' },
  ];

  var active = document.body.getAttribute('data-page') || 'home';
  function link(l, isActive) {
    return '<a href="' + l.href + '"' + (isActive ? ' class="active"' : '') + '><span class="dot" style="background:' + l.dot + '"></span>' + l.label + '</a>';
  }

  document.body.insertAdjacentHTML('afterbegin',
    '<button class="nav-toggle" aria-label="Apri/chiudi menu" type="button"><span></span></button>' +
    '<nav><span class="nav-logo">✦ Lodestar</span>' +
    '<div class="nav-links">' + LINKS.map(function (l) { return link(l, l.id === active); }).join('') +
    '<div style="height:10px"></div>' + TOOLS.map(function (l) { return link(l, false); }).join('') + '</div></nav>' +
    '<div class="nav-backdrop"></div>');

  if (window.innerWidth >= 900) document.body.classList.add('nav-open');

  function setOpen(open) { document.body.classList.toggle('nav-open', open); }
  document.querySelector('.nav-toggle').addEventListener('click', function () { setOpen(!document.body.classList.contains('nav-open')); });
  document.querySelector('.nav-backdrop').addEventListener('click', function () { setOpen(false); });
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () { if (window.innerWidth < 900) setOpen(false); });
  });

  var nav = document.querySelector('nav');
  var pw = document.createElement('a');
  pw.href = '/auth/cambia-password.php';
  pw.className = 'nav-refresh-btn nav-logout';
  pw.textContent = '🔑 Cambia password';
  nav.appendChild(pw);
  var logout = document.createElement('a');
  logout.href = '/auth/logout.php';
  logout.className = 'nav-refresh-btn nav-logout';
  logout.textContent = '🚪 Esci';
  nav.appendChild(logout);

  var links = document.querySelector('.nav-links');
  fetch('/whoami.php', { cache: 'no-store', credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      if (data.user) logout.textContent = '🚪 Esci (' + data.user + ')';
      if (data.admin) links.insertAdjacentHTML('beforeend', link({ href: '/pianoallenamento/accessi.php', label: 'Accessi 🔐', dot: '#9aa5ad' }, false));
    })
    .catch(function () {});
})();
