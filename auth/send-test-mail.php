<?php
// Uso (sul NAS, da shell): php auth/send-test-mail.php indirizzo@esempio.it
// Prova la configurazione SMTP (auth-data/smtp.json) inviando un messaggio di prova.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/mail-lib.php';
$to = trim($argv[1] ?? '');
if ($to === '') { fwrite(STDERR, "Uso: php send-test-mail.php <indirizzo>\n"); exit(1); }
if (!mail_config()) { fwrite(STDERR, "Manca auth-data/smtp.json (vedi auth/smtp.example.json).\n"); exit(2); }
$r = mail_send($to, 'Prova di Lodestar', "Se leggi questo messaggio, l'invio delle email di Lodestar funziona.", '<p>Se leggi questo messaggio, l\'invio delle email di <b>Lodestar</b> funziona.</p>');
echo $r['ok'] ? "Inviata a $to\n" : "Errore: " . $r['error'] . "\n";
exit($r['ok'] ? 0 : 3);
