<?php
// Read-only computed views: today briefing, client report, share-my-day.

// GET /today?scope=mine|all  — overdue + due today (open tasks with a due date).
function view_today(array $user): void {
    $wid = user_workspace_id($user);
    $today = gmdate_local_today();
    $mine = (($_GET['scope'] ?? 'mine') !== 'all');
    $sql = 'SELECT t.*, c.name AS client_name, u.name AS assignee_name FROM tasks t
            JOIN clients c ON c.id = t.client_id
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.workspace_id = ? AND t.status <> "done" AND t.due_date IS NOT NULL';
    $params = [$wid];
    if ($mine) { $sql .= ' AND t.assignee_id = ?'; $params[] = $user['id']; }
    $sql .= ' ORDER BY t.due_date ASC';
    $s = db()->prepare($sql);
    $s->execute($params);
    $overdue = []; $due = [];
    foreach ($s->fetchAll() as $r) {
        $item = ['id'=>(int)$r['id'], 'clientId'=>(int)$r['client_id'], 'client'=>$r['client_name'],
                 'title'=>$r['title'], 'detail'=>$r['detail'] ?? '', 'status'=>$r['status'],
                 'dueDate'=>$r['due_date'], 'assignee'=>$r['assignee_name'], 'priority'=>$r['priority'] ?? 'medium'];
        if ($r['due_date'] < $today) $overdue[] = $item;
        elseif ($r['due_date'] === $today) $due[] = $item;
    }
    json_out(['overdue' => $overdue, 'today' => $due, 'scope' => $mine ? 'mine' : 'all']);
}

// GET /weekly?scope=mine|all  — a glance at the current calendar week (Mon–Sun in
// the reporting timezone): tasks completed since Monday, plus open tasks due within
// the next 7 days. Read-only; user_workspace_id() already 403s requesters.
function view_weekly(array $user): void {
    $wid  = user_workspace_id($user);
    $mine = (($_GET['scope'] ?? 'mine') !== 'all');
    $tz   = new DateTimeZone(report_tz());

    $now   = new DateTime('now', $tz);
    $today = $now->format('Y-m-d');
    // Monday of the current week. ISO weekday N: Mon=1..Sun=7.
    $monday = (clone $now)->modify('-' . ((int)$now->format('N') - 1) . ' days')->format('Y-m-d');
    $sunday = (new DateTime($monday, $tz))->modify('+6 days')->format('Y-m-d');
    // Rolling 7-day look-ahead for upcoming work (today through today+6).
    $ahead  = (clone $now)->modify('+6 days')->format('Y-m-d');

    // Completed this week: done, completed_at within Mon 00:00 .. Sun 23:59:59.
    $cFrom = $monday . ' 00:00:00';
    $cTo   = $sunday . ' 23:59:59';
    $cSql = 'SELECT t.id, t.client_id, t.title, t.priority, t.completed_at,
                    c.name AS client_name, u.name AS assignee_name
             FROM tasks t JOIN clients c ON c.id = t.client_id
             LEFT JOIN users u ON u.id = t.assignee_id
             WHERE t.workspace_id = ? AND t.status = "done"
               AND t.completed_at IS NOT NULL AND t.completed_at >= ? AND t.completed_at <= ?';
    $cParams = [$wid, $cFrom, $cTo];
    if ($mine) { $cSql .= ' AND t.assignee_id = ?'; $cParams[] = $user['id']; }
    $cSql .= ' ORDER BY t.completed_at DESC, c.name ASC';
    $cs = db()->prepare($cSql);
    $cs->execute($cParams);
    $completed = array_map(function ($r) {
        return ['id'=>(int)$r['id'], 'clientId'=>(int)$r['client_id'], 'client'=>$r['client_name'],
                'title'=>$r['title'], 'priority'=>$r['priority'] ?? 'medium',
                'assignee'=>$r['assignee_name'], 'completedAt'=>$r['completed_at']];
    }, $cs->fetchAll());

    // Due in the next 7 days: open tasks with due_date today .. today+6.
    $uSql = 'SELECT t.id, t.client_id, t.title, t.priority, t.due_date, t.status,
                    c.name AS client_name, u.name AS assignee_name
             FROM tasks t JOIN clients c ON c.id = t.client_id
             LEFT JOIN users u ON u.id = t.assignee_id
             WHERE t.workspace_id = ? AND t.status <> "done"
               AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?';
    $uParams = [$wid, $today, $ahead];
    if ($mine) { $uSql .= ' AND t.assignee_id = ?'; $uParams[] = $user['id']; }
    $uSql .= ' ORDER BY t.due_date ASC, c.name ASC';
    $us = db()->prepare($uSql);
    $us->execute($uParams);
    $upcoming = array_map(function ($r) use ($today) {
        return ['id'=>(int)$r['id'], 'clientId'=>(int)$r['client_id'], 'client'=>$r['client_name'],
                'title'=>$r['title'], 'priority'=>$r['priority'] ?? 'medium', 'status'=>$r['status'],
                'dueDate'=>$r['due_date'], 'dueToday'=>($r['due_date'] === $today),
                'assignee'=>$r['assignee_name']];
    }, $us->fetchAll());

    json_out([
        'weekStart' => $monday, 'weekEnd' => $sunday, 'today' => $today, 'aheadTo' => $ahead,
        'scope' => $mine ? 'mine' : 'all',
        'completed' => $completed, 'upcoming' => $upcoming,
    ]);
}

// GET /report/:clientId?asOf=YYYY-MM-DD  — completed in the 7 days up to asOf,
// plus current in-progress and blocked. Private notes are never included.
function view_report(array $user, int $clientId): void {
    $wid = user_workspace_id($user);
    if (!client_in_workspace($clientId, $wid)) json_out(['error' => 'Unknown client'], 404);

    $asOf = norm_date($_GET['asOf'] ?? null) ?? gmdate_local_today();
    // 7-day inclusive window ending on asOf.
    $to   = $asOf . ' 23:59:59';
    $from = (new DateTime($asOf))->modify('-6 days')->format('Y-m-d') . ' 00:00:00';

    $completed = fetch_tasks($wid, $clientId, 'done', $from, $to);
    $inprogress = fetch_tasks($wid, $clientId, 'inprogress');
    $blocked    = fetch_tasks($wid, $clientId, 'blocked');

    $c = db()->prepare('SELECT name, contact_email FROM clients WHERE id = ?');
    $c->execute([$clientId]);
    $client = $c->fetch();

    json_out([
        'client' => ['name' => $client['name'], 'email' => $client['contact_email']],
        'asOf' => $asOf, 'from' => substr($from, 0, 10), 'to' => $asOf,
        'completed' => $completed, 'inprogress' => $inprogress, 'blocked' => $blocked,
    ]);
}

// GET /share?scope=mine|all  — in-progress + due-today, grouped by client.
function view_share(array $user): void {
    $wid = user_workspace_id($user);
    $today = gmdate_local_today();
    $mine = (($_GET['scope'] ?? 'mine') !== 'all');
    $sql = 'SELECT t.*, c.id AS cid, c.name AS client_name FROM tasks t
            JOIN clients c ON c.id = t.client_id
            WHERE t.workspace_id = ? AND t.status <> "done"
              AND (t.status = "inprogress" OR t.due_date = ?)';
    $params = [$wid, $today];
    if ($mine) { $sql .= ' AND t.assignee_id = ?'; $params[] = $user['id']; }
    $sql .= ' ORDER BY c.name, t.created_at';
    $s = db()->prepare($sql);
    $s->execute($params);
    $groups = [];
    foreach ($s->fetchAll() as $r) {
        $cid = (int)$r['cid'];
        if (!isset($groups[$cid])) $groups[$cid] = ['client' => $r['client_name'], 'tasks' => []];
        $groups[$cid]['tasks'][] = [
            'title' => $r['title'], 'detail' => $r['detail'] ?? '',
            'dueToday' => ($r['due_date'] === $today),
        ];
    }
    json_out(['groups' => array_values($groups), 'today' => $today, 'scope' => $mine ? 'mine' : 'all']);
}

// GET /dashboard  — team-wide payload for the read-only TV view: overdue +
// due-today (open dated tasks across the whole workspace), upcoming HIGH-priority
// work through the end of this calendar week (Sunday), and the count of requests
// still awaiting triage. Read-only; user_workspace_id() already 403s requesters,
// so the Portal never reaches this.
function view_dashboard(array $user): void {
    $wid   = user_workspace_id($user);
    $today = gmdate_local_today();

    // End of this calendar week (Sunday) in the reporting timezone. ISO weekday
    // N: Mon=1 .. Sun=7, so (7 - N) days from today lands on Sunday (0 on Sunday).
    $end = new DateTime('now', new DateTimeZone(report_tz()));
    $end->modify('+' . (7 - (int)$end->format('N')) . ' days');
    $weekEnd = $end->format('Y-m-d');

    // Overdue + due today: every open task with a due date on or before today.
    $s = db()->prepare(
        'SELECT t.id, t.client_id, t.title, t.due_date, t.priority,
                c.name AS client_name, u.name AS assignee_name
         FROM tasks t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.workspace_id = ? AND t.status <> "done"
           AND t.due_date IS NOT NULL AND t.due_date <= ?
         ORDER BY t.due_date ASC, c.name ASC'
    );
    $s->execute([$wid, $today]);
    $overdue = []; $dueToday = [];
    foreach ($s->fetchAll() as $r) {
        $item = dashboard_item($r);
        if ($r['due_date'] < $today) $overdue[] = $item; else $dueToday[] = $item;
    }

    // Upcoming high-priority only, future-dated through Sunday, soonest first.
    $up = db()->prepare(
        'SELECT t.id, t.client_id, t.title, t.due_date, t.priority,
                c.name AS client_name, u.name AS assignee_name
         FROM tasks t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.workspace_id = ? AND t.status <> "done" AND t.priority = "high"
           AND t.due_date IS NOT NULL AND t.due_date > ? AND t.due_date <= ?
         ORDER BY t.due_date ASC, c.name ASC'
    );
    $up->execute([$wid, $today, $weekEnd]);
    $upcoming = array_map('dashboard_item', $up->fetchAll());

    // Requests still in the triage queue (submitted, not yet accepted/declined).
    $q = db()->prepare('SELECT COUNT(*) AS n FROM tickets WHERE workspace_id = ? AND state = "submitted"');
    $q->execute([$wid]);
    $requests = (int)$q->fetch()['n'];

    json_out([
        'date'      => $today,
        'weekEnd'   => $weekEnd,
        'workspace' => workspace_name($wid),
        'overdue'   => $overdue,
        'dueToday'  => $dueToday,
        'upcoming'  => $upcoming,
        'requests'  => $requests,
    ]);
}

function dashboard_item(array $r): array {
    return [
        'id'       => (int)$r['id'],
        'clientId' => (int)$r['client_id'],
        'client'   => $r['client_name'],
        'title'    => $r['title'],
        'dueDate'  => $r['due_date'],
        'priority' => $r['priority'] ?? 'medium',
        'assignee' => $r['assignee_name'],
    ];
}

// GET /dashboard/upcoming  — team-wide payload for the second TV tab: a lane of
// every open overdue task, then the next 10 calendar days (today .. +9), each with
// its open dated tasks plus any calendar events on that day. Read-only; requesters
// are 403'd by user_workspace_id() so the Portal never reaches this.
function view_dashboard_upcoming(array $user): void {
    $wid   = user_workspace_id($user);
    $today = gmdate_local_today();
    $end   = (new DateTime($today, new DateTimeZone(report_tz())))->modify('+9 days')->format('Y-m-d');

    // Overdue lane: open dated tasks strictly before today.
    $o = db()->prepare(
        'SELECT t.id, t.client_id, t.title, t.due_date, t.priority,
                t.assignee_id, c.name AS client_name, u.name AS assignee_name
         FROM tasks t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.workspace_id = ? AND t.status <> "done"
           AND t.due_date IS NOT NULL AND t.due_date < ?
         ORDER BY t.due_date ASC, c.name ASC'
    );
    $o->execute([$wid, $today]);
    $overdue = array_map('upcoming_item', $o->fetchAll());

    // Open dated tasks inside the 10-day window, high priority first within a day.
    $t = db()->prepare(
        'SELECT t.id, t.client_id, t.title, t.due_date, t.priority,
                t.assignee_id, c.name AS client_name, u.name AS assignee_name
         FROM tasks t JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.workspace_id = ? AND t.status <> "done"
           AND t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?
         ORDER BY t.due_date ASC, (t.priority = "high") DESC, c.name ASC'
    );
    $t->execute([$wid, $today, $end]);
    $tasksByDay = [];
    foreach ($t->fetchAll() as $r) {
        $tasksByDay[$r['due_date']][] = upcoming_item($r);
    }

    // Events overlapping the window, expanded across each day they cover.
    $e = db()->prepare(
        'SELECT * FROM events WHERE workspace_id = ? AND start_at <= ? AND end_at >= ? ORDER BY start_at'
    );
    $e->execute([$wid, $end . ' 23:59:59', $today . ' 00:00:00']);
    $eventsByDay = [];
    foreach ($e->fetchAll() as $r) {
        $ev = event_row($r);
        $s = substr($ev['start'], 0, 10);
        $en = substr($ev['end'], 0, 10);
        $cur = $s < $today ? $today : $s;
        $stop = $en > $end ? $end : $en;
        for (; $cur <= $stop; $cur = date('Y-m-d', strtotime($cur . ' +1 day'))) {
            $eventsByDay[$cur][] = $ev;
        }
    }

    // Ten contiguous days starting today.
    $days = [];
    for ($i = 0; $i < 10; $i++) {
        $d = (new DateTime($today))->modify("+$i days")->format('Y-m-d');
        $days[] = [
            'date'   => $d,
            'tasks'  => $tasksByDay[$d] ?? [],
            'events' => $eventsByDay[$d] ?? [],
        ];
    }

    json_out([
        'date'      => $today,
        'workspace' => workspace_name($wid),
        'overdue'   => $overdue,
        'days'      => $days,
    ]);
}

function upcoming_item(array $r): array {
    return [
        'id'         => (int)$r['id'],
        'clientId'   => (int)$r['client_id'],
        'client'     => $r['client_name'],
        'title'      => $r['title'],
        'dueDate'    => $r['due_date'],
        'priority'   => $r['priority'] ?? 'medium',
        'assigneeId' => $r['assignee_id'] !== null ? (int)$r['assignee_id'] : null,
        'assignee'   => $r['assignee_name'],
    ];
}


// --- helpers ---
function fetch_tasks(int $wid, int $clientId, string $status, ?string $from = null, ?string $to = null): array {
    if ($status === 'done' && $from && $to) {
        $s = db()->prepare(
            'SELECT title, detail FROM tasks
             WHERE workspace_id=? AND client_id=? AND status="done"
               AND completed_at IS NOT NULL AND completed_at>=? AND completed_at<=?
             ORDER BY completed_at DESC'
        );
        $s->execute([$wid, $clientId, $from, $to]);
    } else {
        $s = db()->prepare(
            'SELECT title, detail FROM tasks WHERE workspace_id=? AND client_id=? AND status=? ORDER BY created_at'
        );
        $s->execute([$wid, $clientId, $status]);
    }
    return array_map(fn($r) => ['title' => $r['title'], 'detail' => $r['detail'] ?? ''], $s->fetchAll());
}

// "Today" in the app's reporting timezone. Stored timestamps are UTC; for a small
// team this is close enough. Adjust the offset here if you want a fixed local day.
function gmdate_local_today(): string {
    return (new DateTime('now', new DateTimeZone(report_tz())))->format('Y-m-d');
}
function report_tz(): string {
    $c = app_config();
    return $c['report_timezone'] ?? 'America/Los_Angeles';
}
