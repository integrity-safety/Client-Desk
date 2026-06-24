<?php
// Team: view members + invites; admins can invite, change roles, remove people.

function team_overview(array $user): void {
    $wid = user_workspace_id($user);
    $role = current_role($user);
    $out = [
        'role'    => $role,
        'me'      => (int)$user['id'],
        'members' => workspace_members($wid),
    ];
    if ($role === 'admin') {
        $s = db()->prepare(
            'SELECT id, email, role, created_at, expires_at, token
             FROM invites WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > NOW()
               AND role IN ("admin","member")
             ORDER BY created_at DESC'
        );
        $s->execute([$wid]);
        $cfg = app_config();
        $base = rtrim($cfg['app_origin'] ?? '', '/');
        $out['invites'] = array_map(fn($r) => [
            'id' => (int)$r['id'], 'email' => $r['email'], 'role' => $r['role'],
            'expires_at' => $r['expires_at'],
            'link' => $base . '/?invite=' . $r['token'],
        ], $s->fetchAll());
    }
    json_out($out);
}

function team_invite(array $user): void {
    require_csrf();
    $wid = require_admin($user);
    $b = body();
    $email = strtolower(str_field($b, 'email'));
    $role  = in_array(($b['role'] ?? 'member'), ['admin', 'member'], true) ? $b['role'] : 'member';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['error' => 'Enter a valid email'], 422);

    // Already a member?
    $s = db()->prepare(
        'SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND u.email = ?'
    );
    $s->execute([$wid, $email]);
    if ($s->fetch()) json_out(['error' => 'That person is already on the team'], 409);

    // Replace any prior pending invite for this email.
    $d = db()->prepare('DELETE FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL');
    $d->execute([$wid, $email]);

    $token = bin2hex(random_bytes(32));
    $ins = db()->prepare(
        'INSERT INTO invites (workspace_id, email, role, token, invited_by, expires_at)
         VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 7 DAY))'
    );
    $ins->execute([$wid, $email, $role, $token, $user['id']]);

    $base = rtrim((app_config()['app_origin'] ?? ''), '/');
    $link = $base . '/?invite=' . $token;
    $sent = send_invite_email($email, $link, $user['name'] ?? '', workspace_name($wid), $wid, 'team');

    json_out(['ok' => true, 'link' => $link, 'emailed' => $sent], 201);
}

function team_revoke_invite(array $user, int $inviteId): void {
    require_csrf();
    $wid = require_admin($user);
    $s = db()->prepare('DELETE FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL');
    $s->execute([$inviteId, $wid]);
    json_out(['ok' => true]);
}

function team_set_role(array $user, int $memberId): void {
    require_csrf();
    $wid = require_admin($user);
    $b = body();
    $role = in_array(($b['role'] ?? ''), ['admin', 'member'], true) ? $b['role'] : null;
    if (!$role) json_out(['error' => 'Invalid role'], 422);

    // Don't allow removing the last admin (e.g. demoting yourself).
    if ($role === 'member' && (int)$memberId === (int)$user['id'] && admin_count($wid) <= 1) {
        json_out(['error' => "You're the only admin — promote someone else first"], 409);
    }
    $s = db()->prepare('UPDATE workspace_members SET role = ? WHERE user_id = ? AND workspace_id = ?');
    $s->execute([$role, $memberId, $wid]);
    json_out(['ok' => true]);
}

function team_remove(array $user, int $memberId): void {
    require_csrf();
    $wid = require_admin($user);
    if ((int)$memberId === (int)$user['id']) json_out(['error' => "You can't remove yourself"], 409);
    // Their tasks become unassigned (FK ON DELETE SET NULL keeps the tasks).
    $s = db()->prepare('DELETE FROM workspace_members WHERE user_id = ? AND workspace_id = ?');
    $s->execute([$memberId, $wid]);
    // Also delete the user account itself (single-workspace app).
    $d = db()->prepare('DELETE FROM users WHERE id = ?');
    $d->execute([$memberId]);
    json_out(['ok' => true]);
}

function admin_count(int $wid): int {
    $s = db()->prepare('SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ? AND role = "admin"');
    $s->execute([$wid]);
    return (int)$s->fetch()['c'];
}

// POST /team/theme  {preset, accent}  — admin sets the workspace-wide theme.
function team_set_theme(array $user): void {
    require_csrf();
    $wid = require_admin($user);
    $b = body();
    $preset = preg_replace('/[^a-z0-9_-]/', '', strtolower((string)($b['preset'] ?? 'pine')));
    $accent = (string)($b['accent'] ?? '');
    // Validate accent as a hex color if provided.
    if ($accent !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $accent)) $accent = '';
    $theme = json_encode(['preset' => $preset ?: 'pine', 'accent' => $accent]);
    $s = db()->prepare('UPDATE workspaces SET theme = ? WHERE id = ?');
    $s->execute([$theme, $wid]);
    json_out(['ok' => true, 'theme' => $theme]);
}

// POST /team/member/{id}/reset  — admin generates a password-reset link for a
// teammate (emailed to them, and returned as a copy-link backup like invites).
function team_member_reset(array $user, int $memberId): void {
    require_csrf();
    $wid = require_admin($user);
    $s = db()->prepare(
        'SELECT u.id, u.email, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.user_id = ? AND m.workspace_id = ?'
    );
    $s->execute([$memberId, $wid]);
    $m = $s->fetch();
    if (!$m) json_out(['error' => 'Unknown member'], 404);
    $link = create_password_reset((int)$m['id'], (int)$user['id']);
    $sent = send_password_reset_email($m['email'], $link, $user['name'] ?? '', $wid);
    json_out(['ok' => true, 'link' => $link, 'emailed' => $sent]);
}
