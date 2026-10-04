# Accesso con utenti (login + cambio password)

Gli utenti stanno in `/volume2/web/auth-data/users.json` sul NAS (non nel repo;
override con la variabile `AUTH_USERS_FILE`): solo hash bcrypt. La cartella è
scrivibile dall'utente `http` (ACL) e chiusa al web da nginx (`deny all`).

## Creare un utente (sul NAS)

    php auth/create-user.php matteo

Stampa una password temporanea. Al primo accesso l'utente viene portato a
`/auth/cambia-password.php` e non può usare il sito finché non sceglie una nuova
password (almeno 10 caratteri, con controlli di robustezza).
Per resettare la password di un utente basta rilanciare lo stesso comando.

## Come protegge il sito

Il nginx del NAS non ha il modulo `auth_request`, quindi ogni richiesta passa da
`auth/gate.php`: senza sessione valida rimanda a `/auth/login.php`, con sessione valida
serve il file (statici via `X-Accel-Redirect` verso `/_protected/`, `.php` eseguiti dal gate).

La configurazione nginx (file incluso da Web Station come
`/usr/local/etc/nginx/conf.d/.webstation.error_page.default.conf.protect`) sta in
`nginx-auth/protect-gate.conf` nella home dell'utente `Claude` sul NAS: contiene
`deny` su `/auth-data/`, le pagine di login esenti, `/style.css` esente, la location
interna `/_protected/` e i `rewrite` verso `gate.php`.
