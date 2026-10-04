<?php
// Uso (sul NAS, da shell): php auth/create-user.php matteo
// Crea l'utente con una password temporanea casuale (stampata una sola volta)
// e lo obbliga a cambiarla al primo accesso. Se l'utente esiste, ne azzera la password.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php';

$name = strtolower(trim($argv[1] ?? ''));
if (!preg_match('/^[a-z0-9._-]{2,32}$/', $name)) {
    fwrite(STDERR, "Uso: php create-user.php <nome-utente>\n");
    exit(1);
}

$alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
$temp = '';
for ($i = 0; $i < 14; $i++) $temp .= $alphabet[random_int(0, strlen($alphabet) - 1)];

auth_update_users(function ($users) use ($name, $temp) {
    $users[$name] = [
        'hash' => password_hash($temp, PASSWORD_DEFAULT),
        'must_change' => true, 'fails' => 0, 'locked_until' => 0,
    ];
    return $users;
});

echo "Utente: $name\nPassword temporanea: $temp\n(da cambiare al primo accesso)\n";
