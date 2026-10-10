<?php
// Invio di email via SMTP (senza librerie esterne). La configurazione sta fuori dalla cartella pubblica:
//   auth-data/smtp.json = {"host":"smtp.esempio.it","port":587,"secure":"tls","user":"...","pass":"...","from":"noreply@esempio.it","from_name":"Lodestar"}
// secure: "tls" (STARTTLS, di solito porta 587), "ssl" (porta 465) oppure "none" (solo per prove in locale).
// Senza configurazione mail_send() restituisce ok=false e il sito mostra il link all'amministratore, che lo inoltra a mano.
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/udata-lib.php';

function mail_config(): ?array {
    $file = dirname(auth_users_file()) . '/smtp.json';
    $c = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    return (is_array($c) && !empty($c['host']) && !empty($c['from'])) ? $c : null;
}

function mail_read($fp): array {
    $text = '';
    $code = 0;
    while (($line = fgets($fp, 1024)) !== false) {
        $text .= $line;
        $code = (int)substr($line, 0, 3);
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    return [$code, trim($text)];
}

function mail_cmd($fp, string $cmd, array $expect): string {
    if ($cmd !== '') fwrite($fp, $cmd . "\r\n");
    [$code, $text] = mail_read($fp);
    if (!in_array($code, $expect, true)) throw new RuntimeException('Risposta inattesa dal server di posta (' . $code . ')');
    return $text;
}

function mail_encode_header(string $s): string {
    return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

// Invia un'email di testo (e, se presente, HTML). Restituisce ['ok' => bool, 'error' => ?string].
function mail_send(string $to, string $subject, string $text, string $html = ''): array {
    $cfg = mail_config();
    if (!$cfg) return ['ok' => false, 'error' => 'Invio email non configurato sul server.'];
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return ['ok' => false, 'error' => 'Indirizzo email non valido.'];
    $secure = $cfg['secure'] ?? 'tls';
    $port = (int)($cfg['port'] ?? ($secure === 'ssl' ? 465 : ($secure === 'none' ? 25 : 587)));
    $fp = null;
    try {
        $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port, $errno, $errstr, 15);
        if (!$fp) throw new RuntimeException('Server di posta non raggiungibile (' . $errstr . ')');
        stream_set_timeout($fp, 20);
        mail_cmd($fp, '', [220]);
        $helo = parse_url(UDATA_SITE_URL, PHP_URL_HOST) ?: 'localhost';
        mail_cmd($fp, 'EHLO ' . $helo, [250]);
        if ($secure === 'tls') {
            mail_cmd($fp, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('Connessione sicura al server di posta non riuscita');
            mail_cmd($fp, 'EHLO ' . $helo, [250]);
        }
        if (!empty($cfg['user'])) {
            mail_cmd($fp, 'AUTH LOGIN', [334]);
            mail_cmd($fp, base64_encode($cfg['user']), [334]);
            mail_cmd($fp, base64_encode((string)($cfg['pass'] ?? '')), [235]);
        }
        mail_cmd($fp, 'MAIL FROM:<' . $cfg['from'] . '>', [250]);
        mail_cmd($fp, 'RCPT TO:<' . $to . '>', [250, 251]);
        mail_cmd($fp, 'DATA', [354]);

        $boundary = 'b' . bin2hex(random_bytes(8));
        $fromName = (string)($cfg['from_name'] ?? 'Lodestar');
        $headers = [
            'From: ' . mail_encode_header($fromName) . ' <' . $cfg['from'] . '>',
            'To: <' . $to . '>',
            'Subject: ' . mail_encode_header($subject),
            'Date: ' . date('r'),
            'Message-ID: <' . bin2hex(random_bytes(10)) . '@' . $helo . '>',
            'MIME-Version: 1.0',
        ];
        $b64 = function (string $s) { return chunk_split(base64_encode($s), 76, "\r\n"); };
        if ($html !== '') {
            $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
            $body = '--' . $boundary . "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($text)
                  . '--' . $boundary . "\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($html)
                  . '--' . $boundary . "--\r\n";
        } else {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: base64';
            $body = $b64($text);
        }
        $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
        $data = preg_replace('/^\./m', '..', $data);           // dot-stuffing
        fwrite($fp, $data . "\r\n.\r\n");
        [$code] = mail_read($fp);
        if ($code !== 250) throw new RuntimeException('Il server di posta ha rifiutato il messaggio (' . $code . ')');
        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return ['ok' => true, 'error' => null];
    } catch (Throwable $e) {
        if (is_resource($fp)) @fclose($fp);
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}
