<?php
// Inviti e recupero password via email: token monouso (se ne salva solo l'impronta), invio del link e creazione dell'utente "in attesa".
// L'identificativo di un utente e' il suo indirizzo email; gli utenti storici (nome senza @) restano validi.
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/udata-lib.php';
require_once __DIR__ . '/mail-lib.php';

const INVITE_TTL = 7 * 86400;
const RESET_TTL = 3600;

function auth_valid_email(string $e): bool {
    return strlen($e) <= 64 && (bool)filter_var($e, FILTER_VALIDATE_EMAIL) && auth_valid_username($e);
}

// ---------- token ----------
function tok_file(): string { return dirname(auth_users_file()) . '/tokens.json'; }

function tok_update(callable $fn): void {
    $file = tok_file();
    $lock = fopen($file . '.lock', 'c');
    flock($lock, LOCK_EX);
    $all = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
    $all = $fn(array_values($all));
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode(array_values($all)));
    rename($tmp, $file);
    flock($lock, LOCK_UN);
    fclose($lock);
}

function tok_all(): array {
    $file = tok_file();
    return is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
}

// Crea un token per l'utente (di norma annulla quelli precedenti dello stesso tipo) e restituisce il valore in chiaro, mostrato solo nel link.
function tok_create(string $user, string $type, int $ttl, bool $replace = true): string {
    $raw = bin2hex(random_bytes(24));
    tok_update(function ($all) use ($user, $type, $ttl, $raw, $replace) {
        $now = time();
        $all = array_values(array_filter($all, function ($t) use ($user, $type, $now) {
            return $t['exp'] > $now - 86400 && !($replace && $t['user'] === $user && $t['type'] === $type);
        }));
        $all[] = ['h' => hash('sha256', $raw), 'user' => $user, 'type' => $type, 'exp' => $now + $ttl, 'created' => $now];
        return $all;
    });
    return $raw;
}

function tok_find(string $raw, string $type): ?array {
    if (!preg_match('/^[a-f0-9]{48}$/', $raw)) return null;
    $h = hash('sha256', $raw);
    foreach (tok_all() as $t) {
        if (hash_equals($t['h'], $h) && $t['type'] === $type && $t['exp'] > time()) return $t;
    }
    return null;
}

function tok_consume(string $raw): void {
    $h = hash('sha256', $raw);
    tok_update(function ($all) use ($h) { return array_filter($all, function ($t) use ($h) { return !hash_equals($t['h'], $h); }); });
}

// Quante richieste dello stesso tipo ha fatto l'utente nell'ultima ora (limite contro gli abusi).
function tok_recent(string $user, string $type): int {
    $n = 0;
    foreach (tok_all() as $t) if ($t['user'] === $user && $t['type'] === $type && $t['created'] > time() - 3600) $n++;
    return $n;
}

// ---------- email ----------
function invite_link(string $path, string $token): string { return UDATA_SITE_URL . $path . '?token=' . $token; }

function mail_layout(string $title, string $intro, string $buttonText, string $link, string $outro): array {
    $text = "$title\n\n$intro\n\n$buttonText:\n$link\n\n$outro\n\n— Lodestar";
    $e = function ($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); };
    $html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1c2b36">'
        . '<div style="background:#12263f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><span style="color:#e8b64b;font-size:20px">✦</span> <b style="font-size:20px">Lodestar</b>'
        . '<div style="font-size:12px;color:#cfd8e3">Il tuo coach AI per allenamento e nutrizione</div></div>'
        . '<div style="border:1px solid #d9e7ef;border-top:0;padding:22px;border-radius:0 0 12px 12px">'
        . '<h2 style="margin:0 0 12px;font-size:18px">' . $e($title) . '</h2><p style="line-height:1.55">' . nl2br($e($intro)) . '</p>'
        . '<p style="margin:22px 0"><a href="' . $e($link) . '" style="background:#e8b64b;color:#12263f;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">' . $e($buttonText) . '</a></p>'
        . '<p style="font-size:12px;color:#5b6b78;line-height:1.5">Se il pulsante non funziona, copia questo indirizzo nel browser:<br><span style="word-break:break-all">' . $e($link) . '</span></p>'
        . '<p style="font-size:12px;color:#5b6b78;line-height:1.5">' . nl2br($e($outro)) . '</p></div></div>';
    return [$text, $html];
}

// ---------- inviti ----------
// Crea (o rinnova) l'utente "in attesa" e invia il link per completare la registrazione.
// Restituisce ['ok'=>bool, 'error'=>?string, 'link'=>string, 'mailed'=>bool, 'mail_error'=>?string].
function invite_user(string $email, array $roles, string $by): array {
    $email = strtolower(trim($email));
    if (!auth_valid_email($email)) return ['ok' => false, 'error' => 'Indirizzo email non valido (massimo 64 caratteri, senza spazi).'];
    $existing = auth_get_user($email);
    if ($existing && empty($existing['pending'])) return ['ok' => false, 'error' => 'Esiste già un utente con questa email.'];
    auth_update_users(function ($users) use ($email, $roles, $by) {
        $rec = ['hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), 'pending' => true, 'email' => $email,
                'invited_by' => $by, 'invited_at' => time(), 'fails' => 0, 'locked_until' => 0];
        foreach (['coach', 'nutrizionista'] as $r) if (!empty($roles[$r]) || !empty($users[$email][$r])) $rec[$r] = true;
        $users[$email] = $rec;
        return $users;
    });
    return invite_send($email);
}

// (Re)invia il link di registrazione a un utente in attesa.
function invite_send(string $email): array {
    $token = tok_create($email, 'invite', INVITE_TTL);
    $link = invite_link('/auth/registrazione.php', $token);
    [$text, $html] = mail_layout(
        'Il tuo accesso a Lodestar',
        "Ciao! Sei stato invitato a usare Lodestar, il coach AI per allenamento e nutrizione.\n\nCon il pulsante qui sotto scegli la tua password e completi la registrazione. Poi una breve guida ti aiuta a compilare il profilo e a collegare Garmin e Withings.",
        'Completa la registrazione', $link,
        "Il link vale 7 giorni e si può usare una sola volta. Se non conosci Lodestar, ignora questa email."
    );
    $m = mail_send($email, 'Il tuo accesso a Lodestar', $text, $html);
    return ['ok' => true, 'error' => null, 'link' => $link, 'mailed' => $m['ok'], 'mail_error' => $m['error']];
}

// ---------- recupero password ----------
function reset_request(string $input): void {
    $email = auth_resolve_login($input);                                      // utenti storici: si trovano dall'email associata
    $u = auth_get_user($email);
    $to = $u ? (!empty($u['email']) ? $u['email'] : (strpos($email, '@') !== false ? $email : '')) : '';
    if (!$u || $to === '' || !empty($u['pending']) || !empty($u['disabled'])) return;     // niente informazioni a chi chiede
    if (tok_recent($email, 'reset') >= 3) return;
    $token = tok_create($email, 'reset', RESET_TTL, false);   // piu' link validi insieme: serve a contare le richieste dell'ultima ora
    $link = invite_link('/auth/recupera-password.php', $token);
    [$text, $html] = mail_layout(
        'Reimposta la tua password',
        "Hai chiesto di reimpostare la password di Lodestar. Con il pulsante qui sotto ne scegli una nuova.",
        'Scegli una nuova password', $link,
        "Il link vale 1 ora e si può usare una sola volta. Se non l'hai richiesto tu, ignora questa email: la tua password non cambia."
    );
    mail_send($to, 'Reimposta la password di Lodestar', $text, $html);
    auth_log('reset_requested', $email, '');
}
