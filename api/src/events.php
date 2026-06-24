<?php
// Shared calendar events (any member can add; creator or admin can edit/delete),
// plus a /calendar feed that merges task deadlines + events and flags clashes.

const EVENT_TYPES = ['meeting', 'event', 'ooo'];

function event_row(array $r): array {
    return [
        'id'      => (int)$r['id'],
        'title'   => $r['title'],
        'type'    => $r['type'],
        'start'   => $r['start_at'],
        'end'     => $r['end_at'],
        'allDay'  => (int)$r['all_day'] === 1,
        'createdBy' => $r['created_by'] !== null ? (int)$r['created_by'] : null,
    ];
}

// GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
function view_calendar(array $user): void {
    $wid = user_workspace_id($user);
    $from = norm_date($_GET['from'] ?? null) ?? gmdate_local_today();
    $to   = norm_date($_GET['to'] ?? null) ?? $from;

    // Events overlapping the window.
    $e = db()->prepare(
        'SELECT * FROM events WHERE workspace_id = ? AND start_at <= ? AND end_at >= ?
         ORDER BY start_at'
    );
    $e->execute([$wid, $to . ' 23:59:59', $from . ' 00:00:00']);
    $events = array_map('event_row', $e->fetchAll());

    // Task deadlines in the window (open + done), with client + assignee.
    $t = db()->prepare(
        'SELECT t.id, t.title, t.status, t.due_date, t.client_id, c.name AS client_name,
                t.assignee_id, u.name AS assignee_name
         FROM tasks t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.workspace_id = ? AND t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?
         ORDER BY t.due_date'
    );
    $t->execute([$wid, $from, $to]);
    $deadlines = array_map(fn($r) => [
        'id' => (int)$r['id'], 'title' => $r['title'], 'status' => $r['status'],
        'date' => $r['due_date'], 'clientId' => (int)$r['client_id'], 'client' => $r['client_name'],
        'assigneeId' => $r['assignee_id'] !== null ? (int)$r['assignee_id'] : null,
        'assignee' => $r['assignee_name'],
    ], $t->fetchAll());

    json_out([
        'from' => $from, 'to' => $to,
        'events' => $events, 'deadlines' => $deadlines,
        'conflicts' => compute_conflicts($events, $deadlines),
    ]);
}

// A "conflict day" = a date that has at least one open deadline AND an event,
// or two or more open deadlines. Returns a map of date => reason.
function compute_conflicts(array $events, array $deadlines): array {
    $eventDays = [];
    foreach ($events as $ev) {
        $d = substr($ev['start'], 0, 10); $end = substr($ev['end'], 0, 10);
        for ($cur = $d; $cur <= $end; $cur = date('Y-m-d', strtotime($cur . ' +1 day'))) {
            $eventDays[$cur] = true;
        }
    }
    $byDay = [];
    foreach ($deadlines as $dl) {
        if ($dl['status'] === 'done') continue;
        $byDay[$dl['date']] = ($byDay[$dl['date']] ?? 0) + 1;
    }
    $out = [];
    foreach ($byDay as $day => $count) {
        if (!empty($eventDays[$day]) && $count >= 1) $out[$day] = 'deadline_during_event';
        elseif ($count >= 2) $out[$day] = 'multiple_deadlines';
    }
    return $out;
}

function events_create(array $user): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $b = body();
    $title = str_field($b, 'title');
    $type  = in_array(($b['type'] ?? 'meeting'), EVENT_TYPES, true) ? $b['type'] : 'meeting';
    $start = norm_datetime($b['start'] ?? null);
    $end   = norm_datetime($b['end'] ?? null) ?? $start;
    $allDay = !empty($b['allDay']) ? 1 : 0;
    if ($title === '') json_out(['error' => 'Event title is required'], 422);
    if (!$start) json_out(['error' => 'A start date/time is required'], 422);
    if ($end < $start) $end = $start;

    $s = db()->prepare(
        'INSERT INTO events (workspace_id, title, type, start_at, end_at, all_day, created_by)
         VALUES (?,?,?,?,?,?,?)'
    );
    $s->execute([$wid, $title, $type, $start, $end, $allDay, $user['id']]);
    json_out(['id' => (int)db()->lastInsertId()], 201);
}

function events_update(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $ev = event_owned($id, $wid);
    if (!$ev) json_out(['error' => 'Event not found'], 404);
    if (!can_edit_event($user, $ev)) json_out(['error' => 'Only the creator or an admin can edit this event'], 403);

    $b = body();
    $title = str_field($b, 'title', $ev['title']);
    $type  = in_array(($b['type'] ?? $ev['type']), EVENT_TYPES, true) ? ($b['type'] ?? $ev['type']) : $ev['type'];
    $start = array_key_exists('start', $b) ? (norm_datetime($b['start']) ?? $ev['start_at']) : $ev['start_at'];
    $end   = array_key_exists('end', $b) ? (norm_datetime($b['end']) ?? $start) : $ev['end_at'];
    $allDay = array_key_exists('allDay', $b) ? (!empty($b['allDay']) ? 1 : 0) : (int)$ev['all_day'];
    if ($title === '') json_out(['error' => 'Event title is required'], 422);
    if ($end < $start) $end = $start;

    $s = db()->prepare('UPDATE events SET title=?, type=?, start_at=?, end_at=?, all_day=? WHERE id=? AND workspace_id=?');
    $s->execute([$title, $type, $start, $end, $allDay, $id, $wid]);
    json_out(['ok' => true]);
}

function events_delete(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $ev = event_owned($id, $wid);
    if (!$ev) json_out(['ok' => true]);
    if (!can_edit_event($user, $ev)) json_out(['error' => 'Only the creator or an admin can delete this event'], 403);
    $s = db()->prepare('DELETE FROM events WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    json_out(['ok' => true]);
}

// --- helpers ---
function event_owned(int $id, int $wid): ?array {
    $s = db()->prepare('SELECT * FROM events WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    return $s->fetch() ?: null;
}
function can_edit_event(array $user, array $ev): bool {
    if ((int)$ev['created_by'] === (int)$user['id']) return true;
    return current_role($user) === 'admin';
}
function norm_datetime($v): ?string {
    if (!is_string($v) || $v === '') return null;
    // Accept "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" or date-only.
    $v = str_replace('T', ' ', trim($v));
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return $v . ' 00:00:00';
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $v)) {
        return strlen($v) === 16 ? $v . ':00' : $v;
    }
    return null;
}
