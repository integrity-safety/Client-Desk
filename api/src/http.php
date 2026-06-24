<?php
// Request/response helpers shared by all endpoints.

function json_out($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function str_field(array $src, string $key, string $default = ''): string {
    $v = $src[$key] ?? $default;
    return is_string($v) ? trim($v) : $default;
}

// --- Session ---
function start_session(): void {
    $cfg = app_config();
    session_name('cdsess');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => !empty($cfg['secure_cookies']),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function current_user(): ?array {
    $u = $_SESSION['user'] ?? null;
    if (!$u) return null;
    // Honor a global session cutoff (set when a user resets their password):
    // any session issued before that moment is treated as signed out.
    $iat = (int)($_SESSION['iat'] ?? 0);
    $s = db()->prepare('SELECT sessions_valid_after FROM users WHERE id = ?');
    $s->execute([$u['id']]);
    $r = $s->fetch();
    if ($r && (int)$r['sessions_valid_after'] > $iat) {
        $_SESSION = [];
        return null;
    }
    return $u;
}

function require_auth(): array {
    $u = current_user();
    if (!$u) json_out(['error' => 'Not signed in'], 401);
    return $u;
}

// --- CSRF ---
// Token is created on login and returned by /auth/me. The SPA echoes it back
// in the X-CSRF-Token header on every write. Login/register are exempt
// (no session yet) and rely on credentials.
function csrf_token(): string {
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $have = $_SESSION['csrf'] ?? '';
    if (!$have || !hash_equals($have, $sent)) {
        json_out(['error' => 'Bad or missing CSRF token'], 403);
    }
}

// The single workspace this user owns. Non-members (e.g. requesters) are denied
// here, which keeps them out of every team endpoint that scopes by workspace.
function user_workspace_id(array $user): int {
    $stmt = db()->prepare(
        'SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY id LIMIT 1'
    );
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();
    if (!$row) json_out(['error' => 'Not permitted'], 403);
    return (int)$row['workspace_id'];
}

// Requester identity (or null if the user isn't a requester).
function requester_record(array $user): ?array {
    $s = db()->prepare(
        'SELECT r.id, r.workspace_id, r.client_id, c.name AS client_name
         FROM requesters r JOIN clients c ON c.id = r.client_id WHERE r.user_id = ?'
    );
    $s->execute([$user['id']]);
    $r = $s->fetch();
    return $r ?: null;
}

function require_requester(array $user): array {
    $r = requester_record($user);
    if (!$r) json_out(['error' => 'Not permitted'], 403);
    return $r;
}

function is_team_member(array $user): bool {
    $s = db()->prepare('SELECT 1 FROM workspace_members WHERE user_id = ? LIMIT 1');
    $s->execute([$user['id']]);
    return (bool)$s->fetch();
}

// Current user's role in their workspace ('admin' or 'member').
function current_role(array $user): string {
    $wid = user_workspace_id($user);
    $s = db()->prepare('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?');
    $s->execute([$user['id'], $wid]);
    $r = $s->fetch();
    return $r ? $r['role'] : 'member';
}

function require_admin(array $user): int {
    if (current_role($user) !== 'admin') json_out(['error' => 'Admins only'], 403);
    return user_workspace_id($user);
}

function workspace_name(int $wid): string {
    $s = db()->prepare('SELECT name FROM workspaces WHERE id = ?');
    $s->execute([$wid]);
    $r = $s->fetch();
    return $r ? $r['name'] : 'Workspace';
}

function workspace_theme(int $wid): string {
    $s = db()->prepare('SELECT theme FROM workspaces WHERE id = ?');
    $s->execute([$wid]);
    $r = $s->fetch();
    return ($r && $r['theme'] !== null) ? $r['theme'] : '';
}

// All members of a workspace (for assignee pickers and the Team screen).
function workspace_members(int $wid): array {
    $s = db()->prepare(
        'SELECT u.id, u.name, u.email, m.role
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? ORDER BY m.role, u.name'
    );
    $s->execute([$wid]);
    return array_map(fn($r) => [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'role' => $r['role'],
    ], $s->fetchAll());
}
