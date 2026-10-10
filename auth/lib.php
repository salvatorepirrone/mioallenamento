<?php
// Utenti del sito: file JSON FUORI dalla cartella pubblica (e dal repo), con
// solo hash bcrypt delle password. Si gestisce con auth/create-user.php.

const AUTH_USERS_FILE_DEFAULT = '/volume2/web/auth-data/users.json';
const AUTH_MIN_PASSWORD_LEN = 10;
const AUTH_WEAK_WORDS = ['password', 'passw0rd', 'qwerty', 'asdfgh', 'letmein', 'welcome', 'admin', 'allenamento', 'pirrone', 'garmin', 'abc123'];
const AUTH_MAX_FAILS = 5;
const AUTH_LOCK_SECONDS = 300;

function auth_users_file(): string {
    return getenv('AUTH_USERS_FILE') ?: AUTH_USERS_FILE_DEFAULT;
}

function auth_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();
}

// Esegue $fn(array $users): array sotto lock esclusivo e salva il risultato.
function auth_update_users(callable $fn): void {
    $file = auth_users_file();
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $lock = fopen($file . '.lock', 'c');
    flock($lock, LOCK_EX);
    $users = is_file($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
    $users = $fn($users);
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    rename($tmp, $file);
    flock($lock, LOCK_UN);
    fclose($lock);
}

// Un utente e' identificato dal suo indirizzo email; restano validi i nomi storici (senza @). Niente barre, spazi o '..': il nome finisce in nomi di file.
function auth_valid_username(string $name): bool {
    if (strpos($name, '..') !== false) return false;
    if (preg_match('/^[a-z0-9._-]{2,32}$/', $name)) return true;
    return strlen($name) <= 64 && (bool)preg_match('/^[a-z0-9._%+-]{1,40}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/', $name);
}

function auth_all_users(): array {
    $file = auth_users_file();
    $users = is_file($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
    ksort($users);
    return $users;
}

// Crea l'utente con una password temporanea casuale (da cambiare al primo accesso) e la
// restituisce. Se l'utente esiste gia': null, a meno di $overwrite (azzera la password e
// mantiene il ruolo admin).
// Ogni utente ha accesso a una o piu' app del sito: 'lodestar' e 'pianoallenamento' (il sito classico, gestito a mano dall'admin).
// Gli utenti storici, senza il campo 'apps', mantengono l'accesso a entrambe.
const AUTH_APPS = ['lodestar' => 'Lodestar', 'pianoallenamento' => 'Piano allenamento'];

function auth_has_app(?string $name, string $app): bool {
    $u = $name ? auth_get_user($name) : null;
    if (!$u) return false;
    if (!array_key_exists('apps', $u)) return true;
    return !empty($u['apps'][$app]);
}

function auth_apps_of(?string $name): array {
    return array_values(array_filter(array_keys(AUTH_APPS), function ($a) use ($name) { return auth_has_app($name, $a); }));
}

function auth_create_user(string $name, bool $overwrite = false, ?array $apps = null): ?string {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $temp = '';
    for ($i = 0; $i < 14; $i++) $temp .= $alphabet[random_int(0, strlen($alphabet) - 1)];

    $created = false;
    auth_update_users(function ($users) use ($name, $temp, $overwrite, $apps, &$created) {
        if (isset($users[$name]) && !$overwrite) return $users;
        $record = ['hash' => password_hash($temp, PASSWORD_DEFAULT), 'must_change' => true, 'fails' => 0, 'locked_until' => 0, 'temp_pw' => $temp];
        foreach (['admin', 'coach', 'nutrizionista', 'disabled', 'email', 'apps'] as $keep) if (!empty($users[$name][$keep])) $record[$keep] = $users[$name][$keep];
        if ($apps !== null && !isset($users[$name])) $record['apps'] = $apps;
        $users[$name] = $record;
        $created = true;
        return $users;
    });
    return $created ? $temp : null;
}

// Dal testo digitato all'identificativo dell'utente: il nome (o email) con cui e' registrato, oppure l'email associata a un utente storico.
function auth_resolve_login(string $input): string {
    $input = strtolower(trim($input));
    if ($input === '' || auth_get_user($input)) return $input;
    foreach (auth_all_users() as $key => $u) {
        if (!empty($u['email']) && strtolower($u['email']) === $input) return (string)$key;
    }
    return $input;
}

function auth_get_user(string $name): ?array {
    $file = auth_users_file();
    if (!is_file($file)) return null;
    $users = json_decode(file_get_contents($file), true) ?: [];
    return $users[strtolower($name)] ?? null;
}

// Registro degli accessi: una riga JSON per evento, accanto a users.json (chiuso al web).
function auth_log_file(): string {
    return dirname(auth_users_file()) . '/access.log';
}

function auth_log(string $event, string $user = '', string $detail = ''): void {
    $row = [
        't' => (new DateTime('now', new DateTimeZone('Europe/Rome')))->format('Y-m-d H:i:s'),
        'e' => $event, 'u' => $user, 'ip' => $_SERVER['REMOTE_ADDR'] ?? '?',
        'ua' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 120), 'd' => $detail,
    ];
    @file_put_contents(auth_log_file(), json_encode($row, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

function auth_is_admin(?string $name): bool {
    $user = $name ? auth_get_user($name) : null;
    return !empty($user['admin']);
}

// Impronta dell'hash corrente: se la password cambia (o viene azzerata da un admin) le
// sessioni aperte con la vecchia smettono di valere. Le sessioni senza impronta (create
// prima di questa funzione) restano valide fino al prossimo accesso.
function auth_pw_fingerprint(array $user): string {
    return substr(hash('sha256', (string)($user['hash'] ?? '')), 0, 16);
}

// Utente della sessione, se esiste ancora, non e' disattivato e la password e' quella della sessione.
function auth_current_user(): ?string {
    auth_start();
    $name = $_SESSION['user'] ?? null;
    if (!$name) return null;
    $user = auth_get_user($name);
    if (!$user || !empty($user['disabled'])
        || (isset($_SESSION['pwv']) && $_SESSION['pwv'] !== auth_pw_fingerprint($user))) {
        unset($_SESSION['user'], $_SESSION['pwv'], $_SESSION['must_change']);
        return null;
    }
    return $name;
}

function auth_csrf_token(): string {
    auth_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function auth_csrf_check(): void {
    auth_start();
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        http_response_code(400);
        exit('Richiesta non valida, ricarica la pagina.');
    }
}

// Elenco dei motivi per cui una nuova password e' troppo debole (vuoto = ok).
// Le stesse regole sono replicate in cambia-password.php per il controllo in diretta.
function auth_password_problems(string $pw, string $username): array {
    $problems = [];
    if (strlen($pw) < AUTH_MIN_PASSWORD_LEN) $problems[] = 'almeno ' . AUTH_MIN_PASSWORD_LEN . ' caratteri';
    $classes = (preg_match('/[a-z]/', $pw) ? 1 : 0) + (preg_match('/[A-Z]/', $pw) ? 1 : 0)
             + (preg_match('/\d/', $pw) ? 1 : 0) + (preg_match('/[^a-zA-Z\d]/', $pw) ? 1 : 0);
    if ($classes < 3) $problems[] = 'almeno tre tra minuscole, maiuscole, numeri e simboli';
    $low = strtolower($pw);
    if ($username !== '' && strpos($low, strtolower($username)) !== false) $problems[] = 'non deve contenere il tuo nome utente';
    foreach (AUTH_WEAK_WORDS as $w) {
        if (strpos($low, $w) !== false) { $problems[] = 'non deve contenere parole comuni ("' . $w . '")'; break; }
    }
    if (preg_match('/(.)\1{3,}/', $pw)) $problems[] = 'non più di 3 caratteri uguali di fila';
    for ($i = 0; $i + 3 < strlen($low); $i++) {
        $d = ord($low[$i + 1]) - ord($low[$i]);
        if (abs($d) === 1 && ord($low[$i + 2]) - ord($low[$i + 1]) === $d && ord($low[$i + 3]) - ord($low[$i + 2]) === $d) {
            $problems[] = 'niente sequenze come "1234" o "abcd"';
            break;
        }
    }
    return $problems;
}

function auth_h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function auth_safe_next(string $next): string {
    return ($next !== '' && $next[0] === '/' && !preg_match('#^/[/\\\\]#', $next)) ? $next : '/';
}

function auth_page(string $title, string $body, bool $wide = false): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    $favicon = "data:image/svg+xml," . rawurlencode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#12263f"/><path d="M32 8l5.5 18.5L56 32l-18.5 5.5L32 56l-5.5-18.5L8 32l18.5-5.5z" fill="#e8b64b"/></svg>');
    $css = ':root{--navy:#12263f;--navy2:#1f4a70;--gold:#e8b64b;--text:#1c2b36;--muted:#5b6b78;--line:#d5e0e8;--bad:#c0392b;--good:#2e7d32}'
        . '*{box-sizing:border-box}html,body{margin:0;min-height:100%}'
        . 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--text);background:linear-gradient(160deg,var(--navy) 0%,var(--navy2) 100%);background-attachment:fixed;'
        . 'display:flex;flex-direction:column;align-items:center;padding:7vh 16px 32px}'
        . '.brand{text-align:center;color:#fff;margin-bottom:22px}.brand .logo{font-size:30px;font-weight:700;letter-spacing:.02em}.brand .logo b{color:var(--gold);font-weight:700}'
        . '.brand .tag{font-size:13px;color:rgba(255,255,255,.72);margin-top:4px}'
        . '.auth{width:100%;max-width:400px;background:#fff;border-radius:16px;padding:26px 24px 24px;box-shadow:0 14px 40px rgba(0,0,0,.28)}'
        . '.auth h1{font-size:21px;margin:0 0 6px;color:var(--navy)}'
        . '.auth p{font-size:14px;line-height:1.55;margin:10px 0}'
        . '.auth label{display:block;font-size:12.5px;font-weight:600;margin:16px 0 5px;color:var(--muted)}'
        . '.auth input[type=text],.auth input[type=email],.auth input[type=password],.auth input:not([type]){width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:16px;font-family:inherit;color:var(--text);background:#fff}'
        . '.auth input:focus{outline:none;border-color:var(--navy2);box-shadow:0 0 0 3px rgba(31,74,112,.18)}'
        . '.auth input[type=checkbox]{width:auto;accent-color:var(--navy2)}'
        . '.auth button{margin-top:22px;width:100%;padding:13px;border:0;border-radius:10px;background:var(--gold);color:var(--navy);font-weight:700;font-size:16px;font-family:inherit;cursor:pointer}'
        . '.auth button:hover{filter:brightness(1.05)}.auth button:disabled{opacity:.45;cursor:not-allowed;filter:none}'
        . '.auth.wide{max-width:720px}.auth h2{font-size:15px;margin:20px 0 4px;color:var(--navy)}.auth ul{padding-left:20px;margin:6px 0;font-size:14px;line-height:1.55}.auth li{margin:5px 0}'
        . '.auth a{color:var(--navy2);font-weight:600;text-decoration:none}.auth a:hover{text-decoration:underline}'
        . '.auth .err{margin-top:14px;padding:10px 12px;background:#fdecea;border:1px solid #f3c2bd;border-radius:10px;color:var(--bad);font-size:13.5px;line-height:1.5}'
        . '.auth .ok{font-size:14px;line-height:1.55}'
        . '.foot{margin-top:18px;font-size:12px;color:rgba(255,255,255,.6);text-align:center}';
    echo '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#12263f">'
       . '<link rel="icon" href="' . $favicon . '"><title>' . auth_h($title) . ' · Lodestar</title><style>' . $css . '</style>'
       . '</head><body><div class="brand"><div class="logo"><b>✦</b> Lodestar</div><div class="tag">Il tuo coach AI per allenamento e nutrizione</div></div>'
       . '<div class="auth' . ($wide ? ' wide' : '') . '"><h1>' . auth_h($title) . '</h1>' . $body . '</div><div class="foot">Lodestar</div></body></html>';
}
