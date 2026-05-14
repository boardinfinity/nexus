-- =============================================================================
-- Migration 044 — Campus Excel Upload support (Track A + Track B)
-- Author:    camjdbcab
-- Date:      2026-05-15
-- Purpose:
--   Extends Campus JD Upload to handle .xlsx files in two tracks:
--     Track A — Full-JD Excels  → async worker analyzes each row
--                 (e.g. UOWD Detailed Descriptions 2025-2026, 234 rows w/ JD text)
--     Track B — Vacancy-log Excels → lightweight title-only ingest, no LLM
--                 (e.g. UOWD Job Roles 2023-2025, 1496 rows, title-only)
--
--   1. New table `campus_vacancies` — Track B output (title-only vacancy log rows)
--   2. New table `campus_excel_tasks` — Track A async work queue (raw row + status)
--   3. Adds `campus_upload_batches.batch_type` column (default 'jd_analyze')
--
--   Both new tables: service-role-only (RLS enabled, no policies) per Phase 1-3
--   baseline. API uses service-role client; client/src has zero .rpc() calls.
--
-- Rollback:
--   ALTER TABLE campus_upload_batches DROP COLUMN IF EXISTS batch_type;
--   DROP TABLE IF EXISTS campus_excel_tasks;
--   DROP TABLE IF EXISTS campus_vacancies;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. campus_vacancies — Track B output (lightweight title-only vacancy rows)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus_vacancies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES campus_upload_batches(id) ON DELETE CASCADE,
  college_id         uuid NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
  excel_row_index    int  NOT NULL,           -- 1-based row index in source sheet
  raw_title          text NOT NULL,           -- as it appeared in the Excel cell
  vacancy_external_id text,                   -- parsed UOWD<id> if available
  parsed_roles       text,                    -- pre-split role chunk (post-regex)
  parsed_employer    text,                    -- pre-split employer chunk
  publishing_channel text,                    -- e.g. "UOWD Job Portal"
  start_date         date,
  end_date           date,
  raw_metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- extra cols verbatim
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campus_vacancies ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_campus_vacancies_batch       ON campus_vacancies (batch_id);
CREATE INDEX IF NOT EXISTS idx_campus_vacancies_college     ON campus_vacancies (college_id);
CREATE INDEX IF NOT EXISTS idx_campus_vacancies_external_id ON campus_vacancies (vacancy_external_id)
  WHERE vacancy_external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. campus_excel_tasks — Track A async work queue
-- ---------------------------------------------------------------------------
-- One row per Excel row to analyze. Worker polls
--   WHERE batch_id = $1 AND status = 'queued'
-- then transitions to 'processing' → 'succeeded'/'failed'.
-- analyze_run_id links to the analyze_jd_runs audit row created during processing.
CREATE TABLE IF NOT EXISTS campus_excel_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES campus_upload_batches(id) ON DELETE CASCADE,
  excel_row_index    int  NOT NULL,            -- 1-based row in source sheet
  raw_title          text NOT NULL,
  raw_employer       text,
  raw_description    text NOT NULL,            -- the JD body text (worker input)
  raw_metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- posting_date, hours, degree_level, majors, etc.
  status             text NOT NULL DEFAULT 'queued',  -- queued / processing / succeeded / failed
  analyze_run_id     uuid REFERENCES analyze_jd_runs(id) ON DELETE SET NULL,
  job_id             uuid REFERENCES jobs(id) ON DELETE SET NULL,  -- set after commit (or pre-commit if landed)
  error_message      text,
  attempts           int  NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  CONSTRAINT campus_excel_tasks_status_chk
    CHECK (status IN ('queued','processing','succeeded','failed'))
);

ALTER TABLE campus_excel_tasks ENABLE ROW LEVEL SECURITY;

-- Worker hot path: pick next queued rows for a batch
CREATE INDEX IF NOT EXISTS idx_campus_excel_tasks_batch_status
  ON campus_excel_tasks (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_campus_excel_tasks_status
  ON campus_excel_tasks (status)
  WHERE status IN ('queued','processing');

-- ---------------------------------------------------------------------------
-- 3. campus_upload_batches.batch_type — distinguish the three flows
-- ---------------------------------------------------------------------------
-- 'jd_analyze'        — existing path (paste-text Step 2, single-/few-JD)
-- 'excel_jd_analyze'  — Track A (xlsx with full descriptions, async)
-- 'vacancy_log'       — Track B (xlsx title-only, lightweight ingest)
ALTER TABLE campus_upload_batches
  ADD COLUMN IF NOT EXISTS batch_type text NOT NULL DEFAULT 'jd_analyze';

-- Drop any prior version of the check (idempotent) then add fresh
ALTER TABLE campus_upload_batches
  DROP CONSTRAINT IF EXISTS campus_upload_batches_batch_type_chk;

ALTER TABLE campus_upload_batches
  ADD CONSTRAINT campus_upload_batches_batch_type_chk
  CHECK (batch_type IN ('jd_analyze','excel_jd_analyze','vacancy_log'));

CREATE INDEX IF NOT EXISTS idx_campus_upload_batches_batch_type
  ON campus_upload_batches (batch_type);

COMMIT;
