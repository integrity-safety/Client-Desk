-- Client Desk — Phase 8 migration (run once, after 007).
-- Activity log for live task updates + the Activity page.
-- Each row records one meaningful task change (who / what / which task / when).
-- The auto-increment id doubles as the polling cursor for /tasks/changes.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS task_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id   BIGINT UNSIGNED NOT NULL,
  task_id        BIGINT UNSIGNED NULL,
  client_id      BIGINT UNSIGNED NULL,
  actor_id       BIGINT UNSIGNED NULL,
  actor_name     VARCHAR(255) NOT NULL DEFAULT '',
  action         VARCHAR(40)  NOT NULL,           -- created | status | assigned | due | deleted
  title_snapshot VARCHAR(500) NOT NULL DEFAULT '', -- task title at the time (so deleted tasks still read)
  from_val       VARCHAR(255) NULL,
  to_val         VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY k_te_ws_id (workspace_id, id),
  KEY k_te_actor (actor_id),
  KEY k_te_client (client_id),
  CONSTRAINT fk_te_ws     FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_te_task   FOREIGN KEY (task_id)      REFERENCES tasks(id)      ON DELETE SET NULL,
  CONSTRAINT fk_te_client FOREIGN KEY (client_id)    REFERENCES clients(id)    ON DELETE SET NULL,
  CONSTRAINT fk_te_actor  FOREIGN KEY (actor_id)     REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
