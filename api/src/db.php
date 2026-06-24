<?php
// Single PDO connection, configured for safe defaults.

function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $cfg = require config_path();
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['db_host'], $cfg['db_name']);
    try {
        $pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (Throwable $e) {
        json_out(['error' => 'Database connection failed'], 500);
    }
    return $pdo;
}

// Returns the absolute path to the real config file.
// Override with the API_CONFIG env var; otherwise fall back to a sibling of the repo.
function config_path(): string {
    $env = getenv('API_CONFIG');
    if ($env && is_file($env)) return $env;
    // Fallback: ../../private/config.php relative to this file (adjust on deploy).
    $guess = dirname(__DIR__, 2) . '/private/config.php';
    if (is_file($guess)) return $guess;
    // Last resort: the sample (won't have real creds) — surfaces a clear error.
    return dirname(__DIR__, 2) . '/config/config.sample.php';
}

function app_config(): array {
    static $c = null;
    if ($c === null) $c = require config_path();
    return $c;
}
