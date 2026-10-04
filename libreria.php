<?php
// Libreria degli allenamenti: tutti la vedono; i coach inseriscono i programmi scritti in linguaggio naturale.
// Sta fuori da /auth/ cosi' passa dal gate: serve gia' una sessione valida.
require_once __DIR__ . '/auth/coach-lib.php';

$name = auth_current_user();
$isCoach = auth_is_coach($name);
header('Cache-Control: no-store');
$athlete = COACH_DEFAULT_ATHLETE;
?>
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Libreria allenamenti — Piano Allenamento</title>
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1c3f56">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<style>
textarea { width: 100%; box-sizing: border-box; min-height: 170px; padding: 12px; border: 1px solid var(--border); border-radius: var(--r); font: 14px/1.5 inherit; resize: vertical; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
.btn { padding: 10px 16px; border: 0; border-radius: var(--r); background: var(--accent); font-weight: 700; cursor: pointer; font-family: inherit; }
.btn.secondary { background: var(--s2); border: 1px solid var(--border); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
input[type=date] { padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--r); font: inherit; }
.card { background: var(--s1); border: 1px solid var(--border); border-radius: var(--r); padding: 16px 18px; margin: 14px 0; }
.msg-err { color: #c0392b; font-size: 13px; }
.msg-ok { color: #2e7d32; font-size: 13px; }
.muted { color: var(--muted); font-size: 12px; }
.status { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
</style>
</head>
<body>
<script>if (window.innerWidth >= 900) document.body.classList.add('nav-open');</script>
<button class="nav-toggle" aria-label="Apri/chiudi menu" type="button"><span></span></button>
<nav>
  <span class="nav-logo">⚡ Piano</span>
  <div class="nav-links">
    <a href="index.html"><span class="dot" style="background:#2E6DA4"></span>Programma</a>
    <a href="nuoto.html"><span class="dot" style="background:#7ab8f5"></span>Nuoto</a>
    <a href="palestra.html"><span class="dot" style="background:#c85af5"></span>Palestra</a>
    <a href="corsa.html"><span class="dot" style="background:#f55a5a"></span>Corsa</a>
    <a href="nutrizione.html"><span class="dot" style="background:#f5965a"></span>Nutrizione 🥗</a>
    <a href="peso.html"><span class="dot" style="background:#f5c85a"></span>Peso ⚖️</a>
    <a href="callback.html"><span class="dot" style="background:#5af5c8"></span>Sonno 😴</a>
    <a href="editor.html"><span class="dot" style="background:#f55ac8"></span>Editor FIT</a>
    <a href="libreria.php" class="active"><span class="dot" style="background:#5ac8f5"></span>Libreria 📚</a>
  </div>
</nav>
<div class="nav-backdrop"></div>

<main>
<div class="page-hero">
  <h1>Libreria allenamenti</h1>
  <p><?= $isCoach ? 'Scrivi l\'allenamento come lo diresti a voce: il sito lo scompone in blocchi, calcola il volume e lo inserisce nella libreria.' : 'Gli allenamenti disponibili, inseriti dai coach. Da qui puoi inviarli all\'orologio.' ?> Solo i coach possono inserire programmi.</p>
</div>

<?php if ($isCoach): ?>
<div class="card">
  <textarea id="text" placeholder="Esempio:&#10;200 sciolti&#10;8x50 (1 contando le bracciate, 1 nuotando senza pensare alla tecnica)&#10;2x100 pinne gambe (tavola davanti)&#10;4x200 aerobici (dispari senza nulla, pari con pull e palette)"></textarea>
  <div class="row">
    <button class="btn" id="parseBtn" type="button">Analizza</button>
    <span id="parseMsg" class="muted"></span>
  </div>
</div>

<div class="card" id="preview" style="display:none">
  <div id="previewBody"></div>
  <div class="row">
    <label class="muted">Assegna a <?= htmlspecialchars(ucfirst($athlete), ENT_QUOTES, 'UTF-8') ?> per il giorno (facoltativo) <input type="date" id="date"></label>
    <button class="btn" id="saveBtn" type="button">Inserisci in libreria</button>
  </div>
  <div class="muted">Controlla bene l'anteprima: se qualcosa non torna, correggi il testo e analizza di nuovo.</div>
</div>
<div id="saveMsg"></div>

<?php endif; ?>
<h2>Programmi in libreria</h2>
<div id="library" class="muted">Caricamento…</div>
</main>

<script src="nav.js"></script>
<script src="coach-render.js"></script>
<script>
(function () {
  var csrf = '';
  var parsed = null;
  var $ = function (id) { return document.getElementById(id); };

  function api(action, payload) { return CoachRender.api(csrf)(action, payload); }

  CoachRender.library($('library'), function (data) { csrf = data.csrf; });

  if ($('parseBtn')) $('parseBtn').addEventListener('click', function () {
    var text = $('text').value.trim();
    if (!text) { $('parseMsg').textContent = 'Scrivi prima l\'allenamento.'; return; }
    $('parseBtn').disabled = true;
    $('parseMsg').className = 'muted';
    $('parseMsg').textContent = 'Analisi in corso…';
    $('saveMsg').innerHTML = '';
    api('parse', { text: text }).then(function (data) {
      parsed = data.parsed;
      $('previewBody').innerHTML = CoachRender.html(parsed);
      $('preview').style.display = 'block';
      $('parseMsg').textContent = '';
    }).catch(function (e) {
      $('preview').style.display = 'none';
      parsed = null;
      $('parseMsg').className = 'msg-err';
      $('parseMsg').textContent = e.message;
    }).then(function () { $('parseBtn').disabled = false; });
  });

  if ($('saveBtn')) $('saveBtn').addEventListener('click', function () {
    if (!parsed) return;
    $('saveBtn').disabled = true;
    api('save', { text: $('text').value.trim(), parsed: parsed, date: $('date').value || null }).then(function () {
      $('saveMsg').innerHTML = '<p class="msg-ok">Programma inserito in libreria.</p>';
      $('preview').style.display = 'none';
      $('text').value = '';
      $('date').value = '';
      parsed = null;
      CoachRender.library($('library'), function (data) { csrf = data.csrf; });
    }).catch(function (e) {
      $('saveMsg').innerHTML = '<p class="msg-err">' + CoachRender.esc(e.message) + '</p>';
    }).then(function () { $('saveBtn').disabled = false; });
  });
})();
</script>
</body>
</html>
