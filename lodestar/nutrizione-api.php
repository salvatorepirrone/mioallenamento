<?php
// API della nutrizione di Lodestar. Passa dal gate: serve una sessione valida.
//   GET  ?action=recipes                 la libreria ricette (condivisa)
//   GET  ?action=meals[&days=14]         il mio diario dei pasti
//   POST action=parse_recipe  {text}     ricetta scritta a parole -> scheda con macro (Claude)
//   POST action=save_recipe   {recipe}   inserisce la ricetta in libreria
//   POST action=delete_recipe {id}       solo chi l'ha inserita, il nutrizionista o un admin
//   POST action=log_meal {text, date?, slot?} | {recipe_id, portion, slot, date?}   registra un pasto (a parole: stima di Claude)
//   POST action=delete_meal   {id}
// Le POST portano il token nell'intestazione X-CSRF.
require_once __DIR__ . '/../auth/nutri-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$name = auth_current_user();
if (!$name) reply(['error' => 'Accesso richiesto'], 401);

$method = $_SERVER['REQUEST_METHOD'];
$action = (string)($_GET['action'] ?? '');
$body = [];
if ($method === 'POST') {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) reply(['error' => 'Richiesta non valida, ricarica la pagina.'], 400);
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) reply(['error' => 'Dati non validi'], 400);
}
$canManage = auth_is_nutritionist($name);

try {
    if ($method === 'GET' && $action === 'recipes') {
        reply(['csrf' => auth_csrf_token(), 'me' => $name, 'can_manage' => $canManage, 'recipes' => nutri_recipes_all()]);
    }

    if ($method === 'GET' && $action === 'meals') {
        $days = max(1, min(60, (int)($_GET['days'] ?? 14)));
        $from = date('Y-m-d', time() - $days * 86400);
        $meals = array_values(array_filter(nutri_read(nutri_meals_file($name)), function ($m) use ($from) { return ($m['date'] ?? '') >= $from; }));
        usort($meals, function ($a, $b) { return strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''); });
        reply(['csrf' => auth_csrf_token(), 'meals' => $meals]);
    }

    if ($method === 'POST' && $action === 'parse_recipe') {
        set_time_limit(120);
        $text = trim((string)($body['text'] ?? ''));
        if ($text === '' || mb_strlen($text) > 4000) reply(['error' => 'Scrivi la ricetta (massimo 4000 caratteri).'], 400);
        $r = nutri_parse_recipe($text);
        auth_log('nutri_parse_recipe', $name, mb_strlen($text) . ' caratteri');
        reply(['recipe' => $r]);
    }

    if ($method === 'POST' && $action === 'save_recipe') {
        $in = $body['recipe'] ?? null;
        if (!is_array($in)) reply(['error' => 'Ricetta mancante.'], 400);
        $rname = nutri_text($in['name'] ?? '', 80);
        if ($rname === '') reply(['error' => 'Dai un nome alla ricetta.'], 400);
        $ings = nutri_clean_items($in['ingredients'] ?? [], true);
        if (!$ings) reply(['error' => 'Servono gli ingredienti.'], 400);
        $recipe = [
            'id' => bin2hex(random_bytes(6)), 'name' => $rname,
            'category' => in_array($in['category'] ?? '', NUTRI_CATEGORIES, true) ? $in['category'] : 'uova',
            'meal' => in_array($in['meal'] ?? '', NUTRI_MEALS, true) ? $in['meal'] : 'entrambi',
            'time_min' => nutri_num($in['time_min'] ?? 30, 1, 600),
            'kcal' => nutri_num($in['kcal'] ?? 0, 50, 3000), 'protein' => nutri_num($in['protein'] ?? 0, 0, 300),
            'carbs' => nutri_num($in['carbs'] ?? 0, 0, 600), 'fat' => nutri_num($in['fat'] ?? 0, 0, 300),
            'ingredients' => array_map(function ($i) { return ['name' => $i['name'], 'grams' => $i['grams']]; }, $ings),
            'steps' => nutri_text($in['steps'] ?? '', 600), 'added_by' => $name, 'created_at' => date('Y-m-d H:i:s'),
        ];
        nutri_recipes_all(); // assicura il caricamento delle ricette di partenza prima di aggiungere
        nutri_update(nutri_recipes_file(), function ($all) use ($recipe) { $all[] = $recipe; return $all; });
        auth_log('nutri_recipe_add', '', $recipe['name'] . ' da ' . $name);
        reply(['ok' => true, 'recipe' => $recipe]);
    }

    if ($method === 'POST' && $action === 'delete_recipe') {
        $id = (string)($body['id'] ?? '');
        $found = false;
        nutri_update(nutri_recipes_file(), function ($all) use ($id, $name, $canManage, &$found) {
            return array_values(array_filter($all, function ($r) use ($id, $name, $canManage, &$found) {
                if (($r['id'] ?? '') === $id && ($canManage || ($r['added_by'] ?? '') === $name)) { $found = true; return false; }
                return true;
            }));
        });
        if (!$found) reply(['error' => 'Ricetta non trovata o non eliminabile da te.'], 404);
        auth_log('nutri_recipe_delete', '', $id . ' da ' . $name);
        reply(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'log_meal') {
        $date = $body['date'] ?? date('Y-m-d');
        if (!nutri_valid_date($date)) reply(['error' => 'Data non valida.'], 400);
        $entry = ['id' => bin2hex(random_bytes(6)), 'date' => $date, 'created_at' => date('Y-m-d H:i:s')];
        if (!empty($body['recipe_id'])) {
            $recipe = null;
            foreach (nutri_recipes_all() as $r) if (($r['id'] ?? '') === $body['recipe_id']) $recipe = $r;
            if (!$recipe) reply(['error' => 'Ricetta non trovata.'], 404);
            $portion = max(0.25, min(3.0, (float)($body['portion'] ?? 1)));
            $slot = in_array($body['slot'] ?? '', NUTRI_SLOTS, true) ? $body['slot'] : 'pranzo';
            $entry += ['slot' => $slot, 'summary' => $recipe['name'] . ($portion != 1.0 ? ' (x' . rtrim(rtrim(number_format($portion, 2, '.', ''), '0'), '.') . ')' : ''),
                       'source' => 'recipe', 'recipe_id' => $recipe['id'], 'category' => $recipe['category'],
                       'kcal' => (int)round($recipe['kcal'] * $portion), 'protein' => (int)round($recipe['protein'] * $portion),
                       'carbs' => (int)round($recipe['carbs'] * $portion), 'fat' => (int)round($recipe['fat'] * $portion)];
        } else {
            set_time_limit(120);
            $text = trim((string)($body['text'] ?? ''));
            if ($text === '' || mb_strlen($text) > 1500) reply(['error' => 'Scrivi cosa hai mangiato (massimo 1500 caratteri).'], 400);
            $est = nutri_estimate_meal($text);
            $slot = in_array($body['slot'] ?? '', NUTRI_SLOTS, true) ? $body['slot'] : $est['slot'];
            $entry += ['slot' => $slot, 'text' => nutri_text($text, 1500), 'summary' => $est['summary'], 'source' => 'ai', 'items' => $est['items'],
                       'kcal' => $est['kcal'], 'protein' => $est['protein'], 'carbs' => $est['carbs'], 'fat' => $est['fat']];
        }
        nutri_update(nutri_meals_file($name), function ($all) use ($entry) {
            $all[] = $entry;
            $from = date('Y-m-d', time() - 120 * 86400);
            return array_values(array_filter($all, function ($m) use ($from) { return ($m['date'] ?? '') >= $from; }));
        });
        auth_log('nutri_meal_add', $name, $entry['summary'] . ' ' . $entry['kcal'] . ' kcal');
        reply(['ok' => true, 'meal' => $entry]);
    }

    if ($method === 'POST' && $action === 'delete_meal') {
        $id = (string)($body['id'] ?? '');
        $found = false;
        nutri_update(nutri_meals_file($name), function ($all) use ($id, &$found) {
            return array_values(array_filter($all, function ($m) use ($id, &$found) {
                if (($m['id'] ?? '') === $id) { $found = true; return false; }
                return true;
            }));
        });
        if (!$found) reply(['error' => 'Pasto non trovato.'], 404);
        reply(['ok' => true]);
    }

    reply(['error' => 'Richiesta non valida'], 400);
} catch (RuntimeException $e) {
    reply(['error' => $e->getMessage()], 502);
} catch (Throwable $e) {
    reply(['error' => 'Errore interno'], 500);
}
