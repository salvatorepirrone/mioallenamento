<?php
// Richiesta di accesso: chiunque lascia la propria email; un amministratore approva (e parte l'invito) o rifiuta. Pagina pubblica (vedi gate.php).
require_once __DIR__ . '/invite-lib.php';
auth_start();

$error = '';
$done = false;

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
        req_add($email, $nome, $nota);                     // nessun messaggio diverso se l'email e' gia' nota: niente informazioni a chi chiede
        usleep(300000);
        $done = true;
    }
}

if ($done) {
    auth_page('Richiesta inviata', '<p class="ok">Grazie! Abbiamo ricevuto la tua richiesta. Se verrà approvata, riceverai un\'email con il link per completare la registrazione.</p><p><a href="/auth/login.php">Torna all\'accesso</a></p>');
    exit;
}

auth_page('Richiedi accesso',
    '<p class="ok">Lodestar è il coach AI per allenamento e nutrizione. L\'accesso è su invito: lascia la tua email e, se la richiesta viene approvata, ti scriviamo.</p>'
    . '<form method="post"><input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
    . '<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Sito web</label><input name="sito" tabindex="-1" autocomplete="off"></div>'
    . '<label>La tua email</label><input name="email" type="email" autocomplete="email" maxlength="64" required autofocus>'
    . '<label>Il tuo nome (facoltativo)</label><input name="nome" maxlength="60" autocomplete="name">'
    . '<label>Chi ti conosce / perché vuoi usarlo (facoltativo)</label><input name="nota" maxlength="300">'
    . '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text);margin-top:16px"><input type="checkbox" name="consent" value="1" style="width:auto;margin-top:2px"> '
    . '<span>Acconsento a essere contattato a questo indirizzo per la mia richiesta di accesso.</span></label>'
    . '<button type="submit">Invia la richiesta</button>' . ($error ? '<div class="err">' . auth_h($error) . '</div>' : '')
    . '</form><p style="margin-top:16px;font-size:13px"><a href="/auth/login.php">Ho già un account</a></p>');
