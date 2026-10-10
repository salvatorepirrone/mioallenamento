<?php
// API del piano personalizzato di Lodestar (un piano attivo per utente). Passa dal gate: serve una sessione valida.
//   GET  ?action=get      il mio piano (o null)
//   POST action=save {plan}   salva (sostituisce) il mio piano
//   POST action=delete        elimina il mio piano
// Il piano lo costruisce il browser (planner.js); qui si controlla solo forma e dimensioni. Le sedute inviate a Garmin passano
// comunque dalla validazione di coach-api.php. Le POST portano il token nell'intestazione X-CSRF.
require_once __DIR__ . '/../auth/nutri-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$name = auth_current_user();
if (!$name) reply(['error' => 'Accesso richiesto'], 401);
if (!auth_valid_username($name)) reply(['error' => 'Utente non valido'], 400);
$file = nutri_dir() . '/plan-' . $name . '.json';
$method = $_SERVER['REQUEST_METHOD'];
$action = (string)($_GET['action'] ?? '');

if ($method === 'GET' && $action === 'get') {
    $plan = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    reply(['csrf' => auth_csrf_token(), 'plan' => is_array($plan) ? $plan : null]);
}

if ($method === 'POST') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 900000) reply(['error' => 'Piano troppo grande.'], 413);
    $body = json_decode($raw, true);
    if (!is_array($body)) reply(['error' => 'Dati non validi'], 400);

    if ($action === 'save') {
        $plan = $body['plan'] ?? null;
        if (!is_array($plan) || !isset($plan['meta']['start']) || !is_array($plan['weeks'] ?? null) || count($plan['weeks']) < 2 || count($plan['weeks']) > 45) {
            reply(['error' => 'Piano non valido.'], 400);
        }
        foreach ([$plan['meta']['start'], $plan['meta']['eventDate'] ?? $plan['meta']['endDate'] ?? null] as $d) {
            if (!nutri_valid_date($d)) reply(['error' => 'Date del piano non valide.'], 400);
        }
        $tmp = $file . '.tmp';
        file_put_contents($tmp, json_encode($plan, JSON_UNESCAPED_UNICODE));
        rename($tmp, $file);
        auth_log('plan_saved', $name, count($plan['weeks']) . ' settimane');
        reply(['ok' => true]);
    }

    if ($action === 'delete') {
        if (is_file($file)) unlink($file);
        auth_log('plan_deleted', $name);
        reply(['ok' => true]);
    }
}

reply(['error' => 'Richiesta non valida'], 400);
