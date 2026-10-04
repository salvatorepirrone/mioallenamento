<?php
// Usato da nav.js per mostrare chi e' collegato e la voce "Accessi" solo agli amministratori.
// Sta fuori da /auth/ cosi' passa dal gate (serve una sessione valida).
require_once __DIR__ . '/auth/lib.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');
$name = auth_current_user();
echo json_encode(['user' => $name, 'admin' => auth_is_admin($name), 'coach' => !empty(auth_get_user((string)$name)['coach'])]);
