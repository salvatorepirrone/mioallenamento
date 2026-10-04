<?php
require __DIR__ . '/lib.php';

$name = auth_current_user();
if (!$name) {
    header('Location: /auth/login.php?next=/auth/cambia-password.php');
    exit;
}

$user = auth_get_user($name);
$forced = !empty($user['must_change']);
$error = '';
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $old = (string)($_POST['old'] ?? '');
    $new = (string)($_POST['new'] ?? '');
    $again = (string)($_POST['again'] ?? '');

    if (!$user || !password_verify($old, $user['hash'])) {
        $error = 'La password attuale non è corretta.';
    } elseif (strlen($new) < AUTH_MIN_PASSWORD_LEN) {
        $error = 'La nuova password deve avere almeno ' . AUTH_MIN_PASSWORD_LEN . ' caratteri.';
    } elseif ($new !== $again) {
        $error = 'Le due nuove password non coincidono.';
    } elseif ($new === $old) {
        $error = 'La nuova password deve essere diversa da quella attuale.';
    } else {
        auth_update_users(function ($users) use ($name, $new) {
            $users[$name]['hash'] = password_hash($new, PASSWORD_DEFAULT);
            $users[$name]['must_change'] = false;
            return $users;
        });
        $_SESSION['must_change'] = false;
        session_regenerate_id(true);
        $done = true;
        $forced = false;
    }
}

$body = '';
if ($done) {
    $body .= '<div class="ok">Password aggiornata. <a href="/">Vai al sito</a></div>';
} else {
    $body .= $forced ? '<p>Primo accesso: scegli una nuova password per continuare.</p>' : '';
    $body .= '<form method="post">'
        . '<input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
        . '<label>Password attuale</label><input name="old" type="password" autocomplete="current-password" required>'
        . '<label>Nuova password (min. ' . AUTH_MIN_PASSWORD_LEN . ' caratteri)</label><input name="new" type="password" autocomplete="new-password" required>'
        . '<label>Ripeti nuova password</label><input name="again" type="password" autocomplete="new-password" required>'
        . '<button type="submit">Cambia password</button>'
        . ($error ? '<div class="err">' . auth_h($error) . '</div>' : '')
        . '</form>';
}
auth_page('Cambia password', $body);
