-- Client Desk — Phase 9 migration (run once, after 008).
-- Optional internal estimate of whole hours to complete a task (minimum 1 when set).
-- Never shown to clients; this feeds the billable-hours work in a later phase.
-- Written to be safe to re-run: it only adds the column if it isn't already there.

SET NAMES utf8mb4;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND COLUMN_NAME = 'est_hours'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE tasks ADD COLUMN est_hours SMALLINT UNSIGNED NULL',
  'DO 0'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
