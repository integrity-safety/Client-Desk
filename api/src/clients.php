<?php
// Clients: list / create / update / delete, scoped to the user's workspace.

function clients_list(array $user): void {
    $wid = user_workspace_id($user);
    $s = db()->prepare(
        'SELECT c.id, c.name, c.contact_email AS email, c.created_at,
                (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status <> "done") AS open_count,
                (SELECT MIN(t.due_date) FROM tasks t
                   WHERE t.client_id = c.id AND t.status <> "done" AND t.due_date IS NOT NULL) AS next_due
         FROM clients c WHERE c.workspace_id = ? ORDER BY c.name'
    );
    $s->execute([$wid]);
    $rows = $s->fetchAll();

    // Tiered "due soon" flag from the soonest open deadline: red if overdue or due
    // within 3 days, amber if due within 7. Computed in the app's reporting timezone.
    $today = gmdate_local_today();
    $red   = (new DateTime($today))->modify('+3 days')->format('Y-m-d');
    $amber = (new DateTime($today))->modify('+7 days')->format('Y-m-d');
    $out = [];
    foreach ($rows as $r) {
        $flag = null;
        if ($r['next_due'] !== null) {
            if ($r['next_due'] <= $red)        $flag = 'red';
            elseif ($r['next_due'] <= $amber)  $flag = 'amber';
        }
        $out[] = [
            'id'         => (int)$r['id'],
            'name'       => $r['name'],
            'email'      => $r['email'],
            'created_at' => $r['created_at'],
            'open_count' => (int)$r['open_count'],
            'due_flag'   => $flag,
            'next_due'   => $r['next_due'],
        ];
    }
    json_out(['clients' => $out]);
}

function clients_create(array $user): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $b = body();
    $name  = str_field($b, 'name');
    $email = str_field($b, 'email');
    if ($name === '') json_out(['error' => 'Client name is required'], 422);

    $s = db()->prepare('INSERT INTO clients (workspace_id, name, contact_email) VALUES (?,?,?)');
    $s->execute([$wid, $name, $email]);
    json_out(['id' => (int)db()->lastInsertId()], 201);
}

function clients_update(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $b = body();
    $name  = str_field($b, 'name');
    $email = str_field($b, 'email');
    if ($name === '') json_out(['error' => 'Client name is required'], 422);

    $s = db()->prepare('UPDATE clients SET name = ?, contact_email = ? WHERE id = ? AND workspace_id = ?');
    $s->execute([$name, $email, $id, $wid]);
    json_out(['ok' => true]);
}

function clients_delete(array $user, int $id): void {
    require_csrf();
    $wid = user_workspace_id($user);
    // Tasks cascade via FK.
    $s = db()->prepare('DELETE FROM clients WHERE id = ? AND workspace_id = ?');
    $s->execute([$id, $wid]);
    json_out(['ok' => true]);
}
