<?php
// API della libreria degli allenamenti del coach. Passa dal gate: serve una sessione valida.
//   GET  ?action=library     (tutti)   i programmi in libreria
//   GET  ?action=mine        (atleta)  i programmi assegnati a me per un giorno, da due giorni fa in poi
//   POST action=parse        (coach)   {text}                        -> struttura letta da Claude
//   POST action=save         (coach)   {text, parsed, date?}         -> inserisce in libreria (data facoltativa)
//   POST action=assign       (coach)   {id, date|null}               -> assegna o toglie la data
//   POST action=delete       (coach)   {id}
//   POST action=send         (atleta)  {id, date?}                   -> crea l'allenamento su Garmin (e lo pianifica)
//   POST action=send_plan    (atleta)  {plan, date?}                 -> invia a Garmin il consiglio del giorno (corsa o nuoto)
// Solo i coach inseriscono, assegnano ed eliminano programmi. L'invio all'orologio e' riservato a chi
// ha collegato il proprio account Garmin (pagina Collegamenti). Le POST portano il token nell'intestazione X-CSRF.
require_once __DIR__ . '/auth/coach-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function valid_date($d): bool {
    return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4));
}

$name = auth_current_user();
if (!$name) reply(['error' => 'Accesso richiesto'], 401);

$isCoach = auth_is_coach($name) || auth_is_admin($name);
$canSend = udata_connected($name)['garmin'];   // chi ha collegato Garmin invia al proprio orologio
$method = $_SERVER['REQUEST_METHOD'];
$action = (string)($_GET['action'] ?? '');
$body = [];

if ($method === 'POST') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) reply(['error' => 'Dati non validi'], 400);
}

// Vista di un programma per chi lo guarda: ognuno vede le proprie assegnazioni e i propri invii; i coach vedono tutte le assegnazioni.
function publicView(array $w, string $viewer = '', bool $viewerIsCoach = false): array {
    $assign = coach_assignments($w);
    $mineA = array_values(array_filter($assign, function ($a) use ($viewer) { return $a['user'] === $viewer; }));
    $date = $mineA ? $mineA[0]['date'] : ($viewerIsCoach && $assign ? $assign[0]['date'] : null);
    $sends = array_values(array_filter($w['sends'] ?? [], function ($s) use ($viewer) { return ($s['by'] ?? COACH_DEFAULT_ATHLETE) === $viewer; }));
    $sentForDate = false;
    foreach ($sends as $s) if ($date && ($s['date'] ?? null) === $date) $sentForDate = true;
    return ['id' => $w['id'], 'sport' => $w['parsed']['sport'] ?? 'swimming', 'title' => $w['parsed']['title'], 'parsed' => $w['parsed'], 'text' => $w['text'],
            'created_by' => $w['created_by'], 'created_at' => $w['created_at'] ?? null, 'date' => $date,
            'assignments' => $viewerIsCoach ? $assign : $mineA,
            'sends' => array_map(function ($s) { return ['date' => $s['date'] ?? null, 'scheduled' => !empty($s['scheduled']), 'at' => $s['at'] ?? null]; }, $sends),
            'sent_for_date' => $sentForDate];
}

try {
    if ($method === 'GET' && $action === 'library') {
        $all = coach_all();
        usort($all, function ($a, $b) { return strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''); });
        reply(['csrf' => auth_csrf_token(), 'me' => $name, 'is_coach' => $isCoach, 'is_admin' => auth_is_admin($name), 'can_send' => $canSend,
               'athletes' => $isCoach ? coach_athletes() : [],
               'programs' => array_map(function ($w) use ($name, $isCoach) { return publicView($w, $name, $isCoach); }, $all)]);
    }

    if ($method === 'GET' && $action === 'mine') {
        $from = date('Y-m-d', time() - 2 * 86400);
        $mine = [];
        foreach (coach_all() as $w) {
            foreach (coach_assignments($w) as $a) {
                if ($a['user'] === $name && $a['date'] >= $from) $mine[] = ['w' => $w, 'date' => $a['date']];
            }
        }
        usort($mine, function ($a, $b) { return strcmp($a['date'], $b['date']); });
        reply(['csrf' => auth_csrf_token(), 'can_send' => $canSend, 'workouts' => array_map(function ($x) use ($name) {
            $w = $x['w'];
            coach_set_assignment($w, $name, $x['date']);   // la vista mostra la data di questo atleta
            return publicView($w, $name, false);
        }, $mine)]);
    }

    if ($method === 'POST' && $action === 'parse') {
        if (!$isCoach) reply(['error' => 'Solo i coach possono inserire programmi.'], 403);
        set_time_limit(120);
        $text = trim((string)($body['text'] ?? ''));
        if ($text === '' || mb_strlen($text) > 4000) reply(['error' => 'Scrivi il testo dell\'allenamento (massimo 4000 caratteri).'], 400);
        $sport = in_array($body['sport'] ?? 'swimming', ['swimming', 'running', 'strength'], true) ? ($body['sport'] ?? 'swimming') : 'swimming';
        if ($sport === 'running') $parsed = coach_parse_run($text);
        elseif ($sport === 'strength') $parsed = coach_parse_strength($text);
        else { $parsed = coach_validate_parsed(coach_call_claude($text)); $parsed['sport'] = 'swimming'; }
        auth_log('coach_parse', $name, $sport . ' ' . mb_strlen($text) . ' caratteri');
        reply(['parsed' => $parsed]);
    }

    if ($method === 'POST' && $action === 'save') {
        if (!$isCoach) reply(['error' => 'Solo i coach possono inserire programmi.'], 403);
        $text = trim((string)($body['text'] ?? ''));
        $date = $body['date'] ?? null;
        if ($date === '' || $date === null) $date = null;
        elseif (!valid_date($date)) reply(['error' => 'Data non valida.'], 400);
        if ($text === '' || mb_strlen($text) > 4000) reply(['error' => 'Testo mancante.'], 400);
        $sport = in_array($body['parsed']['sport'] ?? 'swimming', ['swimming', 'running', 'strength'], true) ? ($body['parsed']['sport'] ?? 'swimming') : 'swimming';
        $parsed = coach_validate_entry($sport, $body['parsed'] ?? null);
        $athlete = (string)($body['user'] ?? COACH_DEFAULT_ATHLETE);
        $au = $date !== null ? auth_get_user($athlete) : null;
        if ($date !== null && (!$au || !empty($au['disabled']))) reply(['error' => 'Atleta non trovato.'], 400);
        $w = ['id' => bin2hex(random_bytes(6)), 'text' => $text, 'parsed' => $parsed, 'created_by' => $name,
              'created_at' => date('Y-m-d H:i:s'), 'assignments' => $date ? [['user' => $athlete, 'date' => $date]] : [], 'sends' => []];
        coach_update(function ($all) use ($w) { $all[] = $w; return $all; });
        auth_log('coach_library_add', '', $parsed['title'] . ' (' . $sport . ') da ' . $name . ($date ? ' per ' . $athlete . ' il ' . $date : ''));
        reply(['ok' => true, 'program' => publicView($w, $name, true)]);
    }

    if ($method === 'POST' && $action === 'set_category') {
        if (!$isCoach) reply(['error' => 'Solo i coach possono cambiare la categoria.'], 403);
        $id = (string)($body['id'] ?? '');
        $raw = $body['category'] ?? null;
        $found = false; $denied = false; $bad = false;
        coach_update(function ($all) use ($id, $raw, $name, &$found, &$denied, &$bad) {
            foreach ($all as &$w) {
                if ($w['id'] !== $id) continue;
                $found = true;
                if ($w['created_by'] !== $name && !auth_is_admin($name)) { $denied = true; continue; }
                $sport = $w['parsed']['sport'] ?? 'swimming';
                if ($raw === null || $raw === '') { unset($w['parsed']['category']); continue; }   // torna alla categoria dedotta
                $cat = coach_clean_category($sport, $raw);
                if ($cat === null) { $bad = true; continue; }
                $w['parsed']['category'] = $cat;
            }
            unset($w);
            return $all;
        });
        if (!$found) reply(['error' => 'Programma non trovato.'], 404);
        if ($denied) reply(['error' => 'Puoi cambiare la categoria solo dei programmi inseriti da te.'], 403);
        if ($bad) reply(['error' => 'Categoria non valida.'], 400);
        auth_log('coach_category', '', $id . ' da ' . $name);
        reply(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'assign') {
        if (!$isCoach) reply(['error' => 'Solo i coach possono assegnare programmi.'], 403);
        $id = (string)($body['id'] ?? '');
        $date = $body['date'] ?? null;
        if ($date === '' || $date === null) $date = null;
        elseif (!valid_date($date)) reply(['error' => 'Data non valida.'], 400);
        $athlete = (string)($body['user'] ?? COACH_DEFAULT_ATHLETE);
        $au = auth_get_user($athlete);
        if (!$au || (!empty($au['disabled']) && $date !== null)) reply(['error' => 'Atleta non trovato.'], 400);
        $found = false;
        coach_update(function ($all) use ($id, $date, $athlete, &$found) {
            foreach ($all as &$w) if ($w['id'] === $id) { coach_set_assignment($w, $athlete, $date); $found = true; }
            unset($w);
            return $all;
        });
        if (!$found) reply(['error' => 'Programma non trovato.'], 404);
        auth_log('coach_assigned', $athlete, $id . ' ' . ($date ? 'per il ' . $date : 'assegnazione tolta') . ' da ' . $name);
        reply(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'delete') {
        if (!$isCoach) reply(['error' => 'Solo i coach possono eliminare programmi.'], 403);
        $id = (string)($body['id'] ?? '');
        $found = false;
        coach_update(function ($all) use ($id, $name, &$found) {
            return array_values(array_filter($all, function ($w) use ($id, $name, &$found) {
                if ($w['id'] === $id && $w['created_by'] === $name) { $found = true; return false; }
                return true;
            }));
        });
        if (!$found) reply(['error' => 'Programma non trovato (si eliminano solo quelli inseriti da te).'], 404);
        auth_log('coach_deleted', '', $id . ' da ' . $name);
        reply(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'send') {
        if (!$canSend) reply(['error' => 'Per inviare all\'orologio collega prima Garmin dalla pagina Collegamenti.'], 403);
        set_time_limit(120);
        $id = (string)($body['id'] ?? '');
        $date = $body['date'] ?? null;
        if ($date === '' || $date === null) $date = null;
        elseif (!valid_date($date)) reply(['error' => 'Data non valida.'], 400);

        // Si "prenota" l'invio sotto lock: un doppio clic non crea due allenamenti su Garmin.
        $target = null;
        $exists = false;
        coach_update(function ($all) use ($id, &$target, &$exists) {
            foreach ($all as &$w) {
                if ($w['id'] !== $id) continue;
                $exists = true;
                if (time() - (int)($w['sending_at'] ?? 0) > 120) { $w['sending_at'] = time(); $target = $w; }
            }
            unset($w);
            return $all;
        });
        if (!$exists) reply(['error' => 'Programma non trovato.'], 404);
        if (!$target) reply(['error' => 'Invio già in corso, attendi qualche secondo.'], 409);
        $target['date'] = $date;
        try {
            $res = coach_send_to_garmin($target, $name);
        } catch (Throwable $e) {
            coach_update(function ($all) use ($id) { foreach ($all as &$w) if ($w['id'] === $id) unset($w['sending_at']); unset($w); return $all; });
            throw $e;
        }
        coach_update(function ($all) use ($id, $res, $date, $name) {
            foreach ($all as &$w) if ($w['id'] === $id) {
                unset($w['sending_at']);
                $w['sends'][] = ['by' => $name, 'date' => $date, 'garmin_id' => $res['garmin_id'], 'scheduled' => !empty($res['scheduled']), 'at' => date('Y-m-d H:i:s')];
            }
            unset($w);
            return $all;
        });
        auth_log('coach_sent', $name, $id . ' -> Garmin ' . $res['garmin_id'] . ($date ? ' (calendario ' . $date . ')' : ' (solo libreria Garmin)'));
        reply(['ok' => true, 'garmin_id' => $res['garmin_id'], 'scheduled' => !empty($res['scheduled'])]);
    }

    if ($method === 'POST' && $action === 'send_plan') {
        if (!$canSend) reply(['error' => 'Per inviare all\'orologio collega prima Garmin dalla pagina Collegamenti.'], 403);
        set_time_limit(120);
        $date = $body['date'] ?? null;
        if ($date === '' || $date === null) $date = null;
        elseif (!valid_date($date)) reply(['error' => 'Data non valida.'], 400);
        $plan = is_array($body['plan'] ?? null) ? $body['plan'] : [];
        // Stesso piano e stessa data entro un minuto: probabile doppio clic, non si duplica su Garmin.
        $fingerprint = sha1(json_encode([$plan, $date]));
        if (($_SESSION['last_plan'] ?? '') === $fingerprint && time() - (int)($_SESSION['last_plan_at'] ?? 0) < 60) {
            reply(['error' => 'Questo allenamento è già stato inviato un momento fa.'], 409);
        }
        $res = coach_send_plan($plan, $date, $name);
        $_SESSION['last_plan'] = $fingerprint;
        $_SESSION['last_plan_at'] = time();
        auth_log('plan_sent', $name, ($plan['sport'] ?? '?') . ' -> Garmin ' . $res['garmin_id'] . ($date ? ' (calendario ' . $date . ')' : ''));
        reply(['ok' => true, 'garmin_id' => $res['garmin_id'], 'scheduled' => !empty($res['scheduled'])]);
    }

    reply(['error' => 'Azione non riconosciuta'], 404);
} catch (InvalidArgumentException $e) {
    reply(['error' => $e->getMessage()], 422);
} catch (Throwable $e) {
    reply(['error' => $e->getMessage()], 502);
}
