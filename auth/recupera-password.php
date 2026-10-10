<?php
// Recupero della password via email: richiesta (indirizzo) e scelta della nuova password dal link. Pagina pubblica (vedi gate.php).
require_once __DIR__ . '/invite-lib.php';
auth_start();

$token = (string)($_GET['token'] ?? $_POST['token'] ?? '');

if ($token !== '') {
    $t = tok_find($token, 'reset');
    $user = $t ? auth_get_user($t['user']) : null;
    if (!$t || !$user || !empty($user['pending']) || !empty($user['disabled'])) {
        auth_page('Link non valido', '<p>Questo link non è valido o è scaduto.</p><p><a href="/auth/recupera-password.php">Richiedi un nuovo link</a></p>');
        exit;
    }
    $email = $t['user'];
    $errors = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        auth_csrf_check();
        $pw = (string)($_POST['password'] ?? '');
        $local = explode('@', $email)[0];
        $problems = auth_password_problems($pw, strlen($local) >= 3 ? $local : '');
        if ($pw !== (string)($_POST['again'] ?? '')) $errors[] = 'Le due password non coincidono.';
        if ($problems) $errors[] = 'La password deve avere: ' . implode('; ', $problems) . '.';
        if (!$errors) {
            $hash = password_hash($pw, PASSWORD_DEFAULT);
            auth_update_users(function ($users) use ($email, $hash) {
                $u = $users[$email];
                unset($u['temp_pw']);
                $u['hash'] = $hash; $u['must_change'] = false; $u['fails'] = 0; $u['locked_until'] = 0;
                $users[$email] = $u;
                return $users;
            });
            tok_consume($token);
            auth_log('password_reset', $email, 'via email');
            $fresh = auth_get_user($email);
            session_regenerate_id(true);
            $_SESSION['user'] = $email;
            $_SESSION['pwv'] = auth_pw_fingerprint($fresh);
            $_SESSION['must_change'] = false;
            header('Location: /');
            exit;
        }
    }
    $err = $errors ? '<div class="err">' . implode('<br>', array_map('auth_h', $errors)) . '</div>' : '';
    auth_page('Nuova password',
        '<p class="ok">Scegli la nuova password per <b>' . auth_h($email) . '</b>.</p>'
        . '<form method="post"><input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '"><input type="hidden" name="token" value="' . auth_h($token) . '">'
        . '<label>Nuova password</label><input name="password" type="password" autocomplete="new-password" required>'
        . '<label>Ripeti la password</label><input name="again" type="password" autocomplete="new-password" required>'
        . '<div class="ok" style="color:var(--muted);font-size:12px;margin-top:8px">Almeno 10 caratteri, con almeno tre tra minuscole, maiuscole, numeri e simboli.</div>'
        . '<button type="submit">Salva la password</button>' . $err . '</form>');
    exit;
}

$done = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    if (auth_valid_email($email)) reset_request($email);
    usleep(300000);
    $done = true;
}
if ($done) {
    auth_page('Controlla la posta', '<p class="ok">Se l\'indirizzo è registrato, ti abbiamo inviato un\'email con il link per scegliere una nuova password. Controlla anche la cartella dello spam.</p><p><a href="/auth/login.php">Torna all\'accesso</a></p>');
} else {
    auth_page('Password dimenticata',
        '<form method="post"><input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
        . '<label>La tua email</label><input name="email" type="email" autocomplete="email" autofocus required>'
        . '<button type="submit">Invia il link</button></form><p style="margin-top:16px"><a href="/auth/login.php">Torna all\'accesso</a></p>');
}
