<?php
// POST /import — load a V1 backup ({clients:[...], tasks:[...]}) into this
// user's workspace. Maps V1 string ids to new DB ids. Adds to existing data.

function do_import(array $user): void {
    require_csrf();
    $wid = user_workspace_id($user);
    $b = body();
    $clients = $b['clients'] ?? null;
    $tasks   = $b['tasks'] ?? null;
    if (!is_array($clients) || !is_array($tasks)) {
        json_out(['error' => "That doesn't look like a Client Desk backup"], 422);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $map = []; // old client id => new id
        $cStmt = $pdo->prepare('INSERT INTO clients (workspace_id, name, contact_email) VALUES (?,?,?)');
        foreach ($clients as $c) {
            $name = isset($c['name']) ? trim((string)$c['name']) : '';
            if ($name === '') continue;
            $cStmt->execute([$wid, $name, isset($c['email']) ? (string)$c['email'] : '']);
            $map[(string)($c['id'] ?? '')] = (int)$pdo->lastInsertId();
        }

        $tStmt = $pdo->prepare(
            'INSERT INTO tasks (workspace_id, client_id, title, detail, private_notes, status, due_date, completed_at)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $count = 0;
        foreach ($tasks as $t) {
            $oldCid = (string)($t['clientId'] ?? '');
            if (!isset($map[$oldCid])) continue;
            $status = in_array(($t['status'] ?? 'todo'), ['todo','inprogress','blocked','done'], true) ? $t['status'] : 'todo';
            $due = (isset($t['dueDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$t['dueDate'])) ? $t['dueDate'] : null;
            $completed = null;
            if ($status === 'done' && !empty($t['completedAt'])) {
                $completed = gmdate('Y-m-d H:i:s', (int)round(((float)$t['completedAt']) / 1000));
            }
            $tStmt->execute([
                $wid, $map[$oldCid],
                (string)($t['title'] ?? 'Untitled'),
                isset($t['detail']) ? (string)$t['detail'] : '',
                isset($t['notes']) ? (string)$t['notes'] : '',
                $status, $due, $completed,
            ]);
            $count++;
        }
        $pdo->commit();
        json_out(['ok' => true, 'clients' => count($map), 'tasks' => $count]);
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_out(['error' => 'Import failed'], 500);
    }
}
