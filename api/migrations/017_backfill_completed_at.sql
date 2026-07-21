-- 017_backfill_completed_at.sql
-- p31 — "Recently completed" sort.
--
-- tasks.completed_at has existed since 001 and is maintained on status
-- transitions, but any task marked done before that logic was in place (or
-- touched by a direct data fix) can still be sitting at NULL. Those rows would
-- sort to the bottom of the new "Recently completed" view.
--
-- This fills only those gaps, using updated_at as an approximation. Tasks that
-- already carry a real completion time are left alone.
--
-- Idempotent: safe to re-run (the WHERE clause matches nothing on a second run).

UPDATE tasks
   SET completed_at = updated_at
 WHERE status = 'done'
   AND completed_at IS NULL;

-- Also clear stale timestamps on anything that is no longer done, so the sort
-- and the "Completed <date>" label never disagree.
UPDATE tasks
   SET completed_at = NULL
 WHERE status <> 'done'
   AND completed_at IS NOT NULL;
