<?php
// Tasto "Aggiorna ora": esegue subito il sync Garmin + Withings invece di
// aspettare l'orario schedulato (15:00 / mezzanotte). L'unica protezione e'
// la password HTTP dell'intero sito (nginx auth_basic) -- questo endpoint
// non e' raggiungibile senza, quindi non serve un secondo segreto qui
// (che avrebbe dovuto vivere nel codice JS, finendo nel repo pubblico).

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

$py = '/var/packages/Python3.9/target/usr/bin/python3.9';
$scriptDir = '/volume2/homes/Claude/garmin-sync';
$envPrefix = 'PYTHONPATH=/var/services/homes/Claude/.local/lib/python3.9/site-packages';

$output = [];
$output[] = shell_exec("$envPrefix $py -u $scriptDir/sync.py 2>&1");
$output[] = shell_exec("$envPrefix $py -u $scriptDir/withings_sync.py 2>&1");

echo json_encode(['ok' => true, 'output' => implode("\n", $output)]);
