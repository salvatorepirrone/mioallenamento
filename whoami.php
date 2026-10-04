<?php
// Usato da nav.js per mostrare la voce "Accessi" solo agli amministratori.
// Sta fuori da /auth/ cosi' passa dal gate (serve una sessione valida).
require_once __DIR__ . '/auth/lib.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['admin' => auth_is_admin(auth_current_user())]);
