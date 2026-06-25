-- Client Desk — Phase 11 migration (run once, after 010).
-- Adds a 'cancelled' ticket state. When a team member deletes the task that a
-- request was accepted into, the originating request is moved to 'cancelled'
-- (kept as a record, shown as "Cancelled" to the requester) rather than left
-- orphaned pointing at a task that no longer exists.
-- Written to be safe to re-run (MODIFY just restates the column definition).

SET NAMES utf8mb4;

ALTER TABLE tickets
  MODIFY COLUMN state ENUM('submitted','accepted','declined','cancelled')
  NOT NULL DEFAULT 'submitted';
