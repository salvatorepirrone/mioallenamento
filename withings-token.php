<?php
// Sostituisce la funzione Netlify withings-token.js: stesso identico compito
// (scambio/refresh del token OAuth Withings), ma eseguito sul NAS invece che
// su Netlify. Il client secret vive solo qui, lato server (mai visto dal
// browser) -- questo file va eseguito da PHP (Web Station), non servito
// come testo statico.

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

$CLIENT_ID     = '3fbf541859fb9995d2e1ea7e89754aafc8375d2e6af6cc20846de2db87a91445';
$CLIENT_SECRET = 'REPLACE_WITH_WITHINGS_CLIENT_SECRET';
$REDIRECT_URI  = 'https://pirrone.direct.quickconnect.to/callback.html';

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

$params = [
    'action'        => 'requesttoken',
    'client_id'     => $CLIENT_ID,
    'client_secret' => $CLIENT_SECRET,
    'redirect_uri'  => $REDIRECT_URI,
];

if (($input['grant_type'] ?? '') === 'refresh_token') {
    $params['grant_type']    = 'refresh_token';
    $params['refresh_token'] = $input['refresh_token'] ?? '';
} else {
    $params['grant_type'] = 'authorization_code';
    $params['code']       = $input['code'] ?? '';
}

$ch = curl_init('https://wbsapi.withings.net/v2/oauth2');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
$response = curl_exec($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(['error' => curl_error($ch)]);
    curl_close($ch);
    exit;
}

curl_close($ch);
echo $response;
