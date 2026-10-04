<?php
// Uso (sul NAS, da shell): php auth/make-admin.php salvatore
// Abilita l'utente alla pagina /accessi.php senza toccarne la password.
// Con --revoca toglie il permesso: php auth/make-admin.php salvatore --revoca
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/lib.php';

$name = strtolower(trim($argv[1] ?? ''));
$revoke = in_array('--revoca', $argv, true);
if (!$name || !auth_get_user($name)) {
    fwrite(STDERR, "Uso: php make-admin.php <utente-esistente> [--revoca]\n");
    exit(1);
}

auth_update_users(function ($users) use ($name, $revoke) {
    $users[$name]['admin'] = !$revoke;
    return $users;
});
echo ($revoke ? "Permesso admin tolto a " : "Permesso admin dato a ") . "$name\n";
