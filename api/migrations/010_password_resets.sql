-- Client Desk — Phase 10 migration (run once, after 009).
-- Password reset: one-time, hashed, expiring tokens, plus a per-user cutoff that
-- lets a successful reset invalidate that user's other sessions.
-- Written to be safe to re-run.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) NOT NULL,            -- sha256 of the random token; raw token only ever in the link
  requested_by BIGINT UNSIGNED NULL,         -- admin who initiated it (NULL for self-service)
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  used_at      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pwreset_token (token_hash),
  KEY k_pwreset_user (user_id),
  CONSTRAINT fk_pwreset_user FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pwreset_by   FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Unix timestamp; any session issued before this is treated as signed out.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'sessions_valid_after'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE users ADD COLUMN sessions_valid_after BIGINT UNSIGNED NOT NULL DEFAULT 0',
  'DO 0'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
