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


// ---------- richieste di accesso ----------
function req_file(): string { return dirname(auth_users_file()) . '/access-requests.json'; }

function req_all(): array {
    $f = req_file();
    return is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
}

function req_update(callable $fn): void {
    $file = req_file();
    $lock = fopen($file . '.lock', 'c');
    flock($lock, LOCK_EX);
    $all = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
    $all = $fn(array_values($all));
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode(array_values($all), JSON_UNESCAPED_UNICODE));
    rename($tmp, $file);
    flock($lock, LOCK_UN);
    fclose($lock);
}

// Registra una richiesta (con limiti: una in attesa per email, poche per indirizzo IP) e avvisa gli admin.
function req_add(string $email, string $nome, string $nota): void {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '?');
    $existing = auth_get_user($email);
    $added = false;
    req_update(function ($all) use ($email, $nome, $nota, $ip, $existing, &$added) {
        $now = time();
        $all = array_values(array_filter($all, function ($r) use ($now) { return $r['status'] === 'pending' || $r['created'] > $now - 30 * 86400; }));
        if ($existing) return $all;                                            // gia' registrato o invitato: si ignora in silenzio
        foreach ($all as $r) if ($r['email'] === $email && $r['status'] === 'pending') return $all;
        $fromIp = 0;
        foreach ($all as $r) if (($r['ip'] ?? '') === $ip && $r['created'] > $now - 3600) $fromIp++;
        if ($fromIp >= 5) return $all;
        $all[] = ['id' => bin2hex(random_bytes(6)), 'email' => $email, 'nome' => $nome, 'nota' => $nota, 'created' => $now, 'status' => 'pending', 'ip' => $ip];
        $added = true;
        return $all;
    });
    if ($added) {
        auth_log('access_requested', $email, '');
        req_notify_admins($email, $nome, $nota);
    }
}

function req_notify_admins(string $email, string $nome, string $nota): void {
    foreach (auth_all_users() as $key => $u) {
        if (empty($u['admin']) || !empty($u['disabled'])) continue;
        $to = !empty($u['email']) ? $u['email'] : (strpos((string)$key, '@') !== false ? $key : '');
        if ($to === '') continue;
        $link = UDATA_SITE_URL . '/pianoallenamento/accessi.php';
        [$text, $html] = mail_layout('Nuova richiesta di accesso',
            "$email" . ($nome !== '' ? " ($nome)" : '') . " ha chiesto di usare Lodestar." . ($nota !== '' ? "\n\nNota: $nota" : ''),
            'Vai alle richieste', $link, 'Puoi approvarla (parte l\'invito) o rifiutarla dalla pagina Accessi.');
        mail_send($to, 'Richiesta di accesso a Lodestar', $text, $html);
    }
}

function req_pending(): array {
    return array_values(array_filter(req_all(), function ($r) { return $r['status'] === 'pending'; }));
}


// ---------- registrazione libera ----------
// Impostazioni del sito (modificabili dall'admin nella pagina Accessi). Di default la registrazione e' libera, con un tetto agli utenti.
function settings_file(): string { return dirname(auth_users_file()) . '/settings.json'; }

function settings_get(): array {
    $f = settings_file();
    $s = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
    return ['open_registration' => array_key_exists('open_registration', $s) ? (bool)$s['open_registration'] : true,
            'max_users' => max(1, (int)($s['max_users'] ?? 50))];
}

function settings_set(array $new): void {
    $cur = settings_get();
    $out = ['open_registration' => array_key_exists('open_registration', $new) ? (bool)$new['open_registration'] : $cur['open_registration'],
            'max_users' => max(1, min(500, (int)($new['max_users'] ?? $cur['max_users'])))];
    file_put_contents(settings_file(), json_encode($out));
}

function users_active_count(): int {
    $n = 0;
    foreach (auth_all_users() as $u) if (empty($u['pending']) && empty($u['disabled'])) $n++;
    return $n;
}

// Toglie gli inviti mai completati dopo 14 giorni.
function prune_pending_users(): void {
    $limit = time() - 14 * 86400;
    $stale = [];
    foreach (auth_all_users() as $k => $u) if (!empty($u['pending']) && (int)($u['invited_at'] ?? 0) < $limit) $stale[] = $k;
    if (!$stale) return;
    auth_update_users(function ($users) use ($stale) { foreach ($stale as $k) unset($users[$k]); return $users; });
}

// Iscrizione autonoma: invia il link di registrazione all'indirizzo indicato (e solo a quello: il link non si mostra mai a chi si iscrive,
// cosi' l'email viene verificata). Esiti: 'sent', 'exists', 'throttled', 'full'.
function signup_open(string $email): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '?');
    prune_pending_users();
    $existing = auth_get_user($email);
    if ($existing && empty($existing['pending'])) { auth_log('signup_existing', $email, ''); return 'exists'; }
    if ($existing && (int)($existing['invited_at'] ?? 0) > time() - 600) return 'throttled';      // invito appena inviato: niente reinvii a raffica
    if (users_active_count() >= settings_get()['max_users']) { req_add($email, '', 'lista d\'attesa: limite di utenti raggiunto'); return 'full'; }
    $now = time();
    $blocked = false;
    req_update(function ($all) use ($ip, $email, $now, &$blocked) {
        $all = array_values(array_filter($all, function ($r) use ($now) { return $r['status'] === 'pending' || $r['created'] > $now - 30 * 86400; }));
        $fromIp = 0; $hour = 0;
        foreach ($all as $r) {
            if ($r['status'] !== 'auto' || $r['created'] <= $now - 3600) continue;
            $hour++;
            if (($r['ip'] ?? '') === $ip) $fromIp++;
        }
        if ($fromIp >= 5 || $hour >= 30) { $blocked = true; return $all; }                   // 5 all'ora per indirizzo IP, 30 in tutto il sito
        $all[] = ['id' => bin2hex(random_bytes(6)), 'email' => $email, 'nome' => '', 'nota' => 'iscrizione libera', 'created' => $now, 'status' => 'auto', 'ip' => $ip];
        return $all;
    });
    if ($blocked) return 'throttled';
    $r = invite_user($email, [], 'iscrizione libera');
    if (empty($r['ok'])) return 'sent';                                                       // indirizzo non valido: stessa risposta
    auth_log('signup', $email, $r['mailed'] ? 'email inviata' : 'email NON inviata: ' . ($r['mail_error'] ?? ''));
    return 'sent';
}
