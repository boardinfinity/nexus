-- ============================================================
-- Migration 032: relax surveys_status_check
-- ============================================================
-- The original migration 030 only allowed
--   draft|active|paused|closed|archived
-- but the Survey Admin v2 UI and isOpenForResponses() use the
-- canonical word "published". The "Update status" action was
-- failing with: new row for relation "surveys" violates check
-- constraint "surveys_status_check".
--
-- Relax the constraint to include "published" while keeping
-- "active" for backward compatibility (the legacy survey row
-- and any earlier-created surveys may still use it).

ALTER TABLE surveys
  DROP CONSTRAINT IF EXISTS surveys_status_check;

ALTER TABLE surveys
  ADD CONSTRAINT surveys_status_check
  CHECK (status IN ('draft','active','published','paused','closed','archived'));

COMMENT ON CONSTRAINT surveys_status_check ON surveys IS
  'Survey lifecycle status. "published" and "active" are both treated as open by the runtime.';
