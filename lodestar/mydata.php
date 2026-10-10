<?php
// I dati sincronizzati dell'utente loggato (attivita', forma Garmin, peso e sonno). Passa dal gate.
//   GET ?f=garmin-activities | garmin-fitness | garmin-weight | withings-weight | withings-sleep | goals
require_once __DIR__ . '/../auth/udata-lib.php';

$name = auth_current_user();
if (!$name) { http_response_code(401); header('Content-Type: application/json'); echo '{"error":"Accesso richiesto"}'; exit; }

$f = (string)($_GET['f'] ?? '');
if (!in_array($f, UDATA_FILES, true)) { http_response_code(400); header('Content-Type: application/json'); echo '{"error":"Dato non valido"}'; exit; }

$file = udata_paths($name)['out'] . '/' . $f . '.json';
if (!is_file($file)) { http_response_code(404); header('Content-Type: application/json'); echo '{"error":"Non ancora disponibile"}'; exit; }

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
readfile($file);
