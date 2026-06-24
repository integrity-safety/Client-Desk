<?php
// Front controller for the JSON API. All /api/* requests rewrite here.

declare(strict_types=1);

require __DIR__ . '/../src/http.php';
require __DIR__ . '/../src/db.php';
require __DIR__ . '/../src/auth.php';
require __DIR__ . '/../src/clients.php';
require __DIR__ . '/../src/tasks.php';
require __DIR__ . '/../src/reports.php';
require __DIR__ . '/../src/import.php';
require __DIR__ . '/../src/mailer.php';
require __DIR__ . '/../src/team.php';
require __DIR__ . '/../src/events.php';
require __DIR__ . '/../src/chat.php';
require __DIR__ . '/../src/tickets.php';

// Security headers (defense in depth; Cloudflare adds more at the edge).
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');

start_session();

// Resolve the route. With the .htaccess rewrite, the real path sits in PATH_INFO;
// fall back to parsing REQUEST_URI and trimming the /api base.
$path = $_SERVER['PATH_INFO'] ?? '';
if ($path === '') {
    $uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
    $path = preg_replace('#^.*/api#', '', $uri) ?: '/';
}
$path   = '/' . trim($path, '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Tiny router: [method, pattern, handler]. {id} captures a positive integer.
$routes = [
    ['POST', '/auth/register', fn() => auth_register()],
    ['POST', '/auth/login',    fn() => auth_login()],
    ['POST', '/auth/logout',   fn() => auth_logout()],
    ['GET',  '/auth/me',       fn() => auth_me()],
    ['GET',  '/auth/invite',   fn() => auth_invite_info()],
    ['POST', '/auth/accept-invite', fn() => auth_accept_invite()],
    ['POST', '/auth/forgot',   fn() => auth_forgot()],
    ['GET',  '/auth/reset',    fn() => auth_reset_info()],
    ['POST', '/auth/reset',    fn() => auth_reset()],

    ['GET',    '/team',             fn() => team_overview(require_auth())],
    ['POST',   '/team/invite',      fn() => team_invite(require_auth())],
    ['DELETE', '/team/invite/{id}', fn($id) => team_revoke_invite(require_auth(), $id)],
    ['PATCH',  '/team/member/{id}', fn($id) => team_set_role(require_auth(), $id)],
    ['DELETE', '/team/member/{id}', fn($id) => team_remove(require_auth(), $id)],
    ['POST',   '/team/member/{id}/reset', fn($id) => team_member_reset(require_auth(), $id)],
    ['POST',   '/team/theme',       fn() => team_set_theme(require_auth())],

    ['GET',    '/calendar',     fn() => view_calendar(require_auth())],
    ['POST',   '/events',       fn() => events_create(require_auth())],
    ['PATCH',  '/events/{id}',  fn($id) => events_update(require_auth(), $id)],
    ['DELETE', '/events/{id}',  fn($id) => events_delete(require_auth(), $id)],

    ['GET',  '/conversations',              fn() => conversations_list(require_auth())],
    ['POST', '/conversations/dm',           fn() => dm_open(require_auth())],
    ['GET',  '/conversations/{id}/messages', fn($id) => messages_list(require_auth(), $id)],
    ['POST', '/conversations/{id}/messages', fn($id) => messages_send(require_auth(), $id)],
    ['POST', '/conversations/{id}/read',     fn($id) => conversation_read(require_auth(), $id)],

    // Requester portal (server enforces requester-only + ownership).
    ['GET',  '/portal/tickets',            fn() => portal_tickets(require_auth())],
    ['POST', '/portal/tickets',            fn() => portal_ticket_create(require_auth())],
    ['GET',  '/portal/tickets/{id}',       fn($id) => portal_ticket_get(require_auth(), $id)],
    ['POST', '/portal/tickets/{id}/messages', fn($id) => portal_ticket_reply(require_auth(), $id)],

    // Team-side tickets / triage.
    ['GET',  '/tickets',             fn() => team_tickets(require_auth())],
    ['GET',  '/tickets/{id}',        fn($id) => team_ticket_get(require_auth(), $id)],
    ['POST', '/tickets/{id}/accept', fn($id) => team_ticket_accept(require_auth(), $id)],
    ['POST', '/tickets/{id}/decline', fn($id) => team_ticket_decline(require_auth(), $id)],
    ['POST', '/tickets/{id}/messages', fn($id) => team_ticket_reply(require_auth(), $id)],

    // Requester management (admin, scoped to a client).
    ['GET',    '/clients/{id}/requesters',     fn($id) => client_requesters(require_auth(), $id)],
    ['POST',   '/clients/{id}/requester-invite', fn($id) => client_requester_invite(require_auth(), $id)],
    ['DELETE', '/requesters/{id}',             fn($id) => requester_remove(require_auth(), $id)],

    ['GET',    '/clients',      fn() => clients_list(require_auth())],
    ['POST',   '/clients',      fn() => clients_create(require_auth())],
    ['PATCH',  '/clients/{id}', fn($id) => clients_update(require_auth(), $id)],
    ['DELETE', '/clients/{id}', fn($id) => clients_delete(require_auth(), $id)],

    ['GET',    '/tasks/changes', fn() => tasks_changes(require_auth())],
    ['GET',    '/tasks',        fn() => tasks_list(require_auth())],
    ['POST',   '/tasks',        fn() => tasks_create(require_auth())],
    ['PATCH',  '/tasks/{id}',   fn($id) => tasks_update(require_auth(), $id)],
    ['DELETE', '/tasks/{id}',   fn($id) => tasks_delete(require_auth(), $id)],

    ['GET', '/activity',        fn() => activity_list(require_auth())],

    ['GET', '/dashboard',       fn() => view_dashboard(require_auth())],
    ['GET', '/dashboard/upcoming', fn() => view_dashboard_upcoming(require_auth())],
    ['GET', '/today',           fn() => view_today(require_auth())],
    ['GET', '/weekly',          fn() => view_weekly(require_auth())],
    ['GET', '/report/{id}',     fn($id) => view_report(require_auth(), $id)],
    ['GET', '/share',           fn() => view_share(require_auth())],
    ['POST', '/import',         fn() => do_import(require_auth())],
];

foreach ($routes as [$m, $pattern, $handler]) {
    if ($m !== $method) continue;
    $regex = '#^' . preg_replace('/\{id\}/', '(\d+)', $pattern) . '$#';
    if (preg_match($regex, $path, $mt)) {
        $handler(...(isset($mt[1]) ? [(int)$mt[1]] : []));
        exit;
    }
}

json_out(['error' => 'Not found', 'path' => $path], 404);
