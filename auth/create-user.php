<?php
// Uso (sul NAS, da shell): php auth/create-user.php matteo
// Crea l'utente con una password temporanea casuale (stampata una sola volta)
// e lo obbliga a cambiarla al primo accesso. Se l'utente esiste, ne azzera la password.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/lib.php';

$name = strtolower(trim($argv[1] ?? ''));
if (!auth_valid_username($name)) {
    fwrite(STDERR, "Uso: php create-user.php <nome-utente>\n");
    exit(1);
}

$temp = auth_create_user($name, true);
echo "Utente: $name\nPassword temporanea: $temp\n(da cambiare al primo accesso)\n";
