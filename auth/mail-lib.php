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
    $helo = parse_url(UDATA_SITE_URL, PHP_URL_HOST) ?: 'localhost';
    $data = mail_build($cfg, $to, $subject, $text, $html, $helo);

    // Il PHP del sito (Web Station) non ha l'estensione openssl, quindi i flussi sicuri non funzionano: con TLS si passa da curl,
    // che ha il suo supporto e i certificati del sistema (lo stesso che usano le chiamate a Claude).
    if ($secure !== 'none' && function_exists('curl_init') && !function_exists('openssl_get_cert_locations')) {
        return mail_send_curl($cfg, $secure, $port, $to, $data);
    }
    $fp = null;
    try {
        $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port, $errno, $errstr, 15);
        if (!$fp) throw new RuntimeException('Server di posta non raggiungibile (' . $errstr . ')');
        stream_set_timeout($fp, 20);
        mail_cmd($fp, '', [220]);
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


// Messaggio completo (intestazioni e corpo, con CRLF) pronto per l'invio.
function mail_build(array $cfg, string $to, string $subject, string $text, string $html, string $helo): string {
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
    return implode("\r\n", $headers) . "\r\n\r\n" . $body;
}

// Invio via libcurl (smtp:// con STARTTLS oppure smtps://). libcurl gestisce da sola dot-stuffing e fine messaggio.
function mail_send_curl(array $cfg, string $secure, int $port, string $to, string $data): array {
    $ch = curl_init(($secure === 'ssl' ? 'smtps://' : 'smtp://') . $cfg['host'] . ':' . $port);
    $pos = 0;
    $opts = [
        CURLOPT_MAIL_FROM => '<' . $cfg['from'] . '>', CURLOPT_MAIL_RCPT => ['<' . $to . '>'],
        CURLOPT_UPLOAD => true, CURLOPT_INFILESIZE => strlen($data),
        CURLOPT_READFUNCTION => function ($c, $fd, $len) use ($data, &$pos) { $chunk = substr($data, $pos, $len); $pos += strlen($chunk); return $chunk; },
        CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($secure === 'tls') $opts[CURLOPT_USE_SSL] = defined('CURLUSESSL_ALL') ? CURLUSESSL_ALL : 3;
    if (!empty($cfg['user'])) { $opts[CURLOPT_USERNAME] = $cfg['user']; $opts[CURLOPT_PASSWORD] = (string)($cfg['pass'] ?? ''); }
    curl_setopt_array($ch, $opts);
    $ok = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    return $ok === false ? ['ok' => false, 'error' => 'Invio non riuscito: ' . ($err ?: 'errore sconosciuto')] : ['ok' => true, 'error' => null];
}
