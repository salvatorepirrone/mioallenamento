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

La password temporanea resta salvata in chiaro in `users.json` (campo `temp_pw`) solo
finché l'utente non ne sceglie una propria, così la pagina `/accessi.php` può mostrarla
agli amministratori; al cambio password il campo viene cancellato.

## Coach: allenamenti in linguaggio naturale

Un utente con il ruolo "coach" (pulsante "Rendi coach" in `/accessi.php`, o casella alla creazione
dell'utente) scrive su `/libreria.php` un allenamento di nuoto in italiano; `auth/coach-lib.php` lo fa
strutturare a Claude (API Anthropic, modello `COACH_MODEL`), valida il risultato e calcola i totali, e il
programma entra nella libreria (data di assegnazione facoltativa). Solo i coach inseriscono, assegnano ed
eliminano programmi; tutti vedono la libreria. L'atleta (`COACH_DEFAULT_ATHLETE`, titolare della sessione
Garmin) li invia all'orologio: `garmin-sync/send_workout.py` li crea su Garmin Connect e, con una data, li
mette in calendario. La chiave API sta in `auth-data/anthropic.key` (mai nel repo); i programmi in
`auth-data/coach.json`.

## Come protegge il sito

Il nginx del NAS non ha il modulo `auth_request`, quindi ogni richiesta passa da
`auth/gate.php`: senza sessione valida rimanda a `/auth/login.php`, con sessione valida
serve il file (statici via `X-Accel-Redirect` verso `/_protected/`, `.php` eseguiti dal gate).

La configurazione nginx (file incluso da Web Station come
`/usr/local/etc/nginx/conf.d/.webstation.error_page.default.conf.protect`) sta in
`nginx-auth/protect-gate.conf` nella home dell'utente `Claude` sul NAS: contiene
`deny` su `/auth-data/`, le pagine di login esenti, `/style.css` esente, la location
interna `/_protected/` e i `rewrite` verso `gate.php`.
