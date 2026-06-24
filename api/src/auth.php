<?php
// Auth: register (first user only / bootstrap), login, logout, me.

function auth_user_count(): int {
    return (int)db()->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
}

// POST /auth/register  — allowed only when there are no users yet (bootstraps you
// as the first admin and creates your workspace). After that it's disabled;
// adding teammates comes in Phase 2.
function auth_register(): void {
    if (auth_user_count() > 0) {
        json_out(['error' => 'Registration is closed. An account already exists.'], 403);
    }
    $b = body();
    $email = strtolower(str_field($b, 'email'));
    $pass  = (string)($b['password'] ?? '');
    $name  = str_field($b, 'name');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['error' => 'Enter a valid email'], 422);
    if (strlen($pass) < 8) json_out(['error' => 'Password must be at least 8 characters'], 422);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $h = password_hash($pass, PASSWORD_DEFAULT);
        $s = $pdo->prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)');
        $s->execute([$email, $h, $name]);
        $uid = (int)$pdo->lastInsertId();

        $s = $pdo->prepare('INSERT INTO workspaces (name) VALUES (?)');
        $s->execute([$name !== '' ? $name . "'s workspace" : 'My workspace']);
        $wid = (int)$pdo->lastInsertId();

        $s = $pdo->prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)');
        $s->execute([$wid, $uid, 'admin']);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Could not create account'], 500);
    }

    $_SESSION['user'] = ['id' => $uid, 'email' => $email, 'name' => $name];
    $_SESSION['iat'] = time();
    json_out(['user' => $_SESSION['user'], 'csrf' => csrf_token()]);
}

// POST /auth/login
function auth_login(): void {
    $b = body();
    $email = strtolower(str_field($b, 'email'));
    $pass  = (string)($b['password'] ?? '');

    $s = db()->prepare('SELECT id, email, password_hash, name FROM users WHERE email = ?');
    $s->execute([$email]);
    $row = $s->fetch();

    // Constant-ish work whether or not the user exists.
    $ok = $row && password_verify($pass, $row['password_hash']);
    if (!$ok) {
        json_out(['error' => 'Email or password is incorrect'], 401);
    }
    session_regenerate_id(true);
    $_SESSION['user'] = ['id' => (int)$row['id'], 'email' => $row['email'], 'name' => $row['name']];
    $_SESSION['iat'] = time();
    json_out(['user' => $_SESSION['user'], 'csrf' => csrf_token()]);
}

// POST /auth/logout
function auth_logout(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    json_out(['ok' => true]);
}

// GET /auth/me  — also tells the SPA whether it needs to show first-run setup.
function auth_me(): void {
    $u = current_user();
    if (!$u) {
        json_out(['user' => null, 'needs_setup' => auth_user_count() === 0]);
    }
    // Requester? Return the portal identity (no workspace/team access).
    $req = requester_record($u);
    if ($req) {
        json_out([
            'user' => $u, 'kind' => 'requester',
            'client' => ['id' => (int)$req['client_id'], 'name' => $req['client_name']],
            'theme' => workspace_theme((int)$req['workspace_id']),
            'csrf' => csrf_token(),
        ]);
    }
    $wid = user_workspace_id($u);
    $u['role'] = current_role($u);
    json_out(['user' => $u, 'kind' => 'team', 'workspace' => workspace_name($wid),
              'theme' => workspace_theme($wid), 'csrf' => csrf_token()]);
}

// GET /auth/invite?token=...  — info for the accept-invite screen.
function auth_invite_info(): void {
    $token = $_GET['token'] ?? '';
    $s = db()->prepare(
        'SELECT i.email, i.role, i.client_id, w.name AS workspace, c.name AS client_name
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id
         LEFT JOIN clients c ON c.id = i.client_id
         WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > NOW()'
    );
    $s->execute([$token]);
    $r = $s->fetch();
    if (!$r) json_out(['valid' => false]);
    json_out(['valid' => true, 'email' => $r['email'], 'role' => $r['role'],
              'workspace' => $r['workspace'], 'client' => $r['client_name']]);
}

// POST /auth/accept-invite  {token, name, password}
function auth_accept_invite(): void {
    $b = body();
    $token = (string)($b['token'] ?? '');
    $name  = str_field($b, 'name');
    $pass  = (string)($b['password'] ?? '');
    if (strlen($pass) < 8) json_out(['error' => 'Password must be at least 8 characters'], 422);

    $pdo = db();
    $s = $pdo->prepare('SELECT * FROM invites WHERE token = ? AND accepted_at IS NULL AND expires_at > NOW()');
    $s->execute([$token]);
    $inv = $s->fetch();
    if (!$inv) json_out(['error' => 'This invitation is invalid or has expired'], 410);

    // Email already registered?
    $chk = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $chk->execute([$inv['email']]);
    if ($chk->fetch()) json_out(['error' => 'An account with this email already exists — please sign in'], 409);

    $pdo->beginTransaction();
    try {
        $h = password_hash($pass, PASSWORD_DEFAULT);
        $i = $pdo->prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)');
        $i->execute([$inv['email'], $h, $name]);
        $uid = (int)$pdo->lastInsertId();

        if ($inv['role'] === 'requester') {
            // External requester tied to one client — NOT a workspace member.
            $r = $pdo->prepare('INSERT INTO requesters (user_id, workspace_id, client_id) VALUES (?,?,?)');
            $r->execute([$uid, $inv['workspace_id'], $inv['client_id']]);
        } else {
            $m = $pdo->prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)');
            $m->execute([$inv['workspace_id'], $uid, $inv['role']]);
        }

        $a = $pdo->prepare('UPDATE invites SET accepted_at = NOW() WHERE id = ?');
        $a->execute([$inv['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Could not complete signup'], 500);
    }

    session_regenerate_id(true);
    $_SESSION['user'] = ['id' => $uid, 'email' => $inv['email'], 'name' => $name];
    $_SESSION['iat'] = time();
    json_out(['user' => $_SESSION['user'], 'csrf' => csrf_token()]);
}

// ---------- Password reset ----------

// Create a one-time, 1-hour reset token for a user and return the reset link.
// Stores only the SHA-256 of the token; the raw token lives only in the link.
function create_password_reset(int $userId, ?int $byId): string {
    db()->prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL')->execute([$userId]);
    $token = bin2hex(random_bytes(32));
    $hash  = hash('sha256', $token);
    db()->prepare(
        'INSERT INTO password_resets (user_id, token_hash, requested_by, expires_at)
         VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL 1 HOUR))'
    )->execute([$userId, $hash, $byId]);
    $base = rtrim((app_config()['app_origin'] ?? ''), '/');
    return $base . '/?reset=' . $token;
}

// Look up a still-valid reset by its raw token; null if missing, used, or expired.
function reset_row_for_token(string $token): ?array {
    if ($token === '') return null;
    $hash = hash('sha256', $token);
    $s = db()->prepare(
        'SELECT pr.id, pr.user_id, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > NOW()'
    );
    $s->execute([$hash]);
    return $s->fetch() ?: null;
}

// POST /auth/forgot {email}  — self-service. Always returns ok (no account
// enumeration); emails a reset link only if the address has an account.
function auth_forgot(): void {
    $email = strtolower(str_field(body(), 'email'));
    if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $s = db()->prepare('SELECT id FROM users WHERE email = ?');
        $s->execute([$email]);
        $u = $s->fetch();
        if ($u) {
            $link = create_password_reset((int)$u['id'], null);
            $wid = 0;
            $wq = db()->prepare(
                'SELECT workspace_id FROM workspace_members WHERE user_id = ?
                 UNION SELECT workspace_id FROM requesters WHERE user_id = ? LIMIT 1'
            );
            $wq->execute([(int)$u['id'], (int)$u['id']]);
            $wr = $wq->fetch();
            if ($wr) $wid = (int)$wr['workspace_id'];
            send_password_reset_email($email, $link, '', $wid);
        }
    }
    json_out(['ok' => true]);
}

// GET /auth/reset?token=...  — info for the set-new-password screen.
function auth_reset_info(): void {
    $r = reset_row_for_token((string)($_GET['token'] ?? ''));
    if (!$r) json_out(['valid' => false]);
    json_out(['valid' => true, 'name' => $r['name'] ?? '']);
}

// POST /auth/reset {token, password}  — set the new password, mark the token used,
// and end the user's other sessions by advancing their session cutoff.
function auth_reset(): void {
    $b = body();
    $token = (string)($b['token'] ?? '');
    $pass  = (string)($b['password'] ?? '');
    if (strlen($pass) < 8) json_out(['error' => 'Password must be at least 8 characters'], 422);
    $r = reset_row_for_token($token);
    if (!$r) json_out(['error' => 'This reset link is invalid or has expired'], 410);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $h = password_hash($pass, PASSWORD_DEFAULT);
        $pdo->prepare('UPDATE users SET password_hash = ?, sessions_valid_after = ? WHERE id = ?')
            ->execute([$h, time(), (int)$r['user_id']]);
        $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?')->execute([(int)$r['id']]);
        $pdo->prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL')->execute([(int)$r['user_id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Could not reset password'], 500);
    }
    json_out(['ok' => true]);
}
