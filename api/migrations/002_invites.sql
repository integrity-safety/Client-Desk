-- Client Desk — Phase 2 migration (run once, after 001).
-- Adds email invitations. Roles + assignee already exist in 001.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS invites (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  email        VARCHAR(255) NOT NULL,
  role         ENUM('admin','member') NOT NULL DEFAULT 'member',
  token        CHAR(64) NOT NULL,
  invited_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  accepted_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invite_token (token),
  KEY k_invite_ws (workspace_id),
  KEY k_invite_email (email),
  CONSTRAINT fk_invite_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_by FOREIGN KEY (invited_by)   REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
