# Accesso con utenti (login + cambio password)

Gli utenti stanno in `/volume2/web/auth-data/users.json` sul NAS (non nel repo;
override con la variabile `AUTH_USERS_FILE`): solo hash bcrypt. La cartella è
scrivibile dall'utente `http` (ACL) e chiusa al web da nginx (`deny all`).

## Creare un utente (sul NAS)

    php auth/create-user.php matteo

Stampa una password temporanea. Al primo accesso Matteo viene portato a
`/auth/cambia-password.php` e non può usare il sito finché non la cambia
(minimo 10 caratteri). Può cambiarla di nuovo in qualsiasi momento dalla stessa pagina.
Per resettare la password di un utente basta rilanciare lo stesso comando.

## Proteggere il sito (nginx)

Le pagine HTML sono servite direttamente da nginx, quindi il login va agganciato lì
con `auth_request` al posto di `auth_basic` (adatta i percorsi/socket PHP al NAS):

    location = /auth/check.php { internal; fastcgi_pass ...; include fastcgi_params;
                                 fastcgi_param SCRIPT_FILENAME $document_root/auth/check.php;
                                 fastcgi_pass_request_body off; fastcgi_param CONTENT_LENGTH ""; }
    location /auth/ { auth_basic off; auth_request off; }   # login/cambio password raggiungibili
    location / {
        auth_request /auth/check.php;
        error_page 401 = @login;
    }
    location @login { return 302 /auth/login.php?next=$request_uri; }

Finché `auth_basic` resta attivo sull'intero sito, Matteo dovrà anche inserire la
password HTTP condivisa: va tolto (anche da `refresh-sync.php`, che ora sarebbe protetto
dal login di sessione) solo dopo aver verificato che `auth_request` funzioni.
