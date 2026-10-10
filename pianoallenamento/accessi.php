<?php
// Accessi del sito classico "Piano allenamento" (solo admin): chi puo' entrare lo decide l'admin a mano, qui.
// Lodestar ha una pagina a parte (/lodestar/utenti.php) con registrazione autonoma e inviti. Il registro degli accessi e' condiviso.
require_once __DIR__ . '/../auth/lib.php';
require_once __DIR__ . '/../auth/udata-lib.php';

$name = auth_current_user();
if (!auth_is_admin($name)) {
    http_response_code(403);
    auth_page('Accesso negato', '<p>Questa pagina è riservata agli amministratori.</p><p><a href="/pianoallenamento/">Torna al sito</a></p>');
    exit;
}

$created = null;
$notice = '';
$formError = '';

function active_admins(): array {
    return array_keys(array_filter(auth_all_users(), function ($u) { return !empty($u['admin']) && empty($u['disabled']); }));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $action = (string)($_POST['action'] ?? 'create');

    if ($action === 'create') {
        // Nuovo utente del sito classico: password temporanea da comunicare a mano; non ha accesso a Lodestar.
        $newName = strtolower(trim((string)($_POST['new_user'] ?? '')));
        if (!auth_valid_username($newName)) {
            $formError = 'Nome non valido: un indirizzo email oppure da 2 a 32 caratteri tra lettere minuscole, numeri, punto, trattino e underscore.';
        } elseif (auth_get_user($newName)) {
            $formError = 'Esiste già un utente con questo nome: abilitalo dalla tabella qui sotto.';
        } else {
            $temp = auth_create_user($newName, false, ['pianoallenamento' => true]);
            if ($temp !== null && !empty($_POST['as_coach'])) {
                auth_update_users(function ($users) use ($newName) { $users[$newName]['coach'] = true; return $users; });
                auth_log('coach_granted', $newName, 'alla creazione, da ' . $name);
            }
            if ($temp === null) {
                $formError = 'Impossibile creare l\'utente, riprova.';
            } else {
                auth_log('user_created', $newName, 'creato da ' . $name . ' per il sito classico');
                $created = ['user' => $newName, 'pw' => $temp, 'label' => 'Utente creato.'];
            }
        }
    } else {
        $target = strtolower(trim((string)($_POST['user'] ?? '')));
        $tu = auth_get_user($target);
        $self = $target === $name;
        $soleAdmin = !empty($tu['admin']) && empty($tu['disabled']) && active_admins() === [$target];

        if (!$tu) {
            $formError = 'Utente non trovato.';
        } elseif ($action === 'classic_on' || $action === 'classic_off') {
            if ($self && $action === 'classic_off') {
                $formError = 'Non puoi togliere a te stesso l\'accesso al sito classico.';
            } else {
                auth_update_users(function ($users) use ($target, $action) {
                    $u = $users[$target];
                    $apps = array_key_exists('apps', $u) ? $u['apps'] : ['lodestar' => true, 'pianoallenamento' => true];   // utenti storici: si rende esplicito
                    $apps['pianoallenamento'] = $action === 'classic_on';
                    $users[$target]['apps'] = $apps;
                    return $users;
                });
                auth_log($action === 'classic_on' ? 'classic_enabled' : 'classic_disabled', $target, 'da ' . $name);
                $notice = $action === 'classic_on' ? "$target ora può usare il sito classico." : "Tolto a $target l'accesso al sito classico.";
            }
        } elseif ($action === 'reset') {
            $temp = auth_create_user($target, true);
            auth_log('user_reset', $target, 'password azzerata da ' . $name);
            $created = ['user' => $target, 'pw' => $temp, 'label' => 'Password azzerata.'];
        } elseif ($action === 'unlock') {
            auth_update_users(function ($users) use ($target) { $users[$target]['fails'] = 0; $users[$target]['locked_until'] = 0; return $users; });
            auth_log('user_unlocked', $target, 'sbloccato da ' . $name);
            $notice = "Utente $target sbloccato.";
        } elseif ($action === 'disable' || $action === 'revoke_admin') {
            if ($action === 'disable' && $self) {
                $formError = 'Non puoi disattivare il tuo stesso account.';
            } elseif ($soleAdmin) {
                $formError = 'Questo è l\'unico amministratore attivo: promuovi prima un altro amministratore.';
            } else {
                auth_update_users(function ($users) use ($target, $action) {
                    if ($action === 'disable') $users[$target]['disabled'] = true; else $users[$target]['admin'] = false;
                    return $users;
                });
                auth_log($action === 'disable' ? 'user_disabled' : 'admin_revoked', $target, 'da ' . $name);
                $notice = $action === 'disable' ? "Account $target disattivato (non entra né qui né in Lodestar): le sue sessioni non valgono più." : "Tolto il ruolo di amministratore a $target.";
            }
        } elseif ($action === 'enable' || $action === 'make_admin') {
            auth_update_users(function ($users) use ($target, $action) {
                if ($action === 'enable') unset($users[$target]['disabled']); else $users[$target]['admin'] = true;
                return $users;
            });
            auth_log($action === 'enable' ? 'user_enabled' : 'admin_granted', $target, 'da ' . $name);
            $notice = $action === 'enable' ? "Account $target riattivato." : "$target ora è amministratore.";
        } elseif ($action === 'delete') {
            if ($self) $formError = 'Non puoi eliminare il tuo account.';
            elseif ($soleAdmin) $formError = 'È l\'unico amministratore attivo.';
            elseif (auth_has_app($target, 'lodestar')) $formError = 'Questo utente usa anche Lodestar: gli account di Lodestar si eliminano da /lodestar/utenti.php. Qui puoi toglierli l\'accesso al sito classico.';
            else {
                auth_update_users(function ($users) use ($target) { unset($users[$target]); return $users; });
                auth_log('user_deleted', $target, 'da ' . $name);
                $notice = "Utente $target eliminato.";
            }
        } else {
            $formError = 'Azione non riconosciuta.';
        }
    }
}

$labels = [
    'login_ok' => 'Accesso', 'login_fail' => 'Tentativo fallito', 'lockout' => 'Account bloccato',
    'login_locked' => 'Tentativo durante il blocco', 'password_changed' => 'Password cambiata', 'logout' => 'Uscita',
    'user_created' => 'Utente creato', 'user_reset' => 'Password azzerata', 'user_disabled' => 'Utente disattivato',
    'user_enabled' => 'Utente riattivato', 'user_deleted' => 'Utente eliminato', 'user_unlocked' => 'Utente sbloccato',
    'classic_enabled' => 'Sito classico abilitato', 'classic_disabled' => 'Sito classico tolto',
    'coach_granted' => 'Coach assegnato', 'coach_revoked' => 'Coach revocato', 'coach_assigned' => 'Allenamento assegnato',
    'coach_library_add' => 'Programma inserito in libreria', 'plan_sent' => 'Consiglio inviato a Garmin',
    'coach_parse' => 'Testo analizzato (coach)', 'coach_deleted' => 'Allenamento eliminato', 'coach_sent' => 'Allenamento inviato a Garmin',
    'admin_granted' => 'Admin assegnato', 'admin_revoked' => 'Admin revocato', 'login_disabled' => 'Accesso con account disattivato',
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
function user_btn(string $action, string $user, string $label, string $confirm = '', bool $danger = false): string {
    return '<form method="post" action="/pianoallenamento/accessi.php" style="display:inline"' . ($confirm ? ' onsubmit="return confirm(' . e(json_encode($confirm, JSON_UNESCAPED_UNICODE)) . ')"' : '') . '>'
        . '<input type="hidden" name="csrf" value="' . e(auth_csrf_token()) . '"><input type="hidden" name="action" value="' . e($action) . '">'
        . '<input type="hidden" name="user" value="' . e($user) . '">'
        . '<button type="submit" class="ubtn' . ($danger ? ' danger' : '') . '">' . e($label) . '</button></form> ';
}
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
.ubtn{margin:2px 0;padding:4px 9px;border:1px solid var(--border);border-radius:var(--r);background:var(--s2);font-size:12px;cursor:pointer;font-family:inherit}
.ubtn:hover{border-color:var(--accent)}.ubtn.danger{color:#c0392b}
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
  <h1>Accessi al sito classico</h1>
  <p>Chi può usare "Piano allenamento" lo decidi tu, a mano. Gli utenti di Lodestar hanno una gestione separata: <a href="/lodestar/utenti.php" style="color:#fff;text-decoration:underline">/lodestar/utenti.php</a></p>
</div>

<h2>Utenti</h2>
<?php if ($created): ?>
<div style="border:2px solid var(--accent);border-radius:var(--r);padding:14px 16px;margin:8px 0 16px">
  <b><?= e($created['label']) ?></b> Comunica queste credenziali in modo riservato: la password temporanea <b>non verrà più mostrata</b>
  e al primo accesso l'utente dovrà sceglierne una nuova.
  <div style="font-size:16px;margin-top:10px">Utente: <b><?= e($created['user']) ?></b><br>Password temporanea: <b style="font-family:monospace;user-select:all"><?= e($created['pw']) ?></b></div>
</div>
<?php endif; ?>
<?php if ($notice): ?><p style="border:1px solid var(--border);background:var(--s2);border-radius:var(--r);padding:10px 14px"><?= e($notice) ?></p><?php endif; ?>
<?php if ($formError): ?><p class="bad"><?= e($formError) ?></p><?php endif; ?>
<table>
<tr><th>Utente</th><th>Ruolo</th><th>Sito classico</th><th>Lodestar</th><th>Stato</th><th>Azioni</th></tr>
<?php foreach (auth_all_users() as $un => $uu):
    if (!empty($uu['pending'])) continue;      // inviti di Lodestar non ancora completati: non riguardano il sito classico
    $isSelf = $un === $name; $isAdm = !empty($uu['admin']); $isOff = !empty($uu['disabled']); $isLocked = ($uu['locked_until'] ?? 0) > time();
    $hasClassic = auth_has_app($un, 'pianoallenamento'); $hasLodestar = auth_has_app($un, 'lodestar'); ?>
<tr><td><?= e($un) ?><?= $isSelf ? ' <span class="muted">(tu)</span>' : '' ?></td>
<td><?= $isAdm ? 'Amministratore' : 'Utente' ?><?= !empty($uu['coach']) ? ' · Coach' : '' ?></td>
<td><?= $hasClassic ? '<b>✅ abilitato</b>' : '<span class="muted">—</span>' ?></td>
<td class="muted"><?= $hasLodestar ? '✅' : '—' ?></td>
<td><?php
    if ($isOff) echo '<span class="bad">Disattivato</span>';
    elseif ($isLocked) echo '<span class="bad">Bloccato (troppi tentativi)</span>';
    elseif (!empty($uu['must_change'])) {
        echo 'Deve ancora scegliere la password';
        echo !empty($uu['temp_pw'])
            ? '<div class="muted">Password temporanea: <b style="font-family:monospace;user-select:all">' . e($uu['temp_pw']) . '</b></div>'
            : '<div class="muted">Password temporanea non disponibile: usa "Azzera password"</div>';
    }
    else echo 'Attivo';
?></td>
<td><?php
    echo $hasClassic ? (!$isSelf ? user_btn('classic_off', $un, 'Togli sito classico', "Togliere a $un l'accesso al sito classico?") : '')
                     : user_btn('classic_on', $un, 'Abilita sito classico', "Abilitare $un al sito classico \"Piano allenamento\"?");
    if ($hasClassic) echo user_btn('reset', $un, 'Azzera password', "Azzerare la password di $un? Le sue sessioni verranno chiuse e avrà una nuova password temporanea.");
    if ($isLocked && !$isOff) echo user_btn('unlock', $un, 'Sblocca');
    if (!$isSelf) echo $isOff ? user_btn('enable', $un, 'Riattiva') : user_btn('disable', $un, 'Disattiva account', "Disattivare $un? Non potrà più entrare (né qui né in Lodestar) e le sue sessioni si chiudono subito.");
    echo $isAdm ? user_btn('revoke_admin', $un, 'Togli admin', "Togliere il ruolo di amministratore a $un?") : user_btn('make_admin', $un, 'Rendi admin', "Rendere $un amministratore? Potrà gestire gli accessi del sito classico e gli utenti di Lodestar.");
    if (!$isSelf && !$hasLodestar) echo user_btn('delete', $un, 'Elimina', "Eliminare definitivamente $un? L'operazione non si può annullare.", true);
?></td></tr>
<?php endforeach; ?>
</table>
<form method="post" action="/pianoallenamento/accessi.php" style="margin:0 0 28px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
  <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>">
  <div><div class="muted" style="margin-bottom:4px">Nuovo utente del sito classico</div>
  <input name="new_user" required minlength="2" maxlength="64" placeholder="nome o email" autocomplete="off"
         style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:14px"></div>
  <label class="muted" style="display:flex;gap:6px;align-items:center;padding-bottom:10px"><input type="checkbox" name="as_coach" value="1"> Coach</label>
  <button type="submit" style="padding:10px 16px;border:0;border-radius:var(--r);background:var(--accent);font-weight:700;cursor:pointer">Crea utente</button>
</form>

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
<a href="/pianoallenamento/accessi.php" class="<?= $filter === '' ? 'on' : '' ?>">Tutti</a>
<?php foreach ($labels as $k => $l): ?><a href="/pianoallenamento/accessi.php?e=<?= e($k) ?>" class="<?= $filter === $k ? 'on' : '' ?>"><?= e($l) ?></a><?php endforeach; ?>
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
