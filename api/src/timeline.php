<?php
// Client timeline: manual reminders + notes, plus task markers merged in at read
// time. Team-only — user_workspace_id() 403s requesters, so the portal can't reach
// any of this. Reminders are client-level (the whole team sees a due one in Today).

// Shape a manual entry row for the API.
function timeline_entry_api(array $r): array {
    return [
        'kind'      => $r['kind'],                 // 'reminder' | 'note'
        'id'        => (int)$r['id'],
        'body'      => $r['body'],
        'details'   => $r['details'] ?? null,      // notes only: optional meeting-notes block
        'date'      => $r['entry_date'],
        'done'      => $r['done_at'] !== null,
        'doneAt'    => $r['done_at'],
        'author'    => $r['author_name'] ?? null,
        'createdAt' => $r['created_at'],
    ];
}

// Verify a client belongs to the caller's workspace; returns [workspace_id, client_row].
function timeline_client_or_404(array $user, int $clientId): array {
    $wid = user_workspace_id($user);
    $s = db()->prepare('SELECT id, name FROM clients WHERE id = ? AND workspace_id = ?');
    $s->execute([$clientId, $wid]);
    $c = $s->fetch();
    if (!$c) json_out(['error' => 'Unknown client'], 404);
    return [$wid, $c];
}

// GET /clients/{id}/timeline  — merged, date-sorted feed for one client.
function timeline_list(array $user, int $clientId): void {
    [$wid, $client] = timeline_client_or_404($user, $clientId);

    // Manual entries.
    $e = db()->prepare(
        'SELECT te.*, u.name AS author_name FROM timeline_entries te
         LEFT JOIN users u ON u.id = te.author_id
         WHERE te.client_id = ? ORDER BY te.entry_date DESC, te.id DESC'
    );
    $e->execute([$clientId]);
    $entries = array_map('timeline_entry_api', $e->fetchAll());

    // Task markers: open tasks at their due date; completed tasks at completion date.
    $t = db()->prepare(
        'SELECT t.id, t.title, t.status, t.priority, t.due_date, t.completed_at, t.created_at,
                u.name AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.client_id = ?'
    );
    $t->execute([$clientId]);
    $tasks = [];
    foreach ($t->fetchAll() as $r) {
        if ($r['status'] === 'done') {
            $date = $r['completed_at'] ? substr($r['completed_at'], 0, 10) : substr($r['created_at'], 0, 10);
            $anchor = 'completed';
        } elseif ($r['due_date']) {
            $date = $r['due_date'];
            $anchor = 'due';
        } else {
            $date = substr($r['created_at'], 0, 10);   // undated, still open → when it came in
            $anchor = 'created';
        }
        $tasks[] = [
            'kind'     => 'task',
            'id'       => (int)$r['id'],
            'title'    => $r['title'],
            'status'   => $r['status'],
            'priority' => $r['priority'] ?? 'medium',
            'date'     => $date,
            'anchor'   => $anchor,
            'assignee' => $r['assignee_name'],
        ];
    }

    json_out([
        'client'  => ['id' => (int)$client['id'], 'name' => $client['name']],
        'entries' => $entries,
        'tasks'   => $tasks,
        'today'   => gmdate_local_today(),
    ]);
}

// POST /clients/{id}/timeline  — add a reminder or note.
function timeline_add(array $user, int $clientId): void {
    require_csrf();
    [$wid, $client] = timeline_client_or_404($user, $clientId);
    $b = body();
    $kind = ($b['kind'] ?? 'note') === 'reminder' ? 'reminder' : 'note';
    $bodyText = trim((string)($b['body'] ?? ''));
    if ($bodyText === '') json_out(['error' => 'Write something first'], 422);
    $date = norm_date($b['date'] ?? null) ?? gmdate_local_today();
    $s = db()->prepare(
        'INSERT INTO timeline_entries (workspace_id, client_id, author_id, kind, body, entry_date)
         VALUES (?,?,?,?,?,?)'
    );
    $s->execute([$wid, $clientId, $user['id'], $kind, $bodyText, $date]);
    json_out(['ok' => true, 'id' => (int)db()->lastInsertId()]);
}

// Load an entry and confirm it is in the caller's workspace.
function timeline_entry_or_404(array $user, int $id): array {
    $wid = user_workspace_id($user);
    $s = db()->prepare('SELECT * FROM timeline_entries WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    $r = $s->fetch();
    if (!$r) json_out(['error' => 'Unknown entry'], 404);
    return $r;
}

// PATCH /timeline/{id}  — edit body/date, or complete/reopen a reminder ({done:true|false}).
function timeline_update(array $user, int $id): void {
    require_csrf();
    $cur = timeline_entry_or_404($user, $id);
    $b = body();
    $body = array_key_exists('body', $b) ? trim((string)$b['body']) : $cur['body'];
    if ($body === '') json_out(['error' => 'Write something first'], 422);
    $date = array_key_exists('date', $b) ? (norm_date($b['date']) ?? $cur['entry_date']) : $cur['entry_date'];
    // Free-text block. On notes this is the meeting-notes field; on reminders it's
    // the dismiss note / response. Blank clears it back to NULL.
    if (array_key_exists('details', $b)) {
        $dt = trim((string)$b['details']);
        $details = $dt === '' ? null : $dt;
    } else {
        $details = $cur['details'];
    }
    // Dismiss / reopen a reminder: {done:true} stamps done_at now, {done:false}
    // clears it (back onto Today). Reminders only; notes ignore it. Omitting the
    // key preserves whatever was there, so editing a dismissed reminder's note
    // doesn't un-dismiss it.
    if ($cur['kind'] === 'reminder' && array_key_exists('done', $b)) {
        $doneAt = filter_var($b['done'], FILTER_VALIDATE_BOOLEAN) ? gmdate_local_now() : null;
    } else {
        $doneAt = $cur['done_at'];
    }
    $s = db()->prepare('UPDATE timeline_entries SET body = ?, details = ?, entry_date = ?, done_at = ? WHERE id = ?');
    $s->execute([$body, $details, $date, $doneAt, $id]);
    json_out(['ok' => true]);
}

// DELETE /timeline/{id}
function timeline_delete(array $user, int $id): void {
    require_csrf();
    timeline_entry_or_404($user, $id);
    db()->prepare('DELETE FROM timeline_entries WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
}
