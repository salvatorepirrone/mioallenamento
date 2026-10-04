<?php
require_once __DIR__ . '/lib.php';
auth_start();
if (!empty($_SESSION['user'])) auth_log('logout', $_SESSION['user']);
$_SESSION = [];
session_destroy();
header('Location: /auth/login.php');
