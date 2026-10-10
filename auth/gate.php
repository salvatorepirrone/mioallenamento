<?php
// Portinaio del sito: nginx gli inoltra ogni richiesta (vedi auth/README.md).
// Senza sessione valida rimanda al login; con sessione valida serve il file
// richiesto (statici tramite X-Accel-Redirect, .php eseguiti qui).
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/udata-lib.php';

$name = auth_current_user();
$valid = $name && empty($_SESSION['must_change']);

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = '/' . ltrim(rawurldecode($uri), '/');

// Pagine raggiungibili senza sessione: completamento della registrazione e recupero password (arrivano da un link via email).
if (!$valid && in_array($path, ['/auth/registrazione.php', '/auth/recupera-password.php', '/auth/richiedi-accesso.php'], true)) {
    chdir(__DIR__);
    require __DIR__ . '/' . basename($path);
    exit;
}

if (!$valid) {
    header('Cache-Control: no-store');
    if (in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD'], true)) {
        header('Location: /auth/login.php?next=' . rawurlencode($path));
    } else {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Accesso richiesto']);
    }
    exit;
}

// /data/ contiene le attivita' e il peso dell'atleta storico (le usa il sito classico): niente accesso per gli altri utenti,
// che leggono i propri dati da lodestar/mydata.php.
if (strpos($path, '/data/') === 0 && $name !== UDATA_DEFAULT_ATHLETE) {
    http_response_code(403);
    echo 'Non autorizzato';
    exit;
}

$root = realpath($_SERVER['DOCUMENT_ROOT']);
$segments = explode('/', $path);
$blocked = strpos($path, "\0") !== false || strpos($path, '/auth/') === 0 || strpos($path, '/auth-data') === 0;
foreach ($segments as $seg) {
    if ($seg === '..' || ($seg !== '' && $seg[0] === '.')) $blocked = true;
}

$full = $blocked ? false : realpath($root . $path);
if ($full && is_dir($full)) {
    foreach (['index.html', 'index.php'] as $idx) {
        if (is_file($full . '/' . $idx)) { $full .= '/' . $idx; $path = rtrim($path, '/') . '/' . $idx; break; }
    }
}
if (!$full || !is_file($full) || strpos($full, $root . DIRECTORY_SEPARATOR) !== 0) {
    http_response_code(404);
    echo 'Non trovato';
    exit;
}

if (preg_match('/\.(php[345]?|phtml)$/i', $full)) {
    $_SERVER['SCRIPT_FILENAME'] = $full;
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $path;
    chdir(dirname($full));
    require $full;
    exit;
}

header('X-Accel-Redirect: /_protected' . implode('/', array_map('rawurlencode', explode('/', $path))));
