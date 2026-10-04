<?php
require __DIR__ . '/lib.php';
auth_start();
$_SESSION = [];
session_destroy();
header('Location: /auth/login.php');
