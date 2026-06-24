-- Client Desk — Phase 7 migration (run once, after 006).
-- Optional date the requester would like the work completed by.

SET NAMES utf8mb4;

ALTER TABLE tickets ADD COLUMN requested_date DATE NULL;
