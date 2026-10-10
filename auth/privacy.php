<?php
// Informativa sulla privacy di Lodestar. Pagina pubblica (vedi gate.php): si apre dal consenso della registrazione.
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/mail-lib.php';

$cfg = mail_config();
$contact = $cfg['from'] ?? '';
$mail = $contact !== '' ? '<a href="mailto:' . auth_h($contact) . '">' . auth_h($contact) . '</a>' : 'l\'amministratore che ti ha invitato';

$body = '<p style="color:var(--muted);font-size:12.5px">Ultimo aggiornamento: ottobre 2026 · Bozza da rivedere prima di aprire il servizio al pubblico.</p>'
. '<h2>Chi tratta i tuoi dati</h2>'
. '<p>Lodestar è un servizio privato di coaching per allenamento e nutrizione, gestito da Salvatore Pirrone (il "gestore"), che decide perché e come trattare i dati. Per qualunque richiesta scrivi a ' . $mail . '.</p>'
. '<h2>Quali dati raccogliamo</h2>'
. '<ul><li><b>Account:</b> indirizzo email e password (conservata solo come impronta cifrata, mai in chiaro).</li>'
. '<li><b>Profilo:</b> sesso, anno di nascita, altezza, obiettivo di peso e preferenze alimentari che inserisci tu o che leggiamo da Garmin e Withings.</li>'
. '<li><b>Dati di salute e allenamento</b> (categorie particolari, art. 9 GDPR), se colleghi i servizi: attività sportive, frequenza cardiaca, VO2max, training readiness, peso, composizione corporea e sonno da Garmin Connect e Withings.</li>'
. '<li><b>Contenuti che scrivi:</b> cosa hai mangiato, ricette, allenamenti, piani di allenamento.</li>'
. '<li><b>Registro tecnico:</b> accessi (data, indirizzo IP, browser) per sicurezza.</li></ul>'
. '<h2>Perché e su quale base</h2>'
. '<p>Per fornirti il servizio: consigli giornalieri, piano di allenamento, pasti, sincronizzazione con i tuoi dispositivi. Per i dati di salute la base è il tuo <b>consenso esplicito</b>, che dai alla registrazione e puoi ritirare in qualsiasi momento.</p>'
. '<h2>Dove stanno i dati e chi li vede</h2>'
. '<ul><li>I dati sono conservati su un server privato del gestore (un NAS), accessibile solo con login. Ognuno vede soltanto i propri dati. L\'amministratore può gestire gli account (ruoli, inviti) ma non usa i tuoi dati di salute per altri scopi.</li>'
. '<li><b>Garmin e Withings:</b> li colleghi tu; di Garmin non conserviamo la password, solo i token di sessione; di Withings il token di autorizzazione.</li>'
. '<li><b>Anthropic (Claude):</b> il testo che scrivi per descrivere pasti, ricette e allenamenti viene inviato all\'API di Claude per essere interpretato (stima di calorie, struttura dell\'allenamento). Non inviamo i tuoi dati di sensori né la tua identità.</li>'
. '<li><b>Posta elettronica:</b> gli inviti e i messaggi di servizio partono tramite un provider di posta (Gmail).</li>'
. '<li>Non vendiamo i tuoi dati e non li usiamo per pubblicità.</li></ul>'
. '<h2>Per quanto tempo</h2>'
. '<p>Finché mantieni l\'account. Se scolleghi Garmin o Withings, i dati di quel servizio vengono cancellati subito. Se chiedi la cancellazione dell\'account, rimuoviamo profilo, dati sincronizzati, diario e piani.</p>'
. '<h2>I tuoi diritti</h2>'
. '<p>Puoi chiedere accesso, copia, rettifica o cancellazione dei tuoi dati, ritirare il consenso e fare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it). Scrivi a ' . $mail . '.</p>'
. '<h2>Importante</h2>'
. '<p>Lodestar offre stime e suggerimenti indicativi: non sostituisce il parere di un medico o di un professionista. In caso di dubbi sulla tua salute, consulta un medico prima di cambiare allenamento o alimentazione.</p>'
. '<p style="margin-top:20px"><a href="javascript:window.close()">Chiudi</a> · <a href="/auth/login.php">Vai all\'accesso</a></p>';

auth_page('Informativa sulla privacy', $body, true);
