-- Migration 039: Campus Upload Batches
-- Adds campus_upload_batches table for bulk JD upload during placement drives,
-- and a jobs.upload_batch_id FK column.
-- Author: jdenh001 (Track D — Analyze JD enhancement cycle)
-- Date: 2026-05-07

-- ==================== ROLLBACK NOTES ====================
-- To reverse this migration (in order):
--   1. DROP INDEX IF EXISTS idx_campus_upload_batches_status_year;
--   2. DROP INDEX IF EXISTS idx_campus_upload_batches_college;
--   3. DROP INDEX IF EXISTS idx_jobs_upload_batch_id;
--   4. ALTER TABLE jobs DROP COLUMN IF EXISTS upload_batch_id;
--   5. DROP TABLE IF EXISTS campus_upload_batches;
--   Note: dropping the FK will orphan any analyze_jd_runs rows referencing
--         batch_id values from campus_upload_batches — clear those first.
-- =========================================================

-- ==================== 1. campus_upload_batches ====================
CREATE TABLE IF NOT EXISTS campus_upload_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id     uuid        NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
  program        text,                          -- e.g. "MBA Class of 2027"
  job_type       text        CHECK (job_type IN ('summer_internship', 'full_time_placement', 'ppo', 'other')),
  drive_year     int,
  source         text,                          -- free tag, e.g. "Naukri bulk export"
  ctc_tag        text,                          -- e.g. "₹6-12 LPA"
  status         text        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'reviewing', 'committed', 'cancelled')),
  uploaded_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  total_files    int         NOT NULL DEFAULT 0,
  jds_committed  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campus_upload_batches_college
  ON campus_upload_batches(college_id);

CREATE INDEX IF NOT EXISTS idx_campus_upload_batches_status_year
  ON campus_upload_batches(status, drive_year);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_campus_batch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campus_batch_updated_at ON campus_upload_batches;
CREATE TRIGGER trg_campus_batch_updated_at
  BEFORE UPDATE ON campus_upload_batches
  FOR EACH ROW EXECUTE FUNCTION set_campus_batch_updated_at();

-- ==================== 2. jobs.upload_batch_id FK ====================
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS upload_batch_id uuid
    REFERENCES campus_upload_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_upload_batch_id
  ON jobs(upload_batch_id);

-- ==================== 3. RLS ====================
ALTER TABLE campus_upload_batches ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY campus_upload_batches_admin_all
  ON campus_upload_batches
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role IN ('admin', 'super_admin')
    )
  );

-- SPOC (college_rep): read and write their own college's batches only
-- Read
CREATE POLICY campus_upload_batches_spoc_read
  ON campus_upload_batches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'college_rep'
        AND campus_upload_batches.college_id = ANY(nexus_users.restricted_college_ids)
    )
  );

-- Write (insert/update) — college_rep scoped to their college
CREATE POLICY campus_upload_batches_spoc_write
  ON campus_upload_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'college_rep'
        AND campus_upload_batches.college_id = ANY(nexus_users.restricted_college_ids)
    )
  );

CREATE POLICY campus_upload_batches_spoc_update
  ON campus_upload_batches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'college_rep'
        AND campus_upload_batches.college_id = ANY(nexus_users.restricted_college_ids)
    )
  );

-- Block structural ops for college_rep (no DELETE)
-- (no DELETE policy = college_reps cannot delete batches; admins can via admin_all policy)
