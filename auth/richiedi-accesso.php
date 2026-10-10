<?php
// Registrazione: chi lascia la propria email riceve il link per scegliere la password (registrazione libera) oppure, se l'admin ha attivato
// l'approvazione, la richiesta aspetta un amministratore. Pagina pubblica (vedi gate.php).
require_once __DIR__ . '/invite-lib.php';
auth_start();

$error = '';
$done = false;
$open = settings_get()['open_registration'];
$outcome = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    $nome = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($_POST['nome'] ?? ''))), 0, 60);
    $nota = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($_POST['nota'] ?? ''))), 0, 300);
    if (!empty($_POST['sito'])) {                         // campo trappola per i bot: resta vuoto per le persone
        $done = true;
    } elseif (!auth_valid_email($email)) {
        $error = 'Inserisci un indirizzo email valido.';
    } elseif (empty($_POST['consent'])) {
        $error = 'Per inviare la richiesta serve il consenso al trattamento dell\'email.';
    } else {
        if ($open) {
            $outcome = signup_open($email);                // nessun messaggio diverso se l'email e' gia' nota: niente informazioni a chi chiede
        } else {
            req_add($email, $nome, $nota);
        }
        usleep(300000);
        $done = true;
    }
}

if ($done) {
    if ($open && $outcome === 'full') {
        auth_page('Registrazioni chiuse', '<p class="ok">In questo momento Lodestar ha raggiunto il numero massimo di utenti. Abbiamo annotato la tua email e ti scriveremo appena si libera un posto.</p><p><a href="/auth/login.php">Torna all\'accesso</a></p>');
    } elseif ($open) {
        auth_page('Controlla la posta', '<p class="ok">Se l\'indirizzo è corretto, ti abbiamo inviato un\'email con il link per scegliere la password e completare la registrazione (vale 7 giorni). Controlla anche la cartella dello spam.</p>'
            . ($outcome === 'throttled' ? '<p class="ok" style="color:var(--muted)">Se avevi già ricevuto un\'email poco fa, usa quella: per sicurezza ne inviamo una sola ogni 10 minuti.</p>' : '')
            . '<p><a href="/auth/login.php">Torna all\'accesso</a></p>');
    } else {
        auth_page('Richiesta inviata', '<p class="ok">Grazie! Abbiamo ricevuto la tua richiesta. Se verrà approvata, riceverai un\'email con il link per completare la registrazione.</p><p><a href="/auth/login.php">Torna all\'accesso</a></p>');
    }
    exit;
}

auth_page($open ? 'Registrati' : 'Richiedi accesso',
    ($open ? '<p class="ok">Lodestar è il coach AI per allenamento e nutrizione. Inserisci la tua email: ti inviamo un link per scegliere la password e completare la registrazione.</p>'
           : '<p class="ok">Lodestar è il coach AI per allenamento e nutrizione. L\'accesso è su approvazione: lascia la tua email e, se la richiesta viene approvata, ti scriviamo.</p>')
    . '<form method="post"><input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
    . '<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Sito web</label><input name="sito" tabindex="-1" autocomplete="off"></div>'
    . '<label>La tua email</label><input name="email" type="email" autocomplete="email" maxlength="64" required autofocus>'
    . ($open ? '' : '<label>Il tuo nome (facoltativo)</label><input name="nome" maxlength="60" autocomplete="name">'
    . '<label>Chi ti conosce / perché vuoi usarlo (facoltativo)</label><input name="nota" maxlength="300">')
    . '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text);margin-top:16px"><input type="checkbox" name="consent" value="1" style="width:auto;margin-top:2px"> '
    . '<span>Ho letto l\'<a href="/auth/privacy.php" target="_blank" rel="noopener">informativa sulla privacy</a> e acconsento a essere contattato a questo indirizzo' . ($open ? ' per la registrazione.' : ' per la mia richiesta di accesso.') . '</span></label>'
    . '<button type="submit" id="go" disabled>' . ($open ? 'Invia il link di registrazione' : 'Invia la richiesta') . '</button>' . ($error ? '<div class="err">' . auth_h($error) . '</div>' : '')
    . '</form><p style="margin-top:16px;font-size:13px"><a href="/auth/login.php">Ho già un account</a></p>'
    . '<script>(function(){var c=document.querySelector("input[name=consent]"),b=document.getElementById("go");function s(){b.disabled=!c.checked}c.addEventListener("change",s);s()})()</script>');
