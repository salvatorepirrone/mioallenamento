<?php
require_once __DIR__ . '/lib.php';

$name = auth_current_user();
if (!$name) {
    header('Location: /auth/login.php?next=/auth/cambia-password.php');
    exit;
}

$user = auth_get_user($name);
// Primo accesso: la sessione e' nata poco fa dalla password temporanea, quindi non la richiediamo di nuovo.
$forced = !empty($user['must_change']) && !empty($_SESSION['must_change']);
$problems = [];
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    auth_csrf_check();
    $old = (string)($_POST['old'] ?? '');
    $new = (string)($_POST['new'] ?? '');
    $again = (string)($_POST['again'] ?? '');

    if (!$user) {
        $problems[] = 'Utente non trovato.';
    } elseif (!$forced && !password_verify($old, $user['hash'])) {
        $problems[] = 'La password attuale non è corretta.';
    } elseif ($new !== $again) {
        $problems[] = 'Le due nuove password non coincidono.';
    } elseif (password_verify($new, $user['hash'])) {
        $problems[] = 'La nuova password deve essere diversa da quella attuale.';
    } else {
        $weak = auth_password_problems($new, $name);
        if ($weak) {
            $problems[] = 'La nuova password è troppo debole: ' . implode('; ', $weak) . '.';
        } else {
            auth_update_users(function ($users) use ($name, $new) {
                $users[$name]['hash'] = password_hash($new, PASSWORD_DEFAULT);
                $users[$name]['must_change'] = false;
                return $users;
            });
            auth_log('password_changed', $name, $forced ? 'primo accesso' : 'volontario');
            $_SESSION['must_change'] = false;
            session_regenerate_id(true);
            $done = true;
        }
    }
}

if ($done) {
    auth_page('Password aggiornata', '<p style="font-size:15px">✓ La nuova password è attiva.</p>'
        . '<p>Il cambio è completato: <b>clicca il pulsante per entrare nel sito</b>.</p>'
        . '<a href="/" style="display:block;margin-top:18px;padding:14px;border-radius:var(--r);background:var(--accent);'
        . 'font-weight:700;font-size:17px;text-align:center;text-decoration:none;color:inherit">Vai al sito →</a>'
        . '<p style="font-size:12px;color:var(--muted);margin-top:14px">Verrai portato al sito automaticamente tra <span id="n">8</span> secondi.</p>'
        . '<script>var n=8,el=document.getElementById("n");setInterval(function(){n--;if(n<=0){location.href="/"}else{el.textContent=n}},1000)</script>');
    exit;
}

$title = $forced ? 'Scegli la tua nuova password' : 'Cambia password';
$body = $forced
    ? '<p>Hai effettuato il primo accesso con una password temporanea. Per continuare scegli una <b>nuova password personale</b> e scrivila due volte.</p>'
    : '';
$body .= '<form method="post" id="pwform">'
    . '<input type="hidden" name="csrf" value="' . auth_h(auth_csrf_token()) . '">'
    . '<input type="text" name="username" value="' . auth_h($name) . '" autocomplete="username" readonly tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px">'
    . ($forced ? '' : '<label>Password attuale</label><input name="old" type="password" autocomplete="current-password" required>')
    . '<label>Nuova password</label><input name="new" id="pw1" type="password" autocomplete="new-password" required autofocus>'
    . '<label>Ripeti la nuova password</label><input name="again" id="pw2" type="password" autocomplete="new-password" required>'
    . '<ul id="rules" class="rules"></ul>'
    . '<button type="submit" id="submitBtn">' . ($forced ? 'Salva la nuova password' : 'Cambia password') . '</button>'
    . ($problems ? '<div class="err">' . auth_h(implode(' ', $problems)) . '</div>' : '')
    . '</form>'
    . '<style>.rules{list-style:none;padding:0;margin:14px 0 0;font-size:12.5px;line-height:1.8}'
    . '.rules li::before{content:"○ ";color:var(--muted)}.rules li.ok::before{content:"✓ ";color:#2e7d32}'
    . '.rules li.ok{color:#2e7d32}#submitBtn:disabled{opacity:.45;cursor:not-allowed}</style>'
    . '<script>(function(){'
    . 'var user=' . json_encode(strtolower($name)) . ',weak=' . json_encode(AUTH_WEAK_WORDS) . ',min=' . AUTH_MIN_PASSWORD_LEN . ';'
    . 'var p1=document.getElementById("pw1"),p2=document.getElementById("pw2"),list=document.getElementById("rules"),btn=document.getElementById("submitBtn");'
    . 'function seq(s){for(var i=0;i+3<s.length;i++){var d=s.charCodeAt(i+1)-s.charCodeAt(i);if(Math.abs(d)===1&&s.charCodeAt(i+2)-s.charCodeAt(i+1)===d&&s.charCodeAt(i+3)-s.charCodeAt(i+2)===d)return true}return false}'
    . 'function rules(v){var l=v.toLowerCase();var c=(/[a-z]/.test(v)?1:0)+(/[A-Z]/.test(v)?1:0)+(/\d/.test(v)?1:0)+(/[^a-zA-Z\d]/.test(v)?1:0);'
    . 'return [["Almeno "+min+" caratteri",v.length>=min],["Almeno tre tra minuscole, maiuscole, numeri e simboli",c>=3],'
    . '["Non contiene il tuo nome utente",l.indexOf(user)<0],["Nessuna parola comune (es. password, qwerty)",!weak.some(function(w){return l.indexOf(w)>=0})],'
    . '["Niente 4 caratteri uguali di fila o sequenze (1234, abcd)",!/(.)\1{3,}/.test(v)&&!seq(l)],["Le due password coincidono",v.length>0&&v===p2.value]]}'
    . 'function render(){var r=rules(p1.value),ok=true;list.innerHTML="";r.forEach(function(x){var li=document.createElement("li");li.textContent=x[0];if(x[1])li.className="ok";else ok=false;list.appendChild(li)});btn.disabled=!ok}'
    . 'p1.addEventListener("input",render);p2.addEventListener("input",render);render();})();</script>';
auth_page($title, $body);
