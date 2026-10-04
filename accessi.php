<?php
// Registro degli accessi, riservato agli amministratori (vedi auth/make-admin.php).
// Sta fuori da /auth/ cosi' passa dal gate: serve gia' una sessione valida.
require_once __DIR__ . '/auth/lib.php';

$name = auth_current_user();
if (!auth_is_admin($name)) {
    http_response_code(403);
    auth_page('Accesso negato', '<p>Questa pagina è riservata agli amministratori.</p><p><a href="/">Torna al sito</a></p>');
    exit;
}

// Creazione di un nuovo utente (solo admin, con CSRF): la password temporanea si vede una volta sola.
$created = null;
$formError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $newName = strtolower(trim((string)($_POST['new_user'] ?? '')));
    if (!auth_valid_username($newName)) {
        $formError = 'Nome non valido: da 2 a 32 caratteri tra lettere minuscole, numeri, punto, trattino e underscore.';
    } elseif (auth_get_user($newName)) {
        $formError = 'Esiste già un utente con questo nome.';
    } else {
        $temp = auth_create_user($newName);
        if ($temp === null) {
            $formError = 'Impossibile creare l\'utente, riprova.';
        } else {
            auth_log('user_created', $newName, 'creato da ' . $name);
            $created = ['user' => $newName, 'pw' => $temp];
        }
    }
}

$labels = [
    'login_ok' => 'Accesso', 'login_fail' => 'Tentativo fallito', 'lockout' => 'Account bloccato',
    'login_locked' => 'Tentativo durante il blocco', 'password_changed' => 'Password cambiata', 'logout' => 'Uscita',
    'user_created' => 'Utente creato',
];
$filter = $_GET['e'] ?? '';
if (!isset($labels[$filter])) $filter = '';

$rows = [];
$file = auth_log_file();
if (is_file($file)) {
    foreach (array_slice(file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -2000) as $line) {
        $r = json_decode($line, true);
        if (is_array($r)) $rows[] = $r;
    }
}
$rows = array_reverse($rows);

$weekAgo = date('Y-m-d H:i:s', time() - 7 * 86400);
$summary = [];
foreach ($rows as $r) {
    $u = $r['u'] ?? '';
    if ($u === '') continue;
    $s = &$summary[$u];
    if (!isset($s)) $s = ['last' => null, 'ok7' => 0, 'fail7' => 0];
    if ($r['e'] === 'login_ok') {
        if ($s['last'] === null) $s['last'] = $r['t'];
        if ($r['t'] >= $weekAgo) $s['ok7']++;
    }
    if (in_array($r['e'], ['login_fail', 'lockout'], true) && $r['t'] >= $weekAgo) $s['fail7']++;
    unset($s);
}
ksort($summary);

$unknownFails7 = 0;
foreach ($rows as $r) {
    if ($r['e'] === 'login_fail' && ($r['u'] ?? '') === '' && $r['t'] >= $weekAgo) $unknownFails7++;
}

$shown = array_filter($rows, function ($r) use ($filter) { return $filter === '' || $r['e'] === $filter; });
$shown = array_slice($shown, 0, 300);

function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accessi — Piano Allenamento</title>
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1c3f56">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<style>
table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 24px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{background:var(--s2);color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.bad{color:#c0392b;font-weight:600}.muted{color:var(--muted);font-size:12px}
.filters a{display:inline-block;margin:0 8px 8px 0;padding:4px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;text-decoration:none;color:inherit}
.filters a.on{background:var(--accent);font-weight:700}
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
    <a href="accessi.php" class="active"><span class="dot" style="background:#9aa5ad"></span>Accessi 🔐</a>
  </div>
</nav>
<div class="nav-backdrop"></div>

<main>
<div class="page-hero">
  <h1>Registro accessi</h1>
  <p>Chi è entrato nel sito, tentativi falliti e cambi password · orari di Roma</p>
</div>

<h2>Utenti</h2>
<?php if ($created): ?>
<div style="border:2px solid var(--accent);border-radius:var(--r);padding:14px 16px;margin:8px 0 16px">
  <b>Utente creato.</b> Comunica queste credenziali in modo riservato: la password temporanea <b>non verrà più mostrata</b>
  e al primo accesso l'utente dovrà sceglierne una nuova.
  <div style="font-size:16px;margin-top:10px">Utente: <b><?= e($created['user']) ?></b><br>Password temporanea: <b style="font-family:monospace;user-select:all"><?= e($created['pw']) ?></b></div>
</div>
<?php endif; ?>
<table>
<tr><th>Utente</th><th>Ruolo</th><th>Stato</th></tr>
<?php foreach (auth_all_users() as $un => $uu): ?>
<tr><td><?= e($un) ?></td><td><?= !empty($uu['admin']) ? 'Amministratore' : 'Utente' ?></td>
<td><?php
    if (($uu['locked_until'] ?? 0) > time()) echo '<span class="bad">Bloccato</span>';
    elseif (!empty($uu['must_change'])) echo 'Deve ancora scegliere la password';
    else echo 'Attivo';
?></td></tr>
<?php endforeach; ?>
</table>
<form method="post" action="/accessi.php" style="margin:0 0 28px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
  <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>">
  <div><div class="muted" style="margin-bottom:4px">Nuovo utente</div>
  <input name="new_user" required minlength="2" maxlength="32" pattern="[a-z0-9._\-]{2,32}" placeholder="nome (es. luca)" autocomplete="off"
         style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:14px"></div>
  <button type="submit" style="padding:10px 16px;border:0;border-radius:var(--r);background:var(--accent);font-weight:700;cursor:pointer">Crea utente</button>
</form>
<?php if ($formError): ?><p class="bad" style="margin-top:-16px"><?= e($formError) ?></p><?php endif; ?>

<h2>Riepilogo per utente</h2>
<table>
<tr><th>Utente</th><th>Ultimo accesso</th><th>Accessi (7 gg)</th><th>Tentativi falliti (7 gg)</th></tr>
<?php foreach ($summary as $u => $s): ?>
<tr><td><?= e($u) ?></td><td><?= e($s['last'] ?? 'mai') ?></td><td><?= (int)$s['ok7'] ?></td>
<td class="<?= $s['fail7'] ? 'bad' : '' ?>"><?= (int)$s['fail7'] ?></td></tr>
<?php endforeach; ?>
<?php if (!$summary): ?><tr><td colspan="4" class="muted">Nessun accesso registrato ancora.</td></tr><?php endif; ?>
</table>
<?php if ($unknownFails7): ?><p class="bad">Tentativi con utente sconosciuto negli ultimi 7 giorni: <?= (int)$unknownFails7 ?></p><?php endif; ?>

<h2>Eventi</h2>
<div class="filters">
<a href="/accessi.php" class="<?= $filter === '' ? 'on' : '' ?>">Tutti</a>
<?php foreach ($labels as $k => $l): ?><a href="/accessi.php?e=<?= e($k) ?>" class="<?= $filter === $k ? 'on' : '' ?>"><?= e($l) ?></a><?php endforeach; ?>
</div>
<table>
<tr><th>Quando</th><th>Evento</th><th>Utente</th><th>IP</th><th>Dettaglio</th></tr>
<?php foreach ($shown as $r): $bad = in_array($r['e'], ['login_fail', 'lockout', 'login_locked'], true); ?>
<tr><td><?= e($r['t']) ?></td><td class="<?= $bad ? 'bad' : '' ?>"><?= e($labels[$r['e']] ?? $r['e']) ?></td>
<td><?= e($r['u'] ?: '—') ?></td><td><?= e($r['ip'] ?? '') ?></td>
<td><?= e($r['d'] ?? '') ?><div class="muted"><?= e($r['ua'] ?? '') ?></div></td></tr>
<?php endforeach; ?>
<?php if (!$shown): ?><tr><td colspan="5" class="muted">Nessun evento.</td></tr><?php endif; ?>
</table>
</main>
<script src="nav.js"></script>
</body>
</html>
