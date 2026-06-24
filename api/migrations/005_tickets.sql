-- Client Desk — Phase 5 migration (run once, after 004).
-- External "requesters" tied to one client, plus a ticket intake + thread.

SET NAMES utf8mb4;

-- A requester is a user who is NOT a workspace member; they belong to one client.
CREATE TABLE IF NOT EXISTS requesters (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  client_id    BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_requester_user (user_id),
  KEY k_requester_client (client_id),
  CONSTRAINT fk_req_user   FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_req_ws     FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_client FOREIGN KEY (client_id)    REFERENCES clients(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT UNSIGNED NOT NULL,
  client_id        BIGINT UNSIGNED NOT NULL,
  requester_id     BIGINT UNSIGNED NULL,
  title            VARCHAR(500) NOT NULL,
  body             TEXT NULL,
  state            ENUM('submitted','accepted','declined') NOT NULL DEFAULT 'submitted',
  task_id          BIGINT UNSIGNED NULL,
  requester_read_at DATETIME NULL,
  team_read_at      DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY k_ticket_ws (workspace_id),
  KEY k_ticket_client (client_id),
  KEY k_ticket_state (state),
  CONSTRAINT fk_ticket_ws     FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_client FOREIGN KEY (client_id)    REFERENCES clients(id)    ON DELETE CASCADE,
  CONSTRAINT fk_ticket_req    FOREIGN KEY (requester_id) REFERENCES users(id)      ON DELETE SET NULL,
  CONSTRAINT fk_ticket_task   FOREIGN KEY (task_id)      REFERENCES tasks(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id  BIGINT UNSIGNED NOT NULL,
  author_id  BIGINT UNSIGNED NULL,
  from_team  TINYINT(1) NOT NULL DEFAULT 0,
  body       TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY k_tmsg_ticket (ticket_id, id),
  CONSTRAINT fk_tmsg_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsg_author FOREIGN KEY (author_id) REFERENCES users(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invitations can now carry the requester role and a target client.
ALTER TABLE invites MODIFY COLUMN role ENUM('admin','member','requester') NOT NULL DEFAULT 'member';
ALTER TABLE invites ADD COLUMN client_id BIGINT UNSIGNED NULL;
