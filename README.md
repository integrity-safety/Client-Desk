# Client Desk — V2 (Phase 1)

Self-hosted client task tracker: per-client tasks, a Today briefing, client reports
(any 7-day window), Share-my-day, and a one-time import of your V1 backup. Server-backed
(PHP + MySQL) with email/password login, so it works from any device.

This is **Phase 1**: single user (you). Teams, calendar, and chat come in later phases —
the schema already includes the tables for them.

## Layout

```
api/                PHP JSON API  (deploy so /api → api/public)
  public/index.php  front controller + router
  src/              auth, clients, tasks, reports, import
  migrations/001_schema.sql
web/                React + Vite SPA  (build output → site root)
config/config.sample.php
```

## Local development

```bash
# API (from repo root) — needs the real config; see below
cd api/public && API_CONFIG=/abs/path/to/config.php php -S localhost:8000

# Web
cd web && npm install && npm run dev   # proxies /api to localhost:8000
```

## Deploy on Plesk (subdomain already set up + TLS done)

1. **Config (secrets, outside web root).** Copy `config/config.sample.php` to e.g.
   `/var/www/vhosts/integritysafety.com/private/config.php` and fill in the DB
   credentials you created in Plesk. Set `app_origin`, `secure_cookies => true`, and a
   random `app_secret`. Never commit this file.

2. **Database schema.** In Plesk → Databases → (your DB) → phpMyAdmin → Import, run
   `api/migrations/001_schema.sql` once.

3. **Git deployment.** Plesk → Git → add this repo on the `tasks` subdomain. Add a
   deployment action so the build runs and paths land correctly:
   ```
   cd web && npm ci && npm run build
   ```
   - **Document root** → `web/dist` (the built SPA).
   - **Alias `/api`** → `api/public` (so the SPA's `/api/...` calls reach PHP).
     In Plesk this is done with an Apache "Additional directives" alias, or by placing
     `api/public` under the docroot as `/api`. (If you prefer, serve the API from a
     second subdomain and set the SPA to call that origin — but same-origin keeps the
     session cookie simplest.)
   - Tell PHP where the config is: set the `API_CONFIG` environment variable to the
     path from step 1 (Plesk → PHP settings, or an Apache `SetEnv API_CONFIG ...`).

4. **First run.** Visit `https://tasks.integritysafety.com`. Because no account exists
   yet, you'll see a one-time **setup** screen — create your admin account. Registration
   then closes automatically.

5. **Bring your data.** In the app, sidebar → **Import V1** → paste the JSON you exported
   from the V1 file. Your clients and tasks load in.

## Security notes

- Passwords hashed with `password_hash` (bcrypt, PHP default); session cookie is httpOnly + Secure + SameSite=Lax.
- All writes require the CSRF token returned by `/auth/me`.
- Every query is scoped to your workspace and uses prepared statements.
- Keep `config.php` outside the web root; it holds your DB password.

## Phase 2+ (later)

Teams (invites, roles, assignment), calendar with conflict detection, and per-client
channels + DMs. The data model already anticipates these.
