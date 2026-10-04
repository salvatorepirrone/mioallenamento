<?php
// Per nginx auth_request: 204 se la sessione e' valida e la password non va
// piu' cambiata, 401 altrimenti (vedi auth/README.md).
require __DIR__ . '/lib.php';

$name = auth_current_user();
if ($name && empty($_SESSION['must_change'])) {
    http_response_code(204);
} else {
    http_response_code(401);
}
