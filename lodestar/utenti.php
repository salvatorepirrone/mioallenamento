<?php
// Utenti di Lodestar (solo admin): registrazione, inviti, richieste, ruoli e stato degli account che usano Lodestar.
// Il sito classico (/pianoallenamento) ha una sua pagina Accessi, con abilitazioni separate decise a mano.
require_once __DIR__ . '/../auth/invite-lib.php';

function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

$name = auth_current_user();
if (!auth_is_admin($name)) {
    http_response_code(403);
    auth_page('Accesso negato', '<p>Questa pagina è riservata agli amministratori di Lodestar.</p><p><a href="/lodestar/">Torna a Lodestar</a></p>');
    exit;
}

$invited = null;
$notice = '';
$formError = '';

function ld_admins(): array {
    return array_keys(array_filter(auth_all_users(), function ($u) { return !empty($u['admin']) && empty($u['disabled']); }));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $action = (string)($_POST['action'] ?? '');
    $target = strtolower(trim((string)($_POST['user'] ?? '')));
    $tu = $target !== '' ? auth_get_user($target) : null;

    if ($action === 'create') {
        $r = invite_user((string)($_POST['new_email'] ?? ''), ['coach' => !empty($_POST['as_coach']), 'nutrizionista' => !empty($_POST['as_nutri'])], $name);
        if (!$r['ok']) $formError = $r['error'];
        else {
            $em = strtolower(trim((string)$_POST['new_email']));
            auth_log('user_invited', $em, 'invito da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
            $invited = ['email' => $em] + $r;
        }
    } elseif ($action === 'set_registration') {
        settings_set(['open_registration' => ($_POST['mode'] ?? 'open') === 'open', 'max_users' => (int)($_POST['max_users'] ?? 50)]);
        auth_log('registration_mode', '', ($_POST['mode'] ?? '') . ' (max ' . (int)($_POST['max_users'] ?? 0) . ') da ' . $name);
        $notice = 'Impostazioni di registrazione salvate.';
    } elseif ($action === 'approve_request' || $action === 'reject_request') {
        $rid = (string)($_POST['rid'] ?? '');
        $req = null;
        foreach (req_all() as $r) if ($r['id'] === $rid && $r['status'] === 'pending') $req = $r;
        if (!$req) $formError = 'Richiesta non trovata (forse già gestita).';
        elseif ($action === 'approve_request') {
            $r = invite_user($req['email'], [], $name);
            if (!$r['ok']) $formError = $r['error'];
            else {
                req_update(function ($all) use ($rid, $name) { foreach ($all as &$x) if ($x['id'] === $rid) { $x['status'] = 'approved'; $x['by'] = $name; } return $all; });
                auth_log('access_approved', $req['email'], 'da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
                $invited = ['email' => $req['email']] + $r;
            }
        } else {
            req_update(function ($all) use ($rid, $name) { foreach ($all as &$x) if ($x['id'] === $rid) { $x['status'] = 'rejected'; $x['by'] = $name; } return $all; });
            auth_log('access_rejected', $req['email'], 'da ' . $name);
            $notice = 'Richiesta di ' . $req['email'] . ' rifiutata.';
        }
    } elseif (!$tu) {
        $formError = 'Utente non trovato.';
    } elseif ($action === 'resend_invite') {
        if (empty($tu['pending'])) $formError = 'Questo utente ha già completato la registrazione.';
        else {
            $r = invite_send($target);
            auth_log('user_invited', $target, 'invito reinviato da ' . $name . ($r['mailed'] ? ' (email inviata)' : ' (email non inviata)'));
            $invited = ['email' => $target] + $r;
        }
    } elseif ($action === 'lodestar_off' || $action === 'lodestar_on') {
        if ($target === $name && $action === 'lodestar_off') $formError = 'Non puoi togliere a te stesso l\'accesso a Lodestar.';
        else {
            auth_update_users(function ($users) use ($target, $action) {
                $u = $users[$target];
                $apps = array_key_exists('apps', $u) ? $u['apps'] : ['lodestar' => true, 'pianoallenamento' => true];   // utenti storici: si rende esplicito
                $apps['lodestar'] = $action === 'lodestar_on';
                $users[$target]['apps'] = $apps;
                return $users;
            });
            auth_log($action === 'lodestar_on' ? 'lodestar_enabled' : 'lodestar_disabled', $target, 'da ' . $name);
            $notice = $action === 'lodestar_on' ? "Accesso a Lodestar riabilitato per $target." : "Accesso a Lodestar tolto a $target (resta un eventuale accesso al sito classico).";
        }
    } elseif ($action === 'delete_account') {
        $classic = auth_has_app($target, 'pianoallenamento');
        if ($target === $name || $target === UDATA_DEFAULT_ATHLETE) $formError = 'Questo account non si può eliminare da qui.';
        elseif ($classic && empty($tu['pending'])) $formError = 'Questo utente ha anche accesso al sito classico: toglilo da lì, oppure usa "Togli Lodestar".';
        elseif (!empty($tu['admin']) && ld_admins() === [$target]) $formError = 'È l\'unico amministratore.';
        else {
            auth_update_users(function ($users) use ($target) { unset($users[$target]); return $users; });
            udata_delete_all($target);
            auth_log('user_deleted', $target, 'account e dati eliminati da ' . $name);
            $notice = "Account $target eliminato insieme ai suoi dati.";
        }
    } elseif ($action === 'make_coach' || $action === 'revoke_coach') {
        auth_update_users(function ($users) use ($target, $action) { if ($action === 'make_coach') $users[$target]['coach'] = true; else unset($users[$target]['coach']); return $users; });
        auth_log($action === 'make_coach' ? 'coach_granted' : 'coach_revoked', $target, 'da ' . $name);
        $notice = $action === 'make_coach' ? "$target ora è coach." : "Tolto il ruolo di coach a $target.";
    } elseif ($action === 'make_nutri' || $action === 'revoke_nutri') {
        auth_update_users(function ($users) use ($target, $action) { if ($action === 'make_nutri') $users[$target]['nutrizionista'] = true; else unset($users[$target]['nutrizionista']); return $users; });
        auth_log($action === 'make_nutri' ? 'nutri_granted' : 'nutri_revoked', $target, 'da ' . $name);
        $notice = $action === 'make_nutri' ? "$target ora è nutrizionista." : "Tolto il ruolo di nutrizionista a $target.";
    } elseif ($action === 'set_email') {
        $em = strtolower(trim((string)($_POST['email'] ?? '')));
        if (!auth_valid_email($em)) $formError = 'Indirizzo email non valido.';
        else {
            auth_update_users(function ($users) use ($target, $em) { $users[$target]['email'] = $em; return $users; });
            auth_log('email_set', $target, 'da ' . $name);
            $notice = "Email di $target impostata: ora può accedere e recuperare la password con $em.";
        }
    } elseif ($action === 'send_reset') {
        reset_request($target);
        $notice = "Se $target ha un'email associata, gli abbiamo inviato il link per reimpostare la password.";
    } else {
        $formError = 'Azione non riconosciuta.';
    }
}

function btn(string $action, string $user, string $label, string $confirm = '', bool $danger = false): string {
    return '<form method="post" action="/lodestar/utenti.php" style="display:inline"' . ($confirm ? ' onsubmit="return confirm(' . e(json_encode($confirm, JSON_UNESCAPED_UNICODE)) . ')"' : '') . '>'
        . '<input type="hidden" name="csrf" value="' . e(auth_csrf_token()) . '"><input type="hidden" name="action" value="' . e($action) . '"><input type="hidden" name="user" value="' . e($user) . '">'
        . '<button type="submit" class="ld-btn ghost ld-sm' . ($danger ? ' danger' : '') . '">' . e($label) . '</button></form> ';
}

$labels = [
    'signup' => 'Iscrizione libera', 'signup_existing' => 'Iscrizione di email già registrata', 'user_invited' => 'Invito inviato', 'invite_page' => 'Pagina di registrazione aperta',
    'registered' => 'Registrazione completata', 'access_requested' => 'Richiesta di accesso', 'access_approved' => 'Richiesta approvata', 'access_rejected' => 'Richiesta rifiutata',
    'reset_requested' => 'Recupero password richiesto', 'password_reset' => 'Password reimpostata via email', 'registration_mode' => 'Modalità di registrazione cambiata',
    'lodestar_enabled' => 'Accesso a Lodestar abilitato', 'lodestar_disabled' => 'Accesso a Lodestar tolto', 'user_deleted' => 'Account eliminato',
    'coach_granted' => 'Coach assegnato', 'coach_revoked' => 'Coach revocato', 'nutri_granted' => 'Nutrizionista assegnato', 'nutri_revoked' => 'Nutrizionista revocato',
    'garmin_connected' => 'Garmin collegato', 'garmin_disconnected' => 'Garmin scollegato', 'withings_connected' => 'Withings collegato', 'withings_disconnected' => 'Withings scollegato',
    'profile_saved' => 'Profilo salvato', 'plan_saved' => 'Piano salvato', 'plan_deleted' => 'Piano eliminato',
];
$events = [];
$logFile = auth_log_file();
if (is_file($logFile)) {
    foreach (array_reverse(array_slice(file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -1500)) as $line) {
        $r = json_decode($line, true);
        if (is_array($r) && isset($labels[$r['e'] ?? ''])) $events[] = $r;
        if (count($events) >= 40) break;
    }
}

$reg = settings_get();
$pendingReqs = req_pending();
$users = array_filter(auth_all_users(), function ($u, $k) { return auth_has_app($k, 'lodestar') || !empty($u['pending']); }, ARRAY_FILTER_USE_BOTH);
?>
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Utenti · Lodestar</title>
<meta name="theme-color" content="#12263f">
<link rel="manifest" href="/lodestar/manifest.json">
<link rel="icon" href="/lodestar/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/lodestar/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/lodestar/lodestar.css">
<style>
.ld-sm{padding:5px 10px;font-size:12px;margin:2px 0}.ld-btn.danger{color:var(--ld-low)}
.ld-users{width:100%;border-collapse:collapse;font-size:13px}.ld-users th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--s2);padding:7px 8px}
.ld-users td{padding:8px;border-bottom:1px solid var(--border);vertical-align:top}.ld-wrap{overflow:auto}.bad{color:var(--ld-low);font-weight:600}
.ld-form{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.ld-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
.ld-form input,.ld-form select{padding:8px 10px;border:1px solid var(--border);border-radius:10px;font:inherit;color:var(--text);background:var(--bg)}
</style>
</head>
<body data-page="utenti">
<main>

<div class="hero">
  <h1>👥 Utenti</h1>
  <p>Registrazione, inviti, ruoli e stato degli account di Lodestar</p>
</div>

<?php if ($notice): ?><div class="ld-card"><?= e($notice) ?></div><?php endif; ?>
<?php if ($formError): ?><div class="ld-card bad"><?= e($formError) ?></div><?php endif; ?>
<?php if ($invited): ?>
<div class="ld-card" style="border:2px solid var(--ld-gold)">
  <?php if ($invited['mailed']): ?>
    <b>✅ Invito inviato a <?= e($invited['email']) ?></b>
    <div class="ld-muted" style="margin-top:6px">L'email contiene il link per scegliere la password e completare la registrazione (vale 7 giorni).</div>
  <?php else: ?>
    <b>⚠ Invito creato per <?= e($invited['email']) ?>, ma l'email non è partita</b>
    <div class="ld-muted" style="margin-top:6px"><?= e($invited['mail_error'] ?: 'Errore sconosciuto') ?>. Copia il link e invialo tu alla persona (vale 7 giorni).</div>
  <?php endif; ?>
  <textarea id="invite-link" readonly rows="2" style="width:100%;margin-top:8px;padding:9px;border:1px solid var(--border);border-radius:10px;font:inherit;font-size:12px"><?= e($invited['link']) ?></textarea>
  <button type="button" class="ld-btn ghost ld-sm" onclick="var t=document.getElementById('invite-link');t.select();document.execCommand('copy');this.textContent='Copiato ✓'">Copia link</button>
</div>
<?php endif; ?>

<div class="sec">Registrazione</div>
<div class="ld-card">
  <form method="post" action="/lodestar/utenti.php" class="ld-form">
    <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>"><input type="hidden" name="action" value="set_registration">
    <label>Come ci si registra
      <select name="mode">
        <option value="open"<?= $reg['open_registration'] ? ' selected' : '' ?>>Libera: chiunque con la propria email</option>
        <option value="approval"<?= $reg['open_registration'] ? '' : ' selected' ?>>Con approvazione di un admin</option>
      </select></label>
    <label>Numero massimo di utenti
      <input name="max_users" type="number" min="1" max="500" value="<?= (int)$reg['max_users'] ?>" style="width:110px"></label>
    <button type="submit" class="ld-btn">Salva</button>
  </form>
  <div class="ld-muted" style="margin-top:8px">Utenti attivi: <b><?= users_active_count() ?></b> su <?= (int)$reg['max_users'] ?> · registrazione <?= $reg['open_registration'] ? '<b>libera</b>' : '<b>con approvazione</b>' ?> · pagina pubblica: <a class="reco-link" href="/auth/richiedi-accesso.php">/auth/richiedi-accesso.php</a></div>
</div>

<?php if ($pendingReqs): ?>
<div class="sec">Richieste in attesa (<?= count($pendingReqs) ?>)</div>
<div class="ld-card ld-wrap">
<table class="ld-users"><tr><th>Email</th><th>Nome</th><th>Nota</th><th>Quando</th><th>Azioni</th></tr>
<?php foreach ($pendingReqs as $rq): ?>
<tr><td><?= e($rq['email']) ?></td><td><?= e($rq['nome'] ?: '—') ?></td><td><?= e($rq['nota'] ?: '—') ?></td><td><?= e(date('d/m/Y H:i', (int)$rq['created'])) ?></td>
<td><?php foreach (['approve_request' => 'Approva e invita', 'reject_request' => 'Rifiuta'] as $act => $label): ?>
<form method="post" action="/lodestar/utenti.php" style="display:inline"<?= $act === 'reject_request' ? ' onsubmit="return confirm(\'Rifiutare la richiesta?\')"' : '' ?>>
  <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>"><input type="hidden" name="action" value="<?= $act ?>"><input type="hidden" name="rid" value="<?= e($rq['id']) ?>">
  <button type="submit" class="ld-btn ghost ld-sm<?= $act === 'reject_request' ? ' danger' : '' ?>"><?= $label ?></button></form>
<?php endforeach; ?></td></tr>
<?php endforeach; ?>
</table></div>
<?php endif; ?>

<div class="sec">Invita una persona</div>
<div class="ld-card">
  <form method="post" action="/lodestar/utenti.php" class="ld-form">
    <input type="hidden" name="csrf" value="<?= e(auth_csrf_token()) ?>"><input type="hidden" name="action" value="create">
    <label>Email<input name="new_email" type="email" required maxlength="64" placeholder="nome@esempio.it" autocomplete="off" style="min-width:240px"></label>
    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="as_coach" value="1"> Coach</label>
    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="as_nutri" value="1"> Nutrizionista</label>
    <button type="submit" class="ld-btn gold">Invia invito</button>
  </form>
</div>

<div class="sec">Utenti di Lodestar (<?= count($users) ?>)</div>
<div class="ld-card ld-wrap">
<table class="ld-users">
<tr><th>Utente</th><th>Ruoli</th><th>Stato</th><th>Configurazione</th><th>Azioni</th></tr>
<?php foreach ($users as $un => $uu):
    $isSelf = $un === $name; $isAdm = !empty($uu['admin']); $isOff = !empty($uu['disabled']); $isPending = !empty($uu['pending']); ?>
<tr><td><?= e($un) ?><?= $isSelf ? ' <span class="ld-muted">(tu)</span>' : '' ?><?= !empty($uu['email']) && $uu['email'] !== $un ? '<div class="ld-muted">' . e($uu['email']) . '</div>' : '' ?></td>
<td><?= $isAdm ? 'Admin' : 'Utente' ?><?= !empty($uu['coach']) ? ' · Coach' : '' ?><?= !empty($uu['nutrizionista']) ? ' · Nutrizionista' : '' ?></td>
<td><?php
    if ($isOff) echo '<span class="bad">Account disattivato</span>';
    elseif ($isPending) echo 'Invito in attesa<div class="ld-muted">dal ' . e(date('d/m/Y', (int)($uu['invited_at'] ?? time()))) . '</div>';
    else echo 'Attivo' . (!empty($uu['must_change']) ? '<div class="ld-muted">deve scegliere la password</div>' : '');
?></td>
<td class="ld-muted"><?php
    if ($isPending) echo '—';
    else { $cn = udata_connected($un); echo 'Garmin ' . ($cn['garmin'] ? '✅' : '—') . ' · Withings ' . ($cn['withings'] ? '✅' : '—') . '<br>Profilo ' . (udata_has_profile($un) ? '✅' : '—') . ' · Guida ' . (udata_onboarded($un) ? '✅' : '—'); }
?></td>
<td><?php
    if ($isPending) {
        echo btn('resend_invite', $un, 'Reinvia invito');
        echo btn('delete_account', $un, 'Elimina invito', "Eliminare l'invito a $un?", true);
        echo '</td></tr>';
        continue;
    }
    if (strpos($un, '@') === false) {
        echo '<form method="post" action="/lodestar/utenti.php" style="display:inline"><input type="hidden" name="csrf" value="' . e(auth_csrf_token()) . '"><input type="hidden" name="action" value="set_email"><input type="hidden" name="user" value="' . e($un) . '">'
           . '<input name="email" type="email" required placeholder="email" value="' . e($uu['email'] ?? '') . '" style="padding:5px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;width:150px"> <button type="submit" class="ld-btn ghost ld-sm">Imposta email</button></form> ';
    }
    if (!empty($uu['email']) || strpos($un, '@') !== false) echo btn('send_reset', $un, 'Invia link password', "Inviare a $un il link per reimpostare la password?");
    echo !empty($uu['coach']) ? btn('revoke_coach', $un, 'Togli coach') : btn('make_coach', $un, 'Rendi coach', "Rendere $un coach? Potrà inserire e assegnare allenamenti.");
    echo !empty($uu['nutrizionista']) ? btn('revoke_nutri', $un, 'Togli nutrizionista') : btn('make_nutri', $un, 'Rendi nutrizionista', "Rendere $un nutrizionista? Potrà eliminare qualsiasi ricetta.");
    if (!$isSelf) {
        echo btn('lodestar_off', $un, 'Togli Lodestar', "Togliere a $un l'accesso a Lodestar?");
        echo btn('delete_account', $un, 'Elimina account', "Eliminare definitivamente $un e tutti i suoi dati (profilo, diario, piano, collegamenti)? L'operazione non si può annullare.", true);
    }
?></td></tr>
<?php endforeach; ?>
</table></div>

<?php
$off = array_filter(auth_all_users(), function ($u, $k) { return empty($u['pending']) && !auth_has_app($k, 'lodestar'); }, ARRAY_FILTER_USE_BOTH);
if ($off): ?>
<div class="sec">Senza accesso a Lodestar (<?= count($off) ?>)</div>
<div class="ld-card ld-wrap">
<table class="ld-users"><tr><th>Utente</th><th>Azioni</th></tr>
<?php foreach ($off as $un => $uu): ?><tr><td><?= e($un) ?><div class="ld-muted">usa solo il sito classico</div></td><td><?= btn('lodestar_on', $un, 'Abilita Lodestar') ?></td></tr><?php endforeach; ?>
</table></div>
<?php endif; ?>

<div class="sec">Ultimi eventi</div>
<div class="ld-card ld-wrap">
<table class="ld-users"><tr><th>Quando</th><th>Evento</th><th>Utente</th><th>Dettaglio</th></tr>
<?php foreach ($events as $r): ?>
<tr><td><?= e($r['t']) ?></td><td><?= e($labels[$r['e']]) ?></td><td><?= e($r['u'] ?: '—') ?></td><td><?= e($r['d'] ?? '') ?></td></tr>
<?php endforeach; ?>
<?php if (!$events): ?><tr><td colspan="4" class="ld-muted">Nessun evento.</td></tr><?php endif; ?>
</table>
<div class="ld-muted" style="margin-top:6px">Il registro completo degli accessi (login e tentativi falliti) sta nella pagina Accessi del sito classico.</div></div>

</main>
<script src="/lodestar/app.js"></script>
</body>
</html>
