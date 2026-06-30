<?php
// Tasks: list (optionally by client) / create / update / status / delete.

const TASK_STATUSES = ['todo', 'inprogress', 'blocked', 'done'];

function task_row_to_api(array $r): array {
    return [
        'id'        => (int)$r['id'],
        'clientId'  => (int)$r['client_id'],
        'title'     => $r['title'],
        'detail'    => $r['detail'] ?? '',
        'notes'     => $r['private_notes'] ?? '',
        'status'    => $r['status'],
        'dueDate'   => $r['due_date'],
        'completedAt' => $r['completed_at'],
        'createdAt' => $r['created_at'],
        'updatedAt' => $r['updated_at'] ?? $r['created_at'],
        'priority'  => $r['priority'] ?? 'medium',
        'estHours'  => isset($r['est_hours']) && $r['est_hours'] !== null ? (int)$r['est_hours'] : null,
        'assigneeId'   => isset($r['assignee_id']) && $r['assignee_id'] !== null ? (int)$r['assignee_id'] : null,
        'assignee'     => $r['assignee_name'] ?? null,
        // Review-with flag: who you want to review this task with (review_with,
        // optional) and who flagged it (review_by). Drives the Reviews tab.
        'reviewWithId' => isset($r['review_with']) && $r['review_with'] !== null ? (int)$r['review_with'] : null,
        'reviewWith'   => $r['review_with_name'] ?? null,
        'reviewById'   => isset($r['review_by']) && $r['review_by'] !== null ? (int)$r['review_by'] : null,
        'reviewBy'     => $r['review_by_name'] ?? null,
        // True when an accepted request was turned into this task. Lets the UI
        // warn that deleting the task will cancel the originating request.
        'fromRequest'  => isset($r['ticket_id']) && $r['ticket_id'] !== null,
        'requester'    => $r['requester_name'] ?? null,
    ];
}

function tasks_list(array $user): void {
    $wid = user_workspace_id($user);
    $clientId = isset($_GET['client']) ? (int)$_GET['client'] : 0;
    $base = 'SELECT t.*, u.name AS assignee_name, tk.id AS ticket_id, ru.name AS requester_name,'
          . ' rw.name AS review_with_name, rb.name AS review_by_name'
          . ' FROM tasks t'
          . ' LEFT JOIN users u ON u.id = t.assignee_id'
          . ' LEFT JOIN tickets tk ON tk.task_id = t.id AND tk.state = "accepted"'
          . ' LEFT JOIN users ru ON ru.id = tk.requester_id'
          . ' LEFT JOIN users rw ON rw.id = t.review_with'
          . ' LEFT JOIN users rb ON rb.id = t.review_by'
          . ' WHERE t.workspace_id = ?';
    if ($clientId) {
        $s = db()->prepare($base . ' AND t.client_id = ? ORDER BY t.created_at DESC');
        $s->execute([$wid, $clientId]);
    } else {
        $s = db()->prepare($base . ' ORDER BY t.created_at DESC');
        $s->execute([$wid]);
    }
    json_out(['tasks' => array_map('task_row_to_api', $s->fetchAll())]);
}

function tasks_create(array $user): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $b = body();
    $clientId = (int)($b['clientId'] ?? 0);
    $title  = str_field($b, 'title');
    $status = in_array(($b['status'] ?? 'todo'), TASK_STATUSES, true) ? $b['status'] : 'todo';
    if ($title === '') json_out(['error' => 'Task title is required'], 422);
    if (!client_in_workspace($clientId, $wid)) json_out(['error' => 'Unknown client'], 422);

    $assignee = normalize_assignee($b['assigneeId'] ?? null, $wid);
    $priority = normalize_priority($b['priority'] ?? null);
    $est = normalize_est_hours($b['estHours'] ?? null);
    // Review flag: who to review with (optional teammate). When set, record the
    // creator as review_by so the Reviews tab knows who flagged it.
    $reviewWith = normalize_member($b['reviewWithId'] ?? null, $wid);
    $reviewBy   = $reviewWith !== null ? ($user['id'] ?? null) : null;
    $completed = $status === 'done' ? gmdate('Y-m-d H:i:s') : null;
    $s = db()->prepare(
        'INSERT INTO tasks (workspace_id, client_id, title, detail, private_notes, status, due_date, completed_at, assignee_id, priority, est_hours, review_with, review_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $s->execute([
        $wid, $clientId, $title,
        str_field($b, 'detail'), str_field($b, 'notes'),
        $status, norm_date($b['dueDate'] ?? null), $completed, $assignee, $priority, $est,
        $reviewWith, $reviewBy,
    ]);
    $newId = (int)db()->lastInsertId();
    log_task_event($wid, $user, 'created', ['id' => $newId, 'client_id' => $clientId, 'title' => $title], null, null);
    json_out(['id' => $newId], 201);
}

function tasks_update(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $cur = task_owned($id, $wid);
    if (!$cur) json_out(['error' => 'Task not found'], 404);

    $b = body();
    $title  = str_field($b, 'title', $cur['title']);
    $status = in_array(($b['status'] ?? $cur['status']), TASK_STATUSES, true) ? ($b['status'] ?? $cur['status']) : $cur['status'];
    if ($title === '') json_out(['error' => 'Task title is required'], 422);

    // completed_at follows status transitions.
    $completed = $cur['completed_at'];
    if ($status === 'done' && $cur['status'] !== 'done') $completed = gmdate('Y-m-d H:i:s');
    if ($status !== 'done') $completed = null;

    $newDue = array_key_exists('dueDate', $b) ? norm_date($b['dueDate']) : $cur['due_date'];
    $newAssignee = array_key_exists('assigneeId', $b) ? normalize_assignee($b['assigneeId'], $wid) : $cur['assignee_id'];
    $newEst = array_key_exists('estHours', $b) ? normalize_est_hours($b['estHours']) : $cur['est_hours'];

    // Review flag. Anyone may place a flag on a task that has none, but once a
    // task is flagged, only the person who flagged it (review_by) may change or
    // clear it — so a normal task edit by someone else never disturbs the flag.
    $newReviewWith = $cur['review_with'];
    $newReviewBy   = $cur['review_by'];
    if (array_key_exists('reviewWithId', $b)) {
        $req       = normalize_member($b['reviewWithId'], $wid);
        $hasFlag   = $cur['review_by'] !== null;
        $isFlagger = $hasFlag && (int)$cur['review_by'] === (int)($user['id'] ?? 0);
        if (!$hasFlag || $isFlagger) {
            $newReviewWith = $req;
            $newReviewBy   = $req !== null ? ($user['id'] ?? null) : null;
        }
        // else: a non-flagger touched the field — leave the existing flag intact.
    }

    $s = db()->prepare(
        'UPDATE tasks SET title=?, detail=?, private_notes=?, status=?, due_date=?, completed_at=?, assignee_id=?, priority=?, est_hours=?, review_with=?, review_by=?
         WHERE id=? AND workspace_id=?'
    );
    $s->execute([
        $title,
        array_key_exists('detail', $b) ? str_field($b, 'detail') : $cur['detail'],
        array_key_exists('notes', $b) ? str_field($b, 'notes') : $cur['private_notes'],
        $status,
        $newDue,
        $completed,
        $newAssignee,
        array_key_exists('priority', $b) ? normalize_priority($b['priority']) : $cur['priority'],
        $newEst,
        $newReviewWith,
        $newReviewBy,
        $id, $wid,
    ]);

    // Activity log: record the meaningful changes for the live feed + Activity page.
    $taskRef = ['id' => $id, 'client_id' => $cur['client_id'], 'title' => $title];
    if ($status !== $cur['status']) {
        log_task_event($wid, $user, 'status', $taskRef, $cur['status'], $status);
    }
    if ((string)$newAssignee !== (string)$cur['assignee_id']) {
        $name = $newAssignee ? assignee_name((int)$newAssignee) : 'Unassigned';
        log_task_event($wid, $user, 'assigned', $taskRef, null, $name);
    }
    if (($newDue ?? null) !== ($cur['due_date'] ?? null)) {
        log_task_event($wid, $user, 'due', $taskRef, $cur['due_date'], $newDue);
    }
    // If this task is linked to a ticket and just got completed, notify the requester.
    if ($status === 'done' && $cur['status'] !== 'done' && function_exists('tickets_on_task_done')) {
        tickets_on_task_done($id);
    }
    // If the due date changed on a ticket-linked task, tell the requester the new target.
    if (($newDue ?? null) !== ($cur['due_date'] ?? null) && function_exists('tickets_on_task_date_change')) {
        tickets_on_task_date_change($id, $newDue);
    }
    json_out(['ok' => true]);
}

function tasks_delete(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $cur = task_owned($id, $wid);
    if ($cur) {
        log_task_event($wid, $user, 'deleted', ['id' => $id, 'client_id' => $cur['client_id'], 'title' => $cur['title']], null, null);
        // If this task came from a request, cancel that request and notify the
        // requester. Done before the delete so the ticket->task link is intact.
        if (function_exists('tickets_on_task_deleted')) {
            tickets_on_task_deleted($id);
        }
    }
    $s = db()->prepare('DELETE FROM tasks WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    json_out(['ok' => true]);
}

// --- helpers ---
function client_in_workspace(int $clientId, int $wid): bool {
    $s = db()->prepare('SELECT 1 FROM clients WHERE id = ? AND workspace_id = ?');
    $s->execute([$clientId, $wid]);
    return (bool)$s->fetch();
}
function task_owned(int $id, int $wid): ?array {
    $s = db()->prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    $r = $s->fetch();
    return $r ?: null;
}
function norm_date($v): ?string {
    if (!is_string($v) || $v === '') return null;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
}
function normalize_priority($v): string {
    return in_array($v, ['high', 'medium', 'low'], true) ? $v : 'medium';
}
// Optional whole-hour estimate. Blank/0/negative -> null (no estimate); minimum 1
// when set; capped so a stray entry can't overflow the column.
function normalize_est_hours($v): ?int {
    if ($v === null || $v === '') return null;
    $n = (int)$v;
    if ($n < 1) return null;
    return min($n, 1000);
}
// Returns a valid member id (as int) or null. Ignores ids not in the workspace.
function normalize_assignee($v, int $wid): ?int {
    if ($v === null || $v === '' || $v === 0 || $v === '0') return null;
    $id = (int)$v;
    $s = db()->prepare('SELECT 1 FROM workspace_members WHERE user_id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    return $s->fetch() ? $id : null;
}
function assignee_name(int $uid): string {
    $s = db()->prepare('SELECT name, email FROM users WHERE id = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    if (!$r) return 'Someone';
    return ($r['name'] !== null && $r['name'] !== '') ? $r['name'] : $r['email'];
}
// Same validation as normalize_assignee (must be a member of this workspace),
// named for the review-with picker so the intent reads clearly at call sites.
function normalize_member($v, int $wid): ?int {
    return normalize_assignee($v, $wid);
}

// --- Reviews tab (review-with) ---

// One review item = the full task shape (so the edit modal has every field) plus
// the client name for display.
function review_item(array $r): array {
    $t = task_row_to_api($r);
    $t['clientName'] = $r['client_name'] ?? null;
    return $t;
}

// Group already-ordered rows into [{groupId, groupName, tasks:[]}], keyed by the
// given id/name columns. Preserves row order, so the SQL ORDER BY controls layout.
function group_reviews(array $rows, string $idCol, string $nameCol, string $nullLabel): array {
    $groups = [];
    $index  = [];
    foreach ($rows as $r) {
        $gid = $r[$idCol] !== null ? (int)$r[$idCol] : 0;
        if (!isset($index[$gid])) {
            $index[$gid] = count($groups);
            $groups[] = [
                'groupId'   => $gid ?: null,
                'groupName' => ($r[$nameCol] !== null && $r[$nameCol] !== '') ? $r[$nameCol] : $nullLabel,
                'tasks'     => [],
            ];
        }
        $groups[$index[$gid]]['tasks'][] = review_item($r);
    }
    return $groups;
}

// Shared SELECT for review rows: full task columns + the joins task_row_to_api
// expects (assignee / ticket / requester / reviewer / flagger names) + client name.
function reviews_select(): string {
    return 'SELECT t.*, u.name AS assignee_name, tk.id AS ticket_id, ru.name AS requester_name,'
         . ' rw.name AS review_with_name, rb.name AS review_by_name, c.name AS client_name'
         . ' FROM tasks t'
         . ' JOIN clients c ON c.id = t.client_id'
         . ' LEFT JOIN users u ON u.id = t.assignee_id'
         . ' LEFT JOIN tickets tk ON tk.task_id = t.id AND tk.state = "accepted"'
         . ' LEFT JOIN users ru ON ru.id = tk.requester_id'
         . ' LEFT JOIN users rw ON rw.id = t.review_with'
         . ' LEFT JOIN users rb ON rb.id = t.review_by';
}

// Two lists for the current user: tasks I flagged for review (grouped by the
// reviewer; un-assigned flags sit in a "No reviewer yet" group at the top), and
// tasks others flagged for review with me (grouped by who flagged them).
// Team-only: user_workspace_id() already 403s requesters.
function reviews_list(array $user): void {
    $wid = user_workspace_id($user);
    $me  = (int)($user['id'] ?? 0);

    // I want to review — anything I flagged. NULL reviewer ("No reviewer yet") first.
    $s = db()->prepare(
        reviews_select()
        . ' WHERE t.workspace_id = ? AND t.review_by = ?'
        . ' ORDER BY (t.review_with IS NULL) DESC, rw.name ASC, t.updated_at DESC'
    );
    $s->execute([$wid, $me]);
    $mine = group_reviews($s->fetchAll(), 'review_with', 'review_with_name', 'No reviewer yet');

    // Others want to review with me — flagged for me by someone else.
    $s = db()->prepare(
        reviews_select()
        . ' WHERE t.workspace_id = ? AND t.review_with = ? AND t.review_by <> ?'
        . ' ORDER BY rb.name ASC, t.updated_at DESC'
    );
    $s->execute([$wid, $me, $me]);
    $forMe = group_reviews($s->fetchAll(), 'review_by', 'review_by_name', 'Someone');

    json_out(['mine' => $mine, 'forMe' => $forMe]);
}

// --- Activity log (task_events) ---

// Record one task change. Snapshots the title and actor name so the log stays
// readable even after a task or user is later removed.
function log_task_event(int $wid, array $user, string $action, array $task, ?string $from, ?string $to): void {
    $actorName = (isset($user['name']) && $user['name'] !== '') ? $user['name'] : ($user['email'] ?? '');
    if ($actorName === '' && isset($user['id'])) $actorName = assignee_name((int)$user['id']);
    $s = db()->prepare(
        'INSERT INTO task_events (workspace_id, task_id, client_id, actor_id, actor_name, action, title_snapshot, from_val, to_val)
         VALUES (?,?,?,?,?,?,?,?,?)'
    );
    $s->execute([
        $wid,
        $task['id'] ?? null,
        $task['client_id'] ?? null,
        $user['id'] ?? null,
        $actorName,
        $action,
        mb_substr((string)($task['title'] ?? ''), 0, 500),
        $from,
        $to,
    ]);
}

function task_event_to_api(array $r): array {
    return [
        'id'         => (int)$r['id'],
        'taskId'     => isset($r['task_id'])   && $r['task_id']   !== null ? (int)$r['task_id']   : null,
        'clientId'   => isset($r['client_id']) && $r['client_id'] !== null ? (int)$r['client_id'] : null,
        'clientName' => $r['client_name'] ?? null,
        'actorId'    => isset($r['actor_id'])  && $r['actor_id']  !== null ? (int)$r['actor_id']  : null,
        'actor'      => $r['actor_name'] ?? '',
        'action'     => $r['action'],
        'title'      => $r['title_snapshot'] ?? '',
        'from'       => $r['from_val'],
        'to'         => $r['to_val'],
        'at'         => $r['created_at'],
    ];
}

// Lightweight "what changed?" feed for live updates. Read-only; user_workspace_id()
// already 403s requesters, so the Portal never reaches this. With no `since`, returns
// just the current cursor (a prime call) so clients don't get a backlog of old notes.
function tasks_changes(array $user): void {
    $wid = user_workspace_id($user);
    if (!isset($_GET['since']) || $_GET['since'] === '') {
        $s = db()->prepare('SELECT COALESCE(MAX(id), 0) AS c FROM task_events WHERE workspace_id = ?');
        $s->execute([$wid]);
        json_out(['events' => [], 'cursor' => (int)$s->fetch()['c']]);
    }
    $since = (int)$_GET['since'];
    $s = db()->prepare(
        'SELECT id, task_id, client_id, actor_id, actor_name, action, title_snapshot, from_val, to_val, created_at
         FROM task_events WHERE workspace_id = ? AND id > ? ORDER BY id ASC LIMIT 200'
    );
    $s->execute([$wid, $since]);
    $rows = $s->fetchAll();
    $cursor = $rows ? (int)$rows[count($rows) - 1]['id'] : $since;
    json_out(['events' => array_map('task_event_to_api', $rows), 'cursor' => $cursor]);
}

// Activity page: newest-first, optional filter by person and/or client, paginated.
function activity_list(array $user): void {
    $wid = user_workspace_id($user);
    $limit = 50;
    $sql = 'SELECT e.id, e.task_id, e.client_id, e.actor_id, e.actor_name, e.action,
                   e.title_snapshot, e.from_val, e.to_val, e.created_at, c.name AS client_name
            FROM task_events e LEFT JOIN clients c ON c.id = e.client_id
            WHERE e.workspace_id = ?';
    $params = [$wid];
    if (isset($_GET['before']) && $_GET['before'] !== '') { $sql .= ' AND e.id < ?';        $params[] = (int)$_GET['before']; }
    if (isset($_GET['actor'])  && $_GET['actor']  !== '') { $sql .= ' AND e.actor_id = ?';   $params[] = (int)$_GET['actor']; }
    if (isset($_GET['client']) && $_GET['client'] !== '') { $sql .= ' AND e.client_id = ?';  $params[] = (int)$_GET['client']; }
    $sql .= ' ORDER BY e.id DESC LIMIT ' . ($limit + 1);
    $s = db()->prepare($sql);
    $s->execute($params);
    $rows = $s->fetchAll();
    $hasMore = count($rows) > $limit;
    if ($hasMore) array_pop($rows);
    json_out(['events' => array_map('task_event_to_api', $rows), 'hasMore' => $hasMore]);
}
