-- Migration 026: Bulk pipeline helper functions for scale build
-- These functions replace per-row N+1 patterns with single SQL calls

-- batch_jobs table: tracks OpenAI Batch API submissions
CREATE TABLE IF NOT EXISTS batch_jobs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_run_id UUID        REFERENCES pipeline_runs(id),
  batch_type      TEXT        NOT NULL,   -- 'jd_enrichment' | 'people_enrichment'
  openai_batch_id TEXT,                   -- OpenAI Batch API batch ID
  input_file_id   TEXT,
  output_file_id  TEXT,
  status          TEXT        DEFAULT 'pending', -- pending | submitted | processing | completed | failed
  job_count       INTEGER     DEFAULT 0,
  processed_count INTEGER     DEFAULT 0,
  failed_count    INTEGER     DEFAULT 0,
  submitted_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_pipeline_run ON batch_jobs(pipeline_run_id);

-- Add to job_queue if missing columns
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS type         TEXT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS payload      JSONB;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS attempts     INTEGER DEFAULT 0;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS priority     INTEGER DEFAULT 0;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT now();
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS error        TEXT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS result       JSONB;

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_job_queue_status_type ON job_queue(status, type);
CREATE INDEX IF NOT EXISTS idx_job_queue_priority ON job_queue(priority DESC, created_at ASC);

