<?php
// Collegamenti dell'utente con Garmin e Withings, e sincronizzazione dei suoi dati. Passa dal gate: serve una sessione valida.
//   GET  ?action=status                      stato dei collegamenti e dell'ultima sincronizzazione
//   POST action=garmin_start {email,password}  accesso a Garmin (la password non viene conservata); puo' chiedere il codice a due fattori
//   POST action=garmin_mfa {code}              codice di verifica Garmin
//   GET  ?action=garmin_status                 avanzamento dell'accesso a Garmin
//   GET  ?action=withings_url                  indirizzo di autorizzazione Withings
//   POST action=withings_callback {code,state} chiude l'autorizzazione Withings
//   POST action=disconnect {service}           scollega e cancella i dati di quel servizio
//   POST action=sync_start / GET ?action=sync_status
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
$legacy = udata_legacy($name);
$method = $_SERVER['REQUEST_METHOD'];
$action = (string)($_GET['action'] ?? '');
$body = [];
if ($method === 'POST') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) reply(['error' => 'Dati non validi'], 400);
}

function poll_status(string $file, array $stop, int $seconds): ?array {
    $end = time() + $seconds;
    do {
        $st = udata_read_json($file);
        if ($st && in_array($st['state'] ?? '', $stop, true)) return $st;
        usleep(500000);
    } while (time() < $end);
    return udata_read_json($file);
}

try {
    if ($method === 'GET' && $action === 'status') {
        reply(['csrf' => auth_csrf_token(), 'user' => $name, 'legacy' => $legacy, 'connected' => udata_connected($name),
               'sync' => udata_read_json(udata_status_file($name, 'sync-status')), 'garmin_name' => (udata_read_json(udata_status_file($name, 'garmin-link')) ?: [])['name'] ?? null]);
    }

    if ($method === 'GET' && $action === 'sync_status') {
        reply(['sync' => udata_read_json(udata_status_file($name, 'sync-status'))]);
    }

    if ($method === 'POST' && $action === 'sync_start') {
        reply(udata_start_sync($name));
    }

    if ($method === 'GET' && $action === 'garmin_status') {
        reply(['status' => udata_read_json(udata_status_file($name, 'garmin-link'))]);
    }

    if ($method === 'POST' && $action === 'garmin_start') {
        if ($legacy) reply(['error' => 'Il tuo account Garmin è già collegato.'], 400);
        $email = trim((string)($body['email'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if ($email === '' || $password === '' || strlen($email) > 200 || strlen($password) > 200) reply(['error' => 'Inserisci email e password Garmin.'], 400);
        if (time() - (int)($_SESSION['garmin_try'] ?? 0) < 20) reply(['error' => 'Attendi qualche secondo prima di riprovare.'], 429);
        $_SESSION['garmin_try'] = time();
        $p = udata_ensure($name);
        $statusFile = udata_status_file($name, 'garmin-link');
        $cred = $p['work'] . '/tmp/cred-' . bin2hex(random_bytes(6)) . '.json';
        $old = udata_read_json($statusFile);
        if ($old && ($old['state'] ?? '') === 'mfa_required' && time() - filemtime($statusFile) < 300) reply(['error' => 'C\'è già un accesso in attesa del codice di verifica.'], 409);
        file_put_contents($cred, json_encode(['email' => $email, 'password' => $password]));
        chmod($cred, 0600);
        @unlink($p['work'] . '/tmp/mfa.txt');
        file_put_contents($statusFile, json_encode(['state' => 'starting']));
        $cmd = udata_env_prefix(udata_env($name)) . ' nohup ' . escapeshellarg(UDATA_PY) . ' -u ' . escapeshellarg(UDATA_SCRIPTS . '/garmin_connect.py') . ' '
             . escapeshellarg($cred) . ' ' . escapeshellarg($statusFile) . ' ' . escapeshellarg($p['work'] . '/tmp/mfa.txt') . ' ' . escapeshellarg($p['garmin']) . ' > /dev/null 2>&1 &';
        exec($cmd);
        auth_log('garmin_connect_try', $name);
        $st = poll_status($statusFile, ['ok', 'error', 'mfa_required'], 40);
        if (($st['state'] ?? '') === 'ok') auth_log('garmin_connected', $name);
        reply(['status' => $st]);
    }

    if ($method === 'POST' && $action === 'garmin_mfa') {
        $code = preg_replace('/\D/', '', (string)($body['code'] ?? ''));
        if (strlen($code) < 4 || strlen($code) > 10) reply(['error' => 'Codice non valido.'], 400);
        $p = udata_ensure($name);
        $statusFile = udata_status_file($name, 'garmin-link');
        $st = udata_read_json($statusFile);
        if (($st['state'] ?? '') !== 'mfa_required') reply(['error' => 'Nessun accesso in attesa del codice: ricomincia.'], 409);
        file_put_contents($p['work'] . '/tmp/mfa.txt', $code);
        usleep(1500000);
        $st = poll_status($statusFile, ['ok', 'error', 'mfa_required'], 40);
        if (($st['state'] ?? '') === 'ok') auth_log('garmin_connected', $name);
        reply(['status' => $st]);
    }

    if ($method === 'GET' && $action === 'withings_url') {
        $state = bin2hex(random_bytes(12));
        $_SESSION['wstate'] = $state;
        $_SESSION['wstate_at'] = time();
        $url = 'https://account.withings.com/oauth2_user/authorize2?' . http_build_query([
            'response_type' => 'code', 'client_id' => WITHINGS_CLIENT_ID, 'scope' => 'user.metrics,user.activity',
            'redirect_uri' => WITHINGS_REDIRECT, 'state' => $state,
        ]);
        reply(['url' => $url]);
    }

    if ($method === 'POST' && $action === 'withings_callback') {
        if ($legacy) reply(['error' => 'Il tuo account Withings è già collegato.'], 400);
        $code = (string)($body['code'] ?? '');
        $state = (string)($body['state'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_\-]{8,200}$/', $code)) reply(['error' => 'Codice di autorizzazione non valido.'], 400);
        if ($state === '' || !hash_equals((string)($_SESSION['wstate'] ?? ''), $state) || time() - (int)($_SESSION['wstate_at'] ?? 0) > 900) {
            reply(['error' => 'Richiesta scaduta o non valida: riparti da "Collega Withings".'], 400);
        }
        unset($_SESSION['wstate'], $_SESSION['wstate_at']);
        set_time_limit(180);
        udata_ensure($name);
        // Lo scambio del codice col token lo fa withings_sync.py (con il client secret del server) e subito dopo sincronizza i dati.
        $cmd = udata_env_prefix(udata_env($name, ['WITHINGS_SETUP_CODE' => $code])) . ' ' . escapeshellarg(UDATA_PY) . ' -u ' . escapeshellarg(UDATA_SCRIPTS . '/withings_sync.py') . ' 2>&1';
        $out = (string)shell_exec($cmd);
        if (!udata_connected($name)['withings']) {
            $lines = array_values(array_filter(array_map('trim', explode("\n", $out))));
            reply(['error' => 'Collegamento a Withings non riuscito: ' . mb_substr($lines ? $lines[count($lines) - 1] : 'nessuna risposta', 0, 200)], 502);
        }
        auth_log('withings_connected', $name);
        reply(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'disconnect') {
        $svc = (string)($body['service'] ?? '');
        if ($legacy) reply(['error' => 'Per il tuo account i collegamenti si gestiscono dal server.'], 400);
        if (!in_array($svc, ['garmin', 'withings'], true)) reply(['error' => 'Servizio non valido.'], 400);
        $p = udata_paths($name);
        udata_rm_dir($p[$svc]);
        foreach (UDATA_FILES as $f) if (strpos($f, $svc) === 0) @unlink($p['out'] . '/' . $f . '.json');
        if ($svc === 'garmin') { udata_rm_dir($p['work'] . '/laps-cache'); udata_rm_dir($p['work'] . '/exercise-sets-cache'); @unlink(udata_status_file($name, 'garmin-link')); }
        auth_log($svc . '_disconnected', $name);
        reply(['ok' => true]);
    }

    reply(['error' => 'Richiesta non valida'], 400);
} catch (Throwable $e) {
    reply(['error' => 'Errore interno'], 500);
}
