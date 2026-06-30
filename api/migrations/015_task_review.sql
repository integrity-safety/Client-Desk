-- Client Desk — Phase 15 migration (run once, after 014).
-- "Review with a teammate": flag a task to review with a specific team member.
--   review_with = who you want to review it with (a teammate; optional)
--   review_by   = who flagged it (set automatically when a flag is placed)
-- Both nullable, BIGINT UNSIGNED to match assignee_id, with FKs to users
-- ON DELETE SET NULL so removing a teammate auto-clears their review flags
-- (mirrors how assignee_id behaves).
-- Written to be safe to re-run: each column/constraint is only added if absent.

SET NAMES utf8mb4;

-- review_with --------------------------------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND COLUMN_NAME = 'review_with'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE tasks ADD COLUMN review_with BIGINT UNSIGNED NULL AFTER assignee_id',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- review_by ----------------------------------------------------------------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND COLUMN_NAME = 'review_by'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE tasks ADD COLUMN review_by BIGINT UNSIGNED NULL AFTER review_with',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- index to make the Reviews tab lookups (by review_with / review_by) cheap --
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND INDEX_NAME = 'k_tasks_review'
);
SET @ddl := IF(@idx = 0,
  'ALTER TABLE tasks ADD KEY k_tasks_review (workspace_id, review_with, review_by)',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK: review_with -> users (SET NULL on teammate removal) -------------------
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND CONSTRAINT_NAME = 'fk_tasks_review_with'
);
SET @ddl := IF(@fk = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_review_with FOREIGN KEY (review_with) REFERENCES users(id) ON DELETE SET NULL',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK: review_by -> users (SET NULL on teammate removal) ---------------------
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND CONSTRAINT_NAME = 'fk_tasks_review_by'
);
SET @ddl := IF(@fk = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_review_by FOREIGN KEY (review_by) REFERENCES users(id) ON DELETE SET NULL',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
