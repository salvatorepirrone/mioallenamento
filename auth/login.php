<?php
require __DIR__ . '/lib.php';
auth_start();

$next = auth_safe_next($_GET['next'] ?? $_POST['next'] ?? '/');
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $name = strtolower(trim((string)($_POST['username'] ?? '')));
    $pass = (string)($_POST['password'] ?? '');
    $user = auth_get_user($name);

    if ($user && ($user['locked_until'] ?? 0) > time()) {
        $error = 'Troppi tentativi: riprova tra qualche minuto.';
    } elseif ($user && password_verify($pass, $user['hash'])) {
        auth_update_users(function ($users) use ($name) {
            $users[$name]['fails'] = 0;
            $users[$name]['locked_until'] = 0;
            return $users;
        });
        session_regenerate_id(true);
        $_SESSION['user'] = $name;
        $_SESSION['must_change'] = !empty($user['must_change']);
        header('Location: ' . ($_SESSION['must_change'] ? '/auth/cambia-password.php' : $next));
        exit;
    } else {
        if ($user) {
            auth_update_users(function ($users) use ($name) {
                $fails = ($users[$name]['fails'] ?? 0) + 1;
                $users[$name]['fails'] = $fails;
                if ($fails >= AUTH_MAX_FAILS) {
                    $users[$name]['fails'] = 0;
                    $users[$name]['locked_until'] = time() + AUTH_LOCK_SECONDS;
                }
                return $users;
            });
        }
        usleep(400000);
        $error = $error ?: 'Utente o password errati.';
    }
}

$body = '<form method="post">'
    . '<input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
    . '<input type="hidden" name="next" value="' . auth_h($next) . '">'
    . '<label>Utente</label><input name="username" autocomplete="username" autofocus required>'
    . '<label>Password</label><input name="password" type="password" autocomplete="current-password" required>'
    . '<button type="submit">Accedi</button>'
    . ($error ? '<div class="err">' . auth_h($error) . '</div>' : '')
    . '</form>';
auth_page('Accesso', $body);
