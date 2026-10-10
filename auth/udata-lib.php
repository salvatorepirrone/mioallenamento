<?php
// Dati personali di ogni utente (Garmin e Withings): cartelle, collegamenti e avvio delle sincronizzazioni.
// Fuori dalla cartella pubblica, accanto a users.json. Per l'atleta storico (COACH_DEFAULT_ATHLETE) restano i percorsi
// di prima (garmin-sync/.env e /volume2/web/data), cosi' il sito esistente continua a funzionare identico.
require_once __DIR__ . '/lib.php';

const UDATA_DEFAULT_ATHLETE = 'salvatore';
const UDATA_PY = '/var/packages/Python3.9/target/usr/bin/python3.9';
const UDATA_PYTHONPATH = '/var/services/homes/Claude/.local/lib/python3.9/site-packages';
const UDATA_SCRIPTS = '/volume2/homes/Claude/garmin-sync';
const UDATA_LEGACY_OUT = '/volume2/web/data';
const WITHINGS_CLIENT_ID = '3fbf541859fb9995d2e1ea7e89754aafc8375d2e6af6cc20846de2db87a91445';
const WITHINGS_REDIRECT = 'https://pirrone.direct.quickconnect.to/callback.html';
const UDATA_SITE_URL = 'https://pirrone.direct.quickconnect.to';
const UDATA_FILES = ['garmin-activities', 'garmin-fitness', 'garmin-weight', 'withings-weight', 'withings-sleep', 'goals'];

function udata_legacy(string $user): bool { return $user === UDATA_DEFAULT_ATHLETE; }

function udata_base(string $user): string {
    if (!auth_valid_username($user)) throw new RuntimeException('Utente non valido');
    return dirname(auth_users_file()) . '/users-data/' . $user;
}

// Cartelle dell'utente: dati sincronizzati, token Garmin, token Withings.
function udata_paths(string $user): array {
    if (udata_legacy($user)) {
        return ['out' => UDATA_LEGACY_OUT, 'garmin' => UDATA_SCRIPTS . '/.garmin-session', 'withings' => UDATA_SCRIPTS . '/.withings-session', 'work' => udata_base($user)];
    }
    $b = udata_base($user);
    return ['out' => $b . '/output', 'garmin' => $b . '/garmin-session', 'withings' => $b . '/withings-session', 'work' => $b];
}

function udata_ensure(string $user): array {
    $p = udata_paths($user);
    foreach ([$p['work'], $p['out'], $p['work'] . '/tmp'] as $d) if (!is_dir($d)) @mkdir($d, 0770, true);
    return $p;
}

// Stato della configurazione di un utente: profilo compilato e guida del primo accesso chiusa.
function udata_has_profile(string $user): bool { return is_file(udata_base($user) . '/profile.json'); }
function udata_onboarded(string $user): bool { return is_file(udata_base($user) . '/onboarded.json'); }

function udata_connected(string $user): array {
    $p = udata_paths($user);
    return [
        'garmin' => is_file($p['garmin'] . '/oauth1_token.json') && is_file($p['garmin'] . '/oauth2_token.json'),
        'withings' => is_file($p['withings'] . '/token.json'),
    ];
}

function udata_rm_dir(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $path = $dir . '/' . $f;
        is_dir($path) ? udata_rm_dir($path) : @unlink($path);
    }
    @rmdir($dir);
}

// Variabili d'ambiente per sync.py / withings_sync.py. Per gli altri utenti si svuotano le credenziali dell'atleta storico:
// una sessione scaduta deve fallire, mai ripiegare sull'account di qualcun altro.
function udata_env(string $user, array $extra = []): array {
    $env = ['PYTHONPATH' => UDATA_PYTHONPATH];
    if (!udata_legacy($user)) {
        $p = udata_ensure($user);
        $env += [
            'GARMIN_EMAIL' => '', 'GARMIN_PASSWORD' => '', 'GARMIN_TOKENSTORE' => $p['garmin'], 'OUTPUT_DIR' => $p['out'],
            'LAPS_CACHE_DIR' => $p['work'] . '/laps-cache', 'EXERCISE_SETS_CACHE_DIR' => $p['work'] . '/exercise-sets-cache',
            'FIT_DIR' => $p['work'] . '/fit-files', 'DOWNLOAD_FIT' => 'false', 'WITHINGS_SESSION_DIR' => $p['withings'],
            'WITHINGS_SETUP_CODE' => '', 'WITHINGS_SETUP_REFRESH_TOKEN' => '',
        ];
    }
    return $extra + $env;
}

function udata_env_prefix(array $env): string {
    $parts = [];
    foreach ($env as $k => $v) $parts[] = $k . '=' . escapeshellarg((string)$v);
    return 'env ' . implode(' ', $parts);
}

function udata_status_file(string $user, string $name): string { return udata_ensure($user)['work'] . '/' . $name . '.json'; }

function udata_read_json(string $file): ?array {
    $d = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    return is_array($d) ? $d : null;
}

// Avvia in background la sincronizzazione dei servizi collegati; non parte se ce n'e' gia' una in corso.
function udata_start_sync(string $user): array {
    $conn = udata_connected($user);
    $services = array_keys(array_filter($conn));
    if (!$services) return ['started' => false, 'reason' => 'Nessun servizio collegato.'];
    $file = udata_status_file($user, 'sync-status');
    $cur = udata_read_json($file);
    if ($cur && ($cur['state'] ?? '') === 'running' && time() - (int)($cur['started'] ?? 0) < 1500) return ['started' => false, 'reason' => 'Sincronizzazione già in corso.'];
    @file_put_contents($file, json_encode(['state' => 'running', 'started' => time(), 'results' => new stdClass()]));
    $cmd = udata_env_prefix(udata_env($user)) . ' nohup ' . escapeshellarg(UDATA_PY) . ' -u ' . escapeshellarg(UDATA_SCRIPTS . '/sync_user.py') . ' '
         . escapeshellarg($file) . ' ' . escapeshellarg(implode(',', $services)) . ' > /dev/null 2>&1 &';
    exec($cmd);
    return ['started' => true];
}
