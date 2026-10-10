<?php
// Configurazione guidata dell'invio email (SMTP) di Lodestar. Da lanciare sul NAS, da shell:
//   php /volume2/web/auth/setup-smtp.php
// Chiede i dati, scrive auth-data/smtp.json (fuori dalla cartella pubblica) e invia un'email di prova.
// La password viene digitata qui (non compare a schermo) e non passa da nessun'altra parte.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/mail-lib.php';

function ask(string $label, string $default = '', bool $secret = false): string {
    echo $label . ($default !== '' ? " [$default]" : '') . ': ';
    $tty = function_exists('posix_isatty') ? @posix_isatty(STDIN) : false;
    if ($secret && $tty) shell_exec('stty -echo');
    $v = trim((string)fgets(STDIN));
    if ($secret && $tty) { shell_exec('stty echo'); echo "\n"; }
    return $v === '' ? $default : $v;
}

echo "\n=== Invio email di Lodestar ===\n\n";
echo "Con una casella Gmail serve una \"password per le app\" (diversa dalla password normale):\n";
echo "  1. account Google > Sicurezza > attiva la \"Verifica in due passaggi\"\n";
echo "  2. account Google > Sicurezza > \"Password per le app\" > crea una password (16 caratteri)\n";
echo "  3. incollala qui sotto quando richiesto\n\n";

$cfgFile = dirname(auth_users_file()) . '/smtp.json';
if (is_file($cfgFile) && strtolower(ask('Esiste già una configurazione: sovrascriverla? (s/n)', 'n')) !== 's') { echo "Niente modificato.\n"; exit(0); }

$host = ask('Server SMTP', 'smtp.gmail.com');
$secure = strtolower(ask('Sicurezza (tls = porta 587, ssl = porta 465)', 'tls'));
$port = (int)ask('Porta', $secure === 'ssl' ? '465' : '587');
$user = ask('Utente (di solito l\'indirizzo email)');
$pass = ask('Password (o password per le app)', '', true);
$from = ask('Indirizzo mittente', $user);
$name = ask('Nome mittente', 'Lodestar');
$to = ask('Invia un\'email di prova a', $from);

if ($user === '' || $pass === '' || $from === '') { fwrite(STDERR, "Servono almeno utente, password e mittente.\n"); exit(1); }
$pass = str_replace(' ', '', $pass);                       // Google le mostra a gruppi di 4 con spazi
$cfg = ['host' => $host, 'port' => $port, 'secure' => $secure, 'user' => $user, 'pass' => $pass, 'from' => $from, 'from_name' => $name];
file_put_contents($cfgFile, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n");
echo "\nConfigurazione salvata in $cfgFile\nInvio la prova a $to ...\n";
$r = mail_send($to, 'Prova di Lodestar', "Se leggi questo messaggio, l'invio delle email di Lodestar funziona.", '<p>Se leggi questo messaggio, l\'invio delle email di <b>Lodestar</b> funziona.</p>');
if ($r['ok']) { echo "\nOK: email inviata. Controlla la posta (anche lo spam).\n"; exit(0); }
echo "\nERRORE: " . $r['error'] . "\n";
echo "Controlla utente e password (per Gmail serve la password per le app) e rilancia lo script.\n";
exit(3);
