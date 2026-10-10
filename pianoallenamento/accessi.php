<?php
// Registro degli accessi, riservato agli amministratori (vedi auth/make-admin.php).
// Sta fuori da /auth/ cosi' passa dal gate: serve gia' una sessione valida.
require_once __DIR__ . '/../auth/lib.php';
require_once __DIR__ . '/../auth/udata-lib.php';
require_once __DIR__ . '/../auth/invite-lib.php';

$name = auth_current_user();
if (!auth_is_admin($name)) {
    http_response_code(403);
    auth_page('Accesso negato', '<p>Questa pagina è riservata agli amministratori.</p><p><a href="/pianoallenamento/">Torna al sito</a></p>');
    exit;
}

// Azioni sugli utenti (solo admin, con CSRF). Le password temporanee si vedono una volta sola.
$created = null;
$invited = null;
$notice = '';
$formError = '';

function active_admins(): array {
    return array_keys(array_filter(auth_all_users(), function ($u) { return !empty($u['admin']) && empty($u['disabled']); }));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $action = (string)($_POST['action'] ?? 'create');

    if ($action === 'create') {
        $r = invite_user((string)($_POST['new_email'] ?? ''), ['coach' => !empty($_POST['as_coach']), 'nutrizionista' => !empty($_POST['as_nutri'])], $name);
        if (!$r['ok']) {
            $formError = $r['error'];
        } else {
            $em = strtolower(trim((string)$_POST['new_email']));
            auth_log('user_invited', $em, 'invito da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
            $invited = ['email' => $em] + $r;
        }
    } elseif ($action === 'approve_request' || $action === 'reject_request') {
        $rid = (string)($_POST['rid'] ?? '');
        $req = null;
        foreach (req_all() as $r) if ($r['id'] === $rid && $r['status'] === 'pending') $req = $r;
        if (!$req) {
            $formError = 'Richiesta non trovata (forse già gestita).';
        } elseif ($action === 'approve_request') {
            $r = invite_user($req['email'], [], $name);
            if (!$r['ok']) {
                $formError = $r['error'];
            } else {
                req_update(function ($all) use ($rid, $name) { foreach ($all as &$x) if ($x['id'] === $rid) { $x['status'] = 'approved'; $x['by'] = $name; } return $all; });
                auth_log('access_approved', $req['email'], 'da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
                $invited = ['email' => $req['email']] + $r;
            }
        } else {
            req_update(function ($all) use ($rid, $name) { foreach ($all as &$x) if ($x['id'] === $rid) { $x['status'] = 'rejected'; $x['by'] = $name; } return $all; });
            auth_log('access_rejected', $req['email'], 'da ' . $name);
            $notice = 'Richiesta di ' . $req['email'] . ' rifiutata.';
        }
    } else {
        $target = strtolower(trim((string)($_POST['user'] ?? '')));
        $tu = auth_get_user($target);
        $soleAdmin = !empty($tu['admin']) && empty($tu['disabled']) && active_admins() === [$target];
        $self = $target === $name;

        if (!$tu) {
            $formError = 'Utente non trovato.';
        } elseif ($action === 'set_email') {
            $em = strtolower(trim((string)($_POST['email'] ?? '')));
            if (!auth_valid_email($em)) $formError = 'Indirizzo email non valido.';
            else {
                auth_update_users(function ($users) use ($target, $em) { $users[$target]['email'] = $em; return $users; });
                auth_log('email_set', $target, 'da ' . $name);
                $notice = "Email di $target impostata: ora può accedere e recuperare la password con $em.";
            }
        } elseif ($action === 'resend_invite') {
            if (empty($tu['pending'])) { $formError = 'Questo utente ha già completato la registrazione.'; }
            else {
                $r = invite_send($target);
                auth_log('user_invited', $target, 'invito reinviato da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
                $invited = ['email' => $target] + $r;
            }
        } elseif ($action === 'reset') {
            $temp = auth_create_user($target, true);
            auth_log('user_reset', $target, 'password azzerata da ' . $name);
            $created = ['user' => $target, 'pw' => $temp, 'label' => 'Password azzerata.'];
        } elseif ($action === 'unlock') {
            auth_update_users(function ($users) use ($target) { $users[$target]['fails'] = 0; $users[$target]['locked_until'] = 0; return $users; });
            auth_log('user_unlocked', $target, 'sbloccato da ' . $name);
            $notice = "Utente $target sbloccato.";
        } elseif ($action === 'disable' || $action === 'delete' || $action === 'revoke_admin') {
            if ($action !== 'revoke_admin' && $self) {
                $formError = 'Non puoi disattivare o eliminare il tuo stesso account.';
            } elseif ($soleAdmin) {
                $formError = 'Questo è l\'unico amministratore attivo: crea o promuovi prima un altro amministratore.';
            } else {
                auth_update_users(function ($users) use ($target, $action) {
                    if ($action === 'disable') $users[$target]['disabled'] = true;
                    elseif ($action === 'delete') unset($users[$target]);
                    else $users[$target]['admin'] = false;
                    return $users;
                });
                $evt = ['disable' => 'user_disabled', 'delete' => 'user_deleted', 'revoke_admin' => 'admin_revoked'][$action];
                auth_log($evt, $target, 'da ' . $name);
                $notice = ['disable' => "Utente $target disattivato: le sue sessioni non valgono più.",
                           'delete' => "Utente $target eliminato.", 'revoke_admin' => "Tolto il ruolo di amministratore a $target."][$action];
            }
        } elseif ($action === 'make_coach' || $action === 'revoke_coach') {
            auth_update_users(function ($users) use ($target, $action) {
                if ($action === 'make_coach') $users[$target]['coach'] = true; else unset($users[$target]['coach']);
                return $users;
            });
            auth_log($action === 'make_coach' ? 'coach_granted' : 'coach_revoked', $target, 'da ' . $name);
            $notice = $action === 'make_coach' ? "$target ora è coach." : "Tolto il ruolo di coach a $target.";
        } elseif ($action === 'make_nutri' || $action === 'revoke_nutri') {
            auth_update_users(function ($users) use ($target, $action) {
                if ($action === 'make_nutri') $users[$target]['nutrizionista'] = true; else unset($users[$target]['nutrizionista']);
                return $users;
            });
            auth_log($action === 'make_nutri' ? 'nutri_granted' : 'nutri_revoked', $target, 'da ' . $name);
            $notice = $action === 'make_nutri' ? "$target ora è nutrizionista." : "Tolto il ruolo di nutrizionista a $target.";
        } elseif ($action === 'enable' || $action === 'make_admin') {
            auth_update_users(function ($users) use ($target, $action) {
                if ($action === 'enable') unset($users[$target]['disabled']);
                else $users[$target]['admin'] = true;
                return $users;
            });
            auth_log($action === 'enable' ? 'user_enabled' : 'admin_granted', $target, 'da ' . $name);
            $notice = $action === 'enable' ? "Utente $target riattivato." : "$target ora è amministratore.";
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
    'coach_granted' => 'Coach assegnato', 'coach_revoked' => 'Coach revocato', 'coach_assigned' => 'Allenamento assegnato',
    'coach_library_add' => 'Programma inserito in libreria',
    'invite_page' => 'Pagina di registrazione aperta', 'access_requested' => 'Richiesta di accesso', 'access_approved' => 'Richiesta approvata', 'access_rejected' => 'Richiesta rifiutata',
    'user_invited' => 'Invito inviato', 'registered' => 'Registrazione completata', 'reset_requested' => 'Recupero password richiesto', 'password_reset' => 'Password reimpostata via email',
    'nutri_granted' => 'Nutrizionista assegnato', 'nutri_revoked' => 'Nutrizionista revocato',
    'nutri_recipe_add' => 'Ricetta inserita', 'nutri_recipe_delete' => 'Ricetta eliminata', 'nutri_meal_add' => 'Pasto registrato',
    'nutri_parse_recipe' => 'Ricetta analizzata', 'plan_saved' => 'Piano salvato', 'plan_deleted' => 'Piano eliminato',
    'plan_sent' => 'Consiglio inviato a Garmin',
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
  <h1>Registro accessi</h1>
  <p>Chi è entrato nel sito, tentativi falliti e cambi password · orari di Roma</p>
</div>

<?php $pendingReqs = req_pending(); ?>
<h2>Richieste di accesso<?= $pendingReqs ? ' (' . count($pendingReqs) . ')' : '' ?></h2>
<?php if (!$pendingReqs): ?>
<p class="muted">Nessuna richiesta in attesa. Chi vuole entrare può farne una da <a href="/auth/richiedi-accesso.php">/auth/richiedi-accesso.php</a>.</p>
<?php else: ?>
<table>
<tr><th>Email</th><th>Nome</th><th>Nota</th><th>Quando</th><th>Azioni</th></tr>
<?php foreach ($pendingReqs as $rq): ?>
<tr><td><?= e($rq['email']) ?></td><td><?= e($rq['nome'] ?: '—') ?></td><td><?= e($rq['nota'] ?: '—') ?></td><td><?= e(date('d/m/Y H:i', (int)$rq['created'])) ?></td>
<td><?php foreach (['approve_request' => 'Approva e invita', 'reject_request' => 'Rifiuta'] as $act => $label): ?>
<form method="post" action="/pianoallenamento/accessi.php" style="display:inline"<?= $act === 'reject_request' ? ' onsubmit="return confirm(\'Rifiutare la richiesta?\')"' : '' ?>>
  <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>"><input type="hidden" name="action" value="<?= $act ?>"><input type="hidden" name="rid" value="<?= e($rq['id']) ?>">
  <button type="submit" class="ubtn<?= $act === 'reject_request' ? ' danger' : '' ?>"><?= $label ?></button></form>
<?php endforeach; ?></td></tr>
<?php endforeach; ?>
</table>
<?php endif; ?>

<h2>Utenti</h2>
<?php if ($invited): ?>
<div style="border:2px solid var(--accent);border-radius:var(--r);padding:14px 16px;margin:8px 0 16px">
  <?php if ($invited['mailed']): ?>
    <b>✅ Invito inviato a <?= e($invited['email']) ?></b>
    <div class="muted" style="margin-top:6px">L'email contiene il link per scegliere la password e completare la registrazione (vale 7 giorni). Se non arriva, controlla lo spam o inoltra tu il link qui sotto.</div>
  <?php else: ?>
    <b>⚠ Invito creato per <?= e($invited['email']) ?>, ma l'email non è partita</b>
    <div class="muted" style="margin-top:6px"><?= e($invited['mail_error'] ?: 'Errore sconosciuto') ?>. Copia il link e invialo tu alla persona (vale 7 giorni).</div>
  <?php endif; ?>
  <textarea id="invite-link" readonly rows="2" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid var(--border);border-radius:var(--r);font:inherit;font-size:12px"><?= e($invited['link']) ?></textarea>
  <button type="button" class="ubtn" onclick="var t=document.getElementById('invite-link');t.select();document.execCommand('copy');this.textContent='Copiato ✓'">Copia link</button>
</div>
<?php endif; ?>
<?php if ($created): ?>
<div style="border:2px solid var(--accent);border-radius:var(--r);padding:14px 16px;margin:8px 0 16px">
  <b><?= e($created['label']) ?></b> Comunica queste credenziali in modo riservato: la password temporanea <b>non verrà più mostrata</b>
  e al primo accesso l'utente dovrà sceglierne una nuova.
  <div style="font-size:16px;margin-top:10px">Utente: <b><?= e($created['user']) ?></b><br>Password temporanea: <b style="font-family:monospace;user-select:all"><?= e($created['pw']) ?></b></div>
  <?php $invite = "Ciao! Ti ho creato l'accesso a Lodestar, il coach AI per allenamento e nutrizione.\n\nIndirizzo: " . UDATA_SITE_URL . "/\nUtente: " . $created['user'] . "\nPassword temporanea: " . $created['pw']
      . "\n\nAl primo accesso ti chiede di scegliere una nuova password; poi una breve guida ti aiuta a compilare il profilo e a collegare Garmin e/o Withings."; ?>
  <div style="margin-top:12px"><div class="muted" style="margin-bottom:4px">Messaggio di invito pronto da inviare:</div>
    <textarea id="invite" readonly rows="7" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--border);border-radius:var(--r);font:inherit;font-size:13px"><?= e($invite) ?></textarea>
    <button type="button" class="ubtn" onclick="var t=document.getElementById('invite');t.select();document.execCommand('copy');this.textContent='Copiato ✓'">Copia messaggio</button></div>
</div>
<?php endif; ?>
<?php if ($notice): ?><p style="border:1px solid var(--border);background:var(--s2);border-radius:var(--r);padding:10px 14px"><?= e($notice) ?></p><?php endif; ?>
<?php if ($formError): ?><p class="bad"><?= e($formError) ?></p><?php endif; ?>
<?php
function user_btn(string $action, string $user, string $label, string $confirm = '', bool $danger = false): string {
    return '<form method="post" action="/pianoallenamento/accessi.php" style="display:inline"' . ($confirm ? ' onsubmit="return confirm(' . e(json_encode($confirm, JSON_UNESCAPED_UNICODE)) . ')"' : '') . '>'
        . '<input type="hidden" name="csrf" value="' . e(auth_csrf_token()) . '"><input type="hidden" name="action" value="' . e($action) . '">'
        . '<input type="hidden" name="user" value="' . e($user) . '">'
        . '<button type="submit" class="ubtn' . ($danger ? ' danger' : '') . '">' . e($label) . '</button></form> ';
}
?>
<table>
<tr><th>Utente</th><th>Ruolo</th><th>Stato</th><th>Configurazione</th><th>Azioni</th></tr>
<?php foreach (auth_all_users() as $un => $uu):
    $isSelf = $un === $name; $isAdm = !empty($uu['admin']); $isOff = !empty($uu['disabled']); $isLocked = ($uu['locked_until'] ?? 0) > time(); ?>
<tr><td><?= e($un) ?><?= $isSelf ? ' <span class="muted">(tu)</span>' : '' ?></td><td><?= $isAdm ? 'Amministratore' : 'Utente' ?><?= !empty($uu['coach']) ? ' · Coach' : '' ?><?= !empty($uu['nutrizionista']) ? ' · Nutrizionista' : '' ?></td>
<td><?php
    if ($isOff) echo '<span class="bad">Disattivato</span>';
    elseif ($isLocked) echo '<span class="bad">Bloccato (troppi tentativi)</span>';
    elseif (!empty($uu['pending'])) {
        echo 'Invito in attesa';
        echo '<div class="muted">Invitato il ' . e(date('d/m/Y', (int)($uu['invited_at'] ?? time()))) . ' · non ha ancora scelto la password</div>';
    }
    elseif (!empty($uu['must_change'])) {
        echo 'Deve ancora scegliere la password';
        echo !empty($uu['temp_pw'])
            ? '<div class="muted">Password temporanea: <b style="font-family:monospace;user-select:all">' . e($uu['temp_pw']) . '</b></div>'
            : '<div class="muted">Password temporanea non disponibile: usa "Azzera password"</div>';
    }
    else echo 'Attivo';
?></td>
<td class="muted"><?php
    $cn = udata_connected($un);
    echo 'Garmin ' . ($cn['garmin'] ? '✅' : '—') . ' · Withings ' . ($cn['withings'] ? '✅' : '—') . '<br>Profilo ' . (udata_has_profile($un) ? '✅' : '—') . ' · Guida ' . (udata_onboarded($un) ? '✅' : '—');
?></td>
<td><?php
    if (!empty($uu['pending'])) {
        echo user_btn('resend_invite', $un, 'Reinvia invito');
        if (!$isSelf) echo user_btn('delete', $un, 'Elimina', "Eliminare l'invito a $un?", true);
        echo '</td></tr>';
        continue;
    }
    if (strpos($un, '@') === false) {      // utente storico senza email: si associa per permettere accesso e recupero password
        echo '<form method="post" action="/pianoallenamento/accessi.php" style="display:inline"><input type="hidden" name="csrf" value="' . e(auth_csrf_token()) . '"><input type="hidden" name="action" value="set_email"><input type="hidden" name="user" value="' . e($un) . '">'
           . '<input name="email" type="email" required placeholder="email" value="' . e($uu['email'] ?? '') . '" style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:150px"> <button type="submit" class="ubtn">Imposta email</button></form> ';
    }
    echo user_btn('reset', $un, 'Azzera password', "Azzerare la password di $un? Le sue sessioni verranno chiuse e avrà una nuova password temporanea.");
    if ($isLocked && !$isOff) echo user_btn('unlock', $un, 'Sblocca');
    if (!$isSelf) {
        echo $isOff ? user_btn('enable', $un, 'Riattiva') : user_btn('disable', $un, 'Disattiva', "Disattivare $un? Non potrà più entrare e le sue sessioni si chiudono subito.");
    }
    echo $isAdm ? user_btn('revoke_admin', $un, 'Togli admin', "Togliere il ruolo di amministratore a $un?") : user_btn('make_admin', $un, 'Rendi admin', "Rendere $un amministratore? Potrà creare ed eliminare utenti e vedere il registro accessi.");
    echo !empty($uu['coach']) ? user_btn('revoke_coach', $un, 'Togli coach', "Togliere il ruolo di coach a $un?") : user_btn('make_coach', $un, 'Rendi coach', "Rendere $un coach? Potrà scrivere e assegnare allenamenti.");
    echo !empty($uu['nutrizionista']) ? user_btn('revoke_nutri', $un, 'Togli nutrizionista', "Togliere il ruolo di nutrizionista a $un?") : user_btn('make_nutri', $un, 'Rendi nutrizionista', "Rendere $un nutrizionista? Potrà eliminare qualsiasi ricetta della libreria.");
    if (!$isSelf) echo user_btn('delete', $un, 'Elimina', "Eliminare definitivamente $un? L'operazione non si può annullare.", true);
?></td></tr>
<?php endforeach; ?>
</table>
<form method="post" action="/pianoallenamento/accessi.php" style="margin:0 0 28px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
  <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>">
  <div><div class="muted" style="margin-bottom:4px">Invita un nuovo utente (email)</div>
  <input name="new_email" type="email" required maxlength="64" placeholder="nome@esempio.it" autocomplete="off"
         style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:14px;min-width:240px"></div>
  <label class="muted" style="display:flex;gap:6px;align-items:center;padding-bottom:10px"><input type="checkbox" name="as_coach" value="1"> Coach</label>
  <label class="muted" style="display:flex;gap:6px;align-items:center;padding-bottom:10px"><input type="checkbox" name="as_nutri" value="1"> Nutrizionista</label>
  <button type="submit" style="padding:10px 16px;border:0;border-radius:var(--r);background:var(--accent);font-weight:700;cursor:pointer">Invia invito</button>
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
