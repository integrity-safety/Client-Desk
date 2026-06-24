-- Client Desk — Phase 6 migration (run once, after 005).
-- Task priority + a last-touched timestamp used for the "going stale" flag.

SET NAMES utf8mb4;

ALTER TABLE tasks ADD COLUMN priority ENUM('high','medium','low') NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Seed last-touched from the original created date so existing tasks age correctly.
UPDATE tasks SET updated_at = created_at;
