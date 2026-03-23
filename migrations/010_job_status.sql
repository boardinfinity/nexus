-- Add job status tracking columns to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_status TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_checked_at TIMESTAMPTZ;

-- Index for filtering by job status
CREATE INDEX IF NOT EXISTS idx_jobs_job_status ON jobs(job_status);
