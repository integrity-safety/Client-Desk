<?php
// Chat: per-client channels (whole team) + 1:1 DMs, with per-user unread counts.

// Make sure every client has a channel conversation (lazy, idempotent).
function ensure_client_channels(int $wid): void {
    $s = db()->prepare(
        'SELECT c.id FROM clients c
         LEFT JOIN conversations v ON v.client_id = c.id
         WHERE c.workspace_id = ? AND v.id IS NULL'
    );
    $s->execute([$wid]);
    $missing = $s->fetchAll();
    if (!$missing) return;
    $ins = db()->prepare('INSERT INTO conversations (workspace_id, type, client_id) VALUES (?, "client", ?)');
    foreach ($missing as $row) $ins->execute([$wid, (int)$row['id']]);
}

// GET /conversations  — channels + the user's DMs, each with unread + preview.
function conversations_list(array $user): void {
    $wid = user_workspace_id($user);
    $uid = (int)$user['id'];
    ensure_client_channels($wid);

    // Client channels (visible to everyone).
    $ch = db()->prepare(
        'SELECT v.id, v.type, c.id AS client_id, c.name AS label
         FROM conversations v JOIN clients c ON c.id = v.client_id
         WHERE v.workspace_id = ? AND v.type = "client" ORDER BY c.name'
    );
    $ch->execute([$wid]);
    $channels = array_map(fn($r) => decorate_conv($r, $uid), $ch->fetchAll());

    // DMs the user belongs to; label is the other participant.
    $dm = db()->prepare(
        'SELECT v.id, v.type,
                (SELECT u.name FROM conversation_members m2 JOIN users u ON u.id = m2.user_id
                 WHERE m2.conversation_id = v.id AND m2.user_id <> ? LIMIT 1) AS label,
                (SELECT m3.user_id FROM conversation_members m3
                 WHERE m3.conversation_id = v.id AND m3.user_id <> ? LIMIT 1) AS other_id
         FROM conversations v JOIN conversation_members m ON m.conversation_id = v.id
         WHERE v.workspace_id = ? AND v.type = "dm" AND m.user_id = ?'
    );
    $dm->execute([$uid, $uid, $wid, $uid]);
    $dms = array_map(fn($r) => decorate_conv($r, $uid), $dm->fetchAll());

    $total = 0;
    foreach (array_merge($channels, $dms) as $c) $total += $c['unread'];
    json_out(['channels' => $channels, 'dms' => $dms, 'unreadTotal' => $total]);
}

function decorate_conv(array $r, int $uid): array {
    $cid = (int)$r['id'];
    // last_read for this user
    $lr = db()->prepare('SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?');
    $lr->execute([$cid, $uid]);
    $row = $lr->fetch();
    $lastRead = $row && $row['last_read_at'] ? $row['last_read_at'] : '1970-01-01 00:00:00';

    $u = db()->prepare('SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND author_id <> ? AND created_at > ?');
    $u->execute([$cid, $uid, $lastRead]);
    $unread = (int)$u->fetch()['c'];

    $p = db()->prepare('SELECT body, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1');
    $p->execute([$cid]);
    $last = $p->fetch();

    return [
        'id' => $cid, 'type' => $r['type'],
        'label' => $r['label'] ?: 'Conversation',
        'clientId' => isset($r['client_id']) && $r['client_id'] !== null ? (int)$r['client_id'] : null,
        'unread' => $unread,
        'preview' => $last ? mb_strimwidth($last['body'], 0, 60, '…') : '',
        'lastAt' => $last ? $last['created_at'] : null,
    ];
}

// Visibility: client channels = any member; DMs = participants only.
function conv_for_user(int $convId, array $user): ?array {
    $wid = user_workspace_id($user);
    $s = db()->prepare('SELECT * FROM conversations WHERE id = ? AND workspace_id = ?');
    $s->execute([$convId, $wid]);
    $conv = $s->fetch();
    if (!$conv) return null;
    if ($conv['type'] === 'dm') {
        $m = db()->prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?');
        $m->execute([$convId, $user['id']]);
        if (!$m->fetch()) return null;
    }
    return $conv;
}

// GET /conversations/{id}/messages?after={msgId}
function messages_list(array $user, int $convId): void {
    $conv = conv_for_user($convId, $user);
    if (!$conv) json_out(['error' => 'Conversation not found'], 404);
    $after = isset($_GET['after']) ? (int)$_GET['after'] : 0;
    $s = db()->prepare(
        'SELECT m.id, m.author_id, m.body, m.created_at, u.name AS author
         FROM messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 200'
    );
    $s->execute([$convId, $after]);
    $msgs = array_map(fn($r) => [
        'id' => (int)$r['id'], 'authorId' => $r['author_id'] !== null ? (int)$r['author_id'] : null,
        'author' => $r['author'] ?: 'Removed user', 'body' => $r['body'], 'createdAt' => $r['created_at'],
    ], $s->fetchAll());
    json_out(['messages' => $msgs]);
}

// POST /conversations/{id}/messages  {body}
function messages_send(array $user, int $convId): void {
    require_csrf();
    $conv = conv_for_user($convId, $user);
    if (!$conv) json_out(['error' => 'Conversation not found'], 404);
    $body = trim((string)(body()['body'] ?? ''));
    if ($body === '') json_out(['error' => 'Empty message'], 422);
    if (mb_strlen($body) > 5000) $body = mb_substr($body, 0, 5000);

    $s = db()->prepare('INSERT INTO messages (conversation_id, author_id, body) VALUES (?,?,?)');
    $s->execute([$convId, $user['id'], $body]);
    mark_read($convId, (int)$user['id']);
    json_out(['id' => (int)db()->lastInsertId()], 201);
}

// POST /conversations/{id}/read
function conversation_read(array $user, int $convId): void {
    require_csrf();
    $conv = conv_for_user($convId, $user);
    if (!$conv) json_out(['error' => 'Conversation not found'], 404);
    mark_read($convId, (int)$user['id']);
    json_out(['ok' => true]);
}

function mark_read(int $convId, int $uid): void {
    $s = db()->prepare(
        'INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?,?,NOW())
         ON DUPLICATE KEY UPDATE last_read_at = NOW()'
    );
    $s->execute([$convId, $uid]);
}

// POST /conversations/dm  {userId}  — find or create a 1:1 DM.
function dm_open(array $user): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $uid = (int)$user['id'];
    $other = (int)(body()['userId'] ?? 0);
    if ($other === $uid || $other === 0) json_out(['error' => 'Pick a teammate'], 422);
    // Confirm the other user is in this workspace.
    $m = db()->prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?');
    $m->execute([$wid, $other]);
    if (!$m->fetch()) json_out(['error' => 'Unknown teammate'], 422);

    // Existing DM with exactly these two?
    $f = db()->prepare(
        'SELECT v.id FROM conversations v
         JOIN conversation_members a ON a.conversation_id = v.id AND a.user_id = ?
         JOIN conversation_members b ON b.conversation_id = v.id AND b.user_id = ?
         WHERE v.type = "dm" AND v.workspace_id = ? LIMIT 1'
    );
    $f->execute([$uid, $other, $wid]);
    $existing = $f->fetch();
    if ($existing) { json_out(['id' => (int)$existing['id']]); }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $c = $pdo->prepare('INSERT INTO conversations (workspace_id, type) VALUES (?, "dm")');
        $c->execute([$wid]);
        $cid = (int)$pdo->lastInsertId();
        $mm = $pdo->prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?)');
        $mm->execute([$cid, $uid]);
        $mm->execute([$cid, $other]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Could not start conversation'], 500);
    }
    json_out(['id' => $cid], 201);
}
