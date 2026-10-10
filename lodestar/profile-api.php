<?php
// Profilo dell'utente (serve a calcolare obiettivi su misura). Privato: ognuno vede e modifica solo il proprio. Passa dal gate.
//   GET  ?action=get            il mio profilo (o null)
//   POST action=save {profile}  salva il mio profilo
// Le POST portano il token nell'intestazione X-CSRF.
require_once __DIR__ . '/../auth/udata-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$name = auth_current_user();
if (!$name) reply(['error' => 'Accesso richiesto'], 401);
$file = udata_ensure($name)['work'] . '/profile.json';
$method = $_SERVER['REQUEST_METHOD'];
$action = (string)($_GET['action'] ?? '');

if ($method === 'GET' && $action === 'get') {
    reply(['csrf' => auth_csrf_token(), 'profile' => udata_read_json($file), 'onboarded' => udata_onboarded($name)]);
}

if ($method === 'POST' && $action === 'onboarded') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    file_put_contents(udata_ensure($name)['work'] . '/onboarded.json', json_encode(['done' => date('Y-m-d')]));
    reply(['ok' => true]);
}

if ($method === 'POST' && $action === 'save') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    $body = json_decode((string)file_get_contents('php://input'), true);
    $in = is_array($body) ? ($body['profile'] ?? null) : null;
    if (!is_array($in)) reply(['error' => 'Dati non validi'], 400);

    $year = (int)date('Y');
    $birth = (int)($in['birth_year'] ?? 0);
    $height = (float)($in['height_cm'] ?? 0);
    if (!in_array($in['sex'] ?? '', ['m', 'f'], true)) reply(['error' => 'Indica il sesso (serve per il calcolo del fabbisogno).'], 400);
    if ($birth < 1930 || $birth > $year - 12) reply(['error' => 'Anno di nascita non valido.'], 400);
    if ($height < 120 || $height > 230) reply(['error' => 'Altezza non valida (120-230 cm).'], 400);
    if (!in_array($in['goal'] ?? '', ['lose', 'maintain', 'gain'], true)) reply(['error' => 'Scegli l\'obiettivo di peso.'], 400);
    $target = isset($in['target_weight_kg']) && $in['target_weight_kg'] !== '' ? (float)$in['target_weight_kg'] : null;
    if ($target !== null && ($target < 35 || $target > 200)) reply(['error' => 'Peso obiettivo non valido.'], 400);

    $profile = [
        'sex' => $in['sex'], 'birth_year' => $birth, 'height_cm' => round($height, 1), 'goal' => $in['goal'], 'target_weight_kg' => $target,
        'activity' => in_array($in['activity'] ?? '', ['low', 'mid', 'high'], true) ? $in['activity'] : 'mid',
        'diet' => in_array($in['diet'] ?? '', ['all', 'pesce', 'veg'], true) ? $in['diet'] : 'all',
        'updated' => date('Y-m-d'),
    ];
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode($profile, JSON_UNESCAPED_UNICODE));
    rename($tmp, $file);
    auth_log('profile_saved', $name);
    reply(['ok' => true, 'profile' => $profile]);
}

reply(['error' => 'Richiesta non valida'], 400);
