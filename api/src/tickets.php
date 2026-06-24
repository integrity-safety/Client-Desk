<?php
// Tickets: requester intake + portal, team triage, and the requester-visible thread.
// Requester-facing status auto-derives from the linked task. Emails go to the
// requester only on completion and on team feedback replies.

function ticket_status_label(string $state, ?string $taskStatus): string {
    if ($state === 'declined') return 'Declined';
    if ($state === 'submitted') return 'Submitted';
    // accepted:
    switch ($taskStatus) {
        case 'inprogress': return 'In progress';
        case 'blocked':    return 'Needs your input';
        case 'done':       return 'Completed';
        default:           return 'Accepted';
    }
}

// ---------- Requester portal ----------

function portal_tickets(array $user): void {
    require_requester($user);
    $uid = (int)$user['id'];
    $s = db()->prepare(
        'SELECT t.id, t.title, t.state, t.created_at, t.requester_read_at, t.requested_date,
                k.status AS task_status, k.due_date AS task_due,
                (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.from_team = 1
                   AND m.created_at > COALESCE(t.requester_read_at, "1970-01-01")) AS unread
         FROM tickets t LEFT JOIN tasks k ON k.id = t.task_id
         WHERE t.requester_id = ? ORDER BY t.updated_at DESC'
    );
    $s->execute([$uid]);
    $tickets = array_map(fn($r) => [
        'id' => (int)$r['id'], 'title' => $r['title'],
        'status' => ticket_status_label($r['state'], $r['task_status']),
        'requestedDate' => $r['requested_date'], 'targetDate' => $r['task_due'],
        'unread' => (int)$r['unread'], 'createdAt' => $r['created_at'],
    ], $s->fetchAll());
    json_out(['tickets' => $tickets]);
}

function portal_ticket_create(array $user): void {
    require_csrf();
    $req = require_requester($user);
    $b = body();
    $title = str_field($b, 'title');
    $body  = str_field($b, 'body');
    $reqDate = norm_date($b['requestedDate'] ?? null);
    if ($title === '') json_out(['error' => 'Please add a short title'], 422);
    $s = db()->prepare(
        'INSERT INTO tickets (workspace_id, client_id, requester_id, title, body, state, requested_date)
         VALUES (?,?,?,?,?, "submitted", ?)'
    );
    $s->execute([$req['workspace_id'], $req['client_id'], $user['id'], $title, $body, $reqDate]);
    json_out(['id' => (int)db()->lastInsertId()], 201);
}

function portal_ticket_get(array $user, int $id): void {
    require_requester($user);
    $t = ticket_if_requester($id, (int)$user['id']);
    if (!$t) json_out(['error' => 'Not found'], 404);
    db()->prepare('UPDATE tickets SET requester_read_at = NOW() WHERE id = ?')->execute([$id]);
    json_out(ticket_detail_payload($t, false));
}

function portal_ticket_reply(array $user, int $id): void {
    require_csrf();
    require_requester($user);
    $t = ticket_if_requester($id, (int)$user['id']);
    if (!$t) json_out(['error' => 'Not found'], 404);
    $body = trim((string)(body()['body'] ?? ''));
    if ($body === '') json_out(['error' => 'Empty message'], 422);
    add_ticket_message($id, (int)$user['id'], false, $body);
    db()->prepare('UPDATE tickets SET requester_read_at = NOW(), updated_at = NOW() WHERE id = ?')->execute([$id]);
    json_out(['ok' => true], 201);
}

// ---------- Team side ----------

function team_tickets(array $user): void {
    $wid = user_workspace_id($user);
    $clientId = isset($_GET['client']) ? (int)$_GET['client'] : 0;
    $sql =
        'SELECT t.id, t.title, t.state, t.created_at, t.client_id, t.team_read_at, t.task_id, t.requested_date,
                c.name AS client_name, u.name AS requester_name, k.status AS task_status, k.due_date AS task_due,
                (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.from_team = 0
                   AND m.created_at > COALESCE(t.team_read_at, "1970-01-01")) AS unread
         FROM tickets t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.requester_id
         LEFT JOIN tasks k ON k.id = t.task_id
         WHERE t.workspace_id = ?';
    $params = [$wid];
    if ($clientId) { $sql .= ' AND t.client_id = ?'; $params[] = $clientId; }
    $sql .= ' ORDER BY (t.state = "submitted") DESC, t.updated_at DESC';
    $s = db()->prepare($sql);
    $s->execute($params);
    $rows = $s->fetchAll();
    $tickets = array_map(fn($r) => [
        'id' => (int)$r['id'], 'title' => $r['title'], 'state' => $r['state'],
        'status' => ticket_status_label($r['state'], $r['task_status']),
        'clientId' => (int)$r['client_id'], 'client' => $r['client_name'],
        'requester' => $r['requester_name'], 'taskId' => $r['task_id'] !== null ? (int)$r['task_id'] : null,
        'requestedDate' => $r['requested_date'], 'targetDate' => $r['task_due'],
        'unread' => (int)$r['unread'], 'createdAt' => $r['created_at'],
    ], $rows);
    $queue = 0;
    foreach ($rows as $r) if ($r['state'] === 'submitted') $queue++;
    json_out(['tickets' => $tickets, 'queue' => $queue]);
}

function team_ticket_get(array $user, int $id): void {
    $wid = user_workspace_id($user);
    $t = ticket_in_workspace($id, $wid);
    if (!$t) json_out(['error' => 'Not found'], 404);
    db()->prepare('UPDATE tickets SET team_read_at = NOW() WHERE id = ?')->execute([$id]);
    json_out(ticket_detail_payload($t, true));
}

function team_ticket_accept(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $t = ticket_in_workspace($id, $wid);
    if (!$t) json_out(['error' => 'Not found'], 404);
    if ($t['state'] !== 'submitted') json_out(['error' => 'Already handled'], 409);

    // Optional target date (defaults to the requester's requested date if provided).
    $b = body();
    $date = array_key_exists('date', $b) ? norm_date($b['date']) : ($t['requested_date'] ?: null);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare(
            'INSERT INTO tasks (workspace_id, client_id, title, detail, status, due_date)
             VALUES (?,?,?,?, "todo", ?)'
        );
        $ins->execute([$wid, $t['client_id'], $t['title'], $t['body'] ?? '', $date]);
        $taskId = (int)$pdo->lastInsertId();
        $pdo->prepare('UPDATE tickets SET state = "accepted", task_id = ? WHERE id = ?')->execute([$taskId, $id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Could not accept ticket'], 500);
    }
    if ($date) {
        notify_requester($t, 'Your request was accepted',
            "Good news — we've accepted your request and set a target completion date.",
            ['extra' => [['Target date', fmt_human_date($date)], ['Status', 'Accepted']], 'cta' => 'View in your portal']);
    }
    json_out(['ok' => true, 'taskId' => $taskId]);
}

// Called from tasks_update when a ticket-linked task's due date changes.
function tickets_on_task_date_change(int $taskId, ?string $newDate): void {
    $s = db()->prepare('SELECT * FROM tickets WHERE task_id = ? AND state = "accepted"');
    $s->execute([$taskId]);
    $t = $s->fetch();
    if (!$t) return;
    if ($newDate) {
        notify_requester($t, 'Your target date was updated',
            'The target completion date for your request has been updated.',
            ['extra' => [['New target date', fmt_human_date($newDate)]], 'cta' => 'View in your portal']);
    } else {
        notify_requester($t, 'Your target date was updated',
            "The target completion date for your request has been cleared for now — we'll confirm a new one soon.",
            ['extra' => [['Target date', 'To be confirmed']], 'cta' => 'View in your portal']);
    }
}

function fmt_human_date(string $d): string {
    $ts = strtotime($d . ' 00:00:00');
    return $ts ? date('F j, Y', $ts) : $d;
}

function team_ticket_decline(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $t = ticket_in_workspace($id, $wid);
    if (!$t) json_out(['error' => 'Not found'], 404);
    db()->prepare('UPDATE tickets SET state = "declined" WHERE id = ? AND workspace_id = ?')->execute([$id, $wid]);
    json_out(['ok' => true]);
}

function team_ticket_reply(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $t = ticket_in_workspace($id, $wid);
    if (!$t) json_out(['error' => 'Not found'], 404);
    $body = trim((string)(body()['body'] ?? ''));
    if ($body === '') json_out(['error' => 'Empty message'], 422);
    add_ticket_message($id, (int)$user['id'], true, $body);
    db()->prepare('UPDATE tickets SET team_read_at = NOW(), updated_at = NOW() WHERE id = ?')->execute([$id]);
    // Email the requester about new feedback, including a short preview of the note.
    $who = $user['name'] ?? 'The team';
    $preview = mb_strlen($body) > 600 ? (mb_substr($body, 0, 600) . '…') : $body;
    notify_requester($t, 'New reply on your request',
        $who . ' replied to your request. Here\'s the latest:',
        ['note' => $preview, 'extra' => [['From', $who]], 'cta' => 'View & reply in your portal']);
    json_out(['ok' => true], 201);
}

// Called from tasks_update when a linked task hits "done".
function tickets_on_task_done(int $taskId): void {
    $s = db()->prepare('SELECT * FROM tickets WHERE task_id = ? AND state = "accepted"');
    $s->execute([$taskId]);
    $t = $s->fetch();
    if (!$t) return;
    notify_requester($t, 'Your request is complete',
        'Your request has been completed — thank you!',
        ['extra' => [['Status', 'Completed'], ['Completed', fmt_human_date(date('Y-m-d'))]], 'cta' => 'View in your portal']);
}

// ---------- Requester management (admin, from a client) ----------

function client_requesters(array $user, int $clientId): void {
    $wid = require_admin($user);
    if (!client_in_workspace($clientId, $wid)) json_out(['error' => 'Unknown client'], 404);
    $s = db()->prepare(
        'SELECT r.id, u.id AS user_id, u.name, u.email FROM requesters r JOIN users u ON u.id = r.user_id
         WHERE r.client_id = ? ORDER BY u.name'
    );
    $s->execute([$clientId]);
    $members = $s->fetchAll();

    $p = db()->prepare(
        'SELECT id, email, token, expires_at FROM invites
         WHERE workspace_id = ? AND client_id = ? AND role = "requester" AND accepted_at IS NULL AND expires_at > NOW()'
    );
    $p->execute([$wid, $clientId]);
    $base = rtrim((app_config()['app_origin'] ?? ''), '/');
    $pending = array_map(fn($r) => ['id' => (int)$r['id'], 'email' => $r['email'],
        'link' => $base . '/?invite=' . $r['token']], $p->fetchAll());

    json_out(['requesters' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'],
    ], $members), 'pending' => $pending]);
}

function client_requester_invite(array $user, int $clientId): void {
    require_csrf();
    $wid = require_admin($user);
    if (!client_in_workspace($clientId, $wid)) json_out(['error' => 'Unknown client'], 404);
    $email = strtolower(str_field(body(), 'email'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['error' => 'Enter a valid email'], 422);

    db()->prepare('DELETE FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL')
        ->execute([$wid, $email]);
    $token = bin2hex(random_bytes(32));
    db()->prepare(
        'INSERT INTO invites (workspace_id, email, role, client_id, token, invited_by, expires_at)
         VALUES (?,?,"requester",?,?,?, DATE_ADD(NOW(), INTERVAL 14 DAY))'
    )->execute([$wid, $email, $clientId, $token, $user['id']]);

    $base = rtrim((app_config()['app_origin'] ?? ''), '/');
    $link = $base . '/?invite=' . $token;
    $cname = ''; $c = db()->prepare('SELECT name FROM clients WHERE id = ?'); $c->execute([$clientId]); $cr = $c->fetch();
    $cname = $cr ? $cr['name'] : workspace_name($wid);
    $sent = send_invite_email($email, $link, $user['name'] ?? '', workspace_name($wid), $wid, 'requester', $cname);
    json_out(['ok' => true, 'link' => $link, 'emailed' => $sent], 201);
}

function requester_remove(array $user, int $requesterId): void {
    require_csrf();
    $wid = require_admin($user);
    $s = db()->prepare('SELECT user_id FROM requesters WHERE id = ? AND workspace_id = ?');
    $s->execute([$requesterId, $wid]);
    $r = $s->fetch();
    if ($r) db()->prepare('DELETE FROM users WHERE id = ?')->execute([(int)$r['user_id']]); // cascades requester
    json_out(['ok' => true]);
}

// ---------- helpers ----------

function ticket_in_workspace(int $id, int $wid): ?array {
    $s = db()->prepare('SELECT * FROM tickets WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    return $s->fetch() ?: null;
}
function ticket_if_requester(int $id, int $uid): ?array {
    $s = db()->prepare('SELECT * FROM tickets WHERE id = ? AND requester_id = ?');
    $s->execute([$id, $uid]);
    return $s->fetch() ?: null;
}
function add_ticket_message(int $ticketId, int $authorId, bool $fromTeam, string $body): void {
    if (mb_strlen($body) > 5000) $body = mb_substr($body, 0, 5000);
    $s = db()->prepare('INSERT INTO ticket_messages (ticket_id, author_id, from_team, body) VALUES (?,?,?,?)');
    $s->execute([$ticketId, $authorId, $fromTeam ? 1 : 0, $body]);
}
function ticket_detail_payload(array $t, bool $teamView): array {
    // Live task status + due date (for the status label and confirmed target).
    $taskStatus = null; $taskDue = null;
    if ($t['task_id']) {
        $k = db()->prepare('SELECT status, due_date FROM tasks WHERE id = ?');
        $k->execute([$t['task_id']]);
        $kr = $k->fetch();
        if ($kr) { $taskStatus = $kr['status']; $taskDue = $kr['due_date']; }
    }
    $m = db()->prepare(
        'SELECT tm.id, tm.from_team, tm.body, tm.created_at, u.name AS author
         FROM ticket_messages tm LEFT JOIN users u ON u.id = tm.author_id
         WHERE tm.ticket_id = ? ORDER BY tm.id ASC'
    );
    $m->execute([$t['id']]);
    $messages = array_map(fn($r) => [
        'id' => (int)$r['id'], 'fromTeam' => (int)$r['from_team'] === 1,
        'author' => $r['author'] ?: 'User', 'body' => $r['body'], 'createdAt' => $r['created_at'],
    ], $m->fetchAll());

    $payload = [
        'id' => (int)$t['id'], 'title' => $t['title'], 'body' => $t['body'] ?? '',
        'status' => ticket_status_label($t['state'], $taskStatus),
        'state' => $t['state'], 'createdAt' => $t['created_at'],
        'requestedDate' => $t['requested_date'] ?? null, 'targetDate' => $taskDue,
        'taskId' => $t['task_id'] !== null ? (int)$t['task_id'] : null,
        'messages' => $messages,
    ];
    if ($teamView) {
        $r = db()->prepare('SELECT name, email FROM users WHERE id = ?');
        $r->execute([$t['requester_id']]);
        $rr = $r->fetch();
        $payload['requester'] = $rr ? ['name' => $rr['name'], 'email' => $rr['email']] : null;
        $payload['clientId'] = (int)$t['client_id'];
    }
    return $payload;
}
function notify_requester(array $ticket, string $subject, string $intro, array $opts = []): void {
    if (empty($ticket['requester_id'])) return;
    $u = db()->prepare('SELECT email FROM users WHERE id = ?');
    $u->execute([$ticket['requester_id']]);
    $row = $u->fetch();
    if (!$row) return;

    $base = rtrim((app_config()['app_origin'] ?? ''), '/');
    $link = $base . '/?ticket=' . (int)$ticket['id']; // deep-links straight to this ticket in the portal

    // Client name for context.
    $clientName = '';
    if (!empty($ticket['client_id'])) {
        $c = db()->prepare('SELECT name FROM clients WHERE id = ?');
        $c->execute([(int)$ticket['client_id']]);
        $cr = $c->fetch();
        $clientName = $cr ? $cr['name'] : '';
    }

    $brand = mail_brand((int)($ticket['workspace_id'] ?? 0));
    $details = array_merge(
        [['Request', $ticket['title']], ['Client', $clientName]],
        $opts['extra'] ?? []
    );

    send_branded($row['email'], $subject, [
        'brand'      => $brand,
        'heading'    => $opts['heading'] ?? $subject,
        'intro'      => $intro,
        'details'    => $details,
        'note'       => $opts['note'] ?? null,
        'ctaUrl'     => $link,
        'ctaLabel'   => $opts['cta'] ?? 'View & reply in your portal',
        'footerNote' => "You're receiving this because you have a request portal with "
                        . ($brand['company'] ?: 'us')
                        . ". To respond, use the button above — replies to this email aren't monitored.",
    ]);
}
