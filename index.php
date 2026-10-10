<?php
// Ingresso del sito: porta ognuno nell'app a cui e' abilitato (Lodestar per chi si registra da solo, il sito classico per chi lo e' stato dall'admin).
require_once __DIR__ . '/auth/lib.php';
$apps = auth_apps_of(auth_current_user());
header('Cache-Control: no-store');
header('Location: ' . (in_array('lodestar', $apps, true) ? '/lodestar/' : (in_array('pianoallenamento', $apps, true) ? '/pianoallenamento/' : '/auth/login.php')));
