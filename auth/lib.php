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

function auth_get_user(string $name): ?array {
    $file = auth_users_file();
    if (!is_file($file)) return null;
    $users = json_decode(file_get_contents($file), true) ?: [];
    return $users[strtolower($name)] ?? null;
}

function auth_current_user(): ?string {
    auth_start();
    return $_SESSION['user'] ?? null;
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

function auth_page(string $title, string $body): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>' . auth_h($title) . '</title><link rel="stylesheet" href="/style.css">'
       . '<style>.auth{max-width:340px;margin:12vh auto;padding:0 16px}'
       . '.auth label{display:block;font-size:12px;margin:14px 0 4px;color:var(--muted)}'
       . '.auth input{width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--r);box-sizing:border-box;font-size:15px}'
       . '.auth button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:var(--r);background:var(--accent);font-weight:700;font-size:15px;cursor:pointer}'
       . '.auth .err{color:#c0392b;font-size:13px;margin-top:12px}.auth .ok{font-size:13px;margin-top:12px}</style>'
       . '</head><body><div class="auth"><h1>' . auth_h($title) . '</h1>' . $body . '</div></body></html>';
}
