-- Client Desk — Phase 3 migration (run once, after 002).
-- Adds shared calendar events and a per-workspace theme.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(500) NOT NULL,
  type         ENUM('meeting','event','ooo') NOT NULL DEFAULT 'meeting',
  start_at     DATETIME NOT NULL,
  end_at       DATETIME NOT NULL,
  all_day      TINYINT(1) NOT NULL DEFAULT 0,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY k_events_ws (workspace_id),
  KEY k_events_start (start_at),
  CONSTRAINT fk_events_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_by FOREIGN KEY (created_by)   REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workspace-wide theme (admin-set). Stores a small JSON blob, e.g. {"preset":"pine"}.
ALTER TABLE workspaces ADD COLUMN theme VARCHAR(500) NOT NULL DEFAULT '';
