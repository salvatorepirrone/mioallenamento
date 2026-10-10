<?php
require_once __DIR__ . '/lib.php';
auth_start();

$next = auth_safe_next($_GET['next'] ?? $_POST['next'] ?? '/');
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $name = auth_resolve_login((string)($_POST['username'] ?? ''));
    $pass = (string)($_POST['password'] ?? '');
    $user = auth_get_user($name);

    if ($user && ($user['locked_until'] ?? 0) > time()) {
        auth_log('login_locked', $name, 'tentativo durante il blocco');
        $error = 'Troppi tentativi: riprova tra qualche minuto.';
    } elseif ($user && !empty($user['pending'])) {
        $error = 'La registrazione non è ancora completata: usa il link che hai ricevuto per email.';
    } elseif ($user && !empty($user['disabled']) && password_verify($pass, $user['hash'])) {
        auth_log('login_disabled', $name, 'account disattivato');
        $error = 'Account disattivato: contatta l\'amministratore.';
    } elseif ($user && password_verify($pass, $user['hash'])) {
        auth_update_users(function ($users) use ($name) {
            $users[$name]['fails'] = 0;
            $users[$name]['locked_until'] = 0;
            return $users;
        });
        auth_log('login_ok', $name, !empty($user['must_change']) ? 'password temporanea' : '');
        session_regenerate_id(true);
        $_SESSION['user'] = $name;
        $_SESSION['pwv'] = auth_pw_fingerprint($user);
        $_SESSION['must_change'] = !empty($user['must_change']);
        header('Location: ' . ($_SESSION['must_change'] ? '/auth/cambia-password.php' : $next));
        exit;
    } else {
        if ($user) {
            $lockedNow = false;
            auth_update_users(function ($users) use ($name, &$lockedNow) {
                $fails = ($users[$name]['fails'] ?? 0) + 1;
                $users[$name]['fails'] = $fails;
                if ($fails >= AUTH_MAX_FAILS) {
                    $users[$name]['fails'] = 0;
                    $users[$name]['locked_until'] = time() + AUTH_LOCK_SECONDS;
                    $lockedNow = true;
                }
                return $users;
            });
            auth_log('login_fail', $name, 'password errata');
            if ($lockedNow) auth_log('lockout', $name, 'account bloccato per ' . (AUTH_LOCK_SECONDS / 60) . ' minuti');
        } else {
            // Non si registra il nome digitato: potrebbe essere una password inserita per errore.
            auth_log('login_fail', '', 'utente sconosciuto');
        }
        usleep(400000);
        $error = $error ?: 'Email o password errate.';
    }
}

$body = '<form method="post">'
    . '<input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
    . '<input type="hidden" name="next" value="' . auth_h($next) . '">'
    . '<label>Email</label><input name="username" autocomplete="username" autocapitalize="none" autofocus required>'
    . '<label>Password</label><input name="password" type="password" autocomplete="current-password" required>'
    . '<button type="submit">Accedi</button>'
    . '<p style="margin-top:14px;font-size:13px"><a href="/auth/recupera-password.php">Password dimenticata?</a> · <a href="/auth/richiedi-accesso.php">Registrati</a></p>'
    . ($error ? '<div class="err">' . auth_h($error) . '</div>' : '')
    . '</form>';
auth_page('Accesso', $body);
