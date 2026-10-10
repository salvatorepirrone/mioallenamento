<?php
// Completamento della registrazione dal link ricevuto per email: scelta della password e consenso. Pagina pubblica (vedi gate.php).
require_once __DIR__ . '/invite-lib.php';
auth_start();

$token = (string)($_GET['token'] ?? $_POST['token'] ?? '');
$t = tok_find($token, 'invite');
$user = $t ? auth_get_user($t['user']) : null;
if (!$t || !$user || empty($user['pending'])) {
    auth_page('Link non valido', '<p>Questo link non è valido o è scaduto.</p><p>Chiedi a chi ti ha invitato di inviartene uno nuovo.</p><p><a href="/auth/login.php">Vai all\'accesso</a></p>');
    exit;
}
$email = $t['user'];
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $pw = (string)($_POST['password'] ?? '');
    $again = (string)($_POST['again'] ?? '');
    $local = explode('@', $email)[0];
    $problems = auth_password_problems($pw, strlen($local) >= 3 ? $local : '');
    if ($pw !== $again) $errors[] = 'Le due password non coincidono.';
    if ($problems) $errors[] = 'La password deve avere: ' . implode('; ', $problems) . '.';
    if (empty($_POST['consent'])) $errors[] = 'Per continuare serve il consenso al trattamento dei dati.';
    if (!$errors) {
        $hash = password_hash($pw, PASSWORD_DEFAULT);
        auth_update_users(function ($users) use ($email, $hash) {
            $u = $users[$email];
            unset($u['pending'], $u['temp_pw'], $u['invited_by'], $u['invited_at']);
            $u['hash'] = $hash; $u['must_change'] = false; $u['fails'] = 0; $u['locked_until'] = 0; $u['consent'] = date('Y-m-d H:i');
            $users[$email] = $u;
            return $users;
        });
        tok_consume($token);
        auth_log('registered', $email, 'registrazione completata');
        $fresh = auth_get_user($email);
        session_regenerate_id(true);
        $_SESSION['user'] = $email;
        $_SESSION['pwv'] = auth_pw_fingerprint($fresh);
        $_SESSION['must_change'] = false;
        header('Location: /lodestar/');
        exit;
    }
}

$err = $errors ? '<div class="err">' . implode('<br>', array_map('auth_h', $errors)) . '</div>' : '';
auth_page('Completa la registrazione',
    '<p class="ok">Benvenuto in Lodestar! Scegli la password per <b>' . auth_h($email) . '</b>.</p>'
    . '<form method="post"><input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '"><input type="hidden" name="token" value="' . auth_h($token) . '">'
    . '<label>Nuova password</label><input name="password" type="password" autocomplete="new-password" required>'
    . '<label>Ripeti la password</label><input name="again" type="password" autocomplete="new-password" required>'
    . '<div class="ok" style="color:var(--muted);font-size:12px;margin-top:8px">Almeno 10 caratteri, con almeno tre tra minuscole, maiuscole, numeri e simboli.</div>'
    . '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text);margin-top:16px"><input type="checkbox" name="consent" value="1" style="width:auto;margin-top:2px"> '
    . '<span>Acconsento al trattamento dei miei dati di salute e allenamento (attività, peso, sonno, alimentazione) da parte di Lodestar per erogare il servizio. Posso scollegare i servizi e cancellare i miei dati in qualsiasi momento.</span></label>'
    . '<button type="submit">Completa la registrazione</button>' . $err . '</form>');
