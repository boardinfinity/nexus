-- Migration 021: JD Bucket Classification Test table
-- Stores results from the bucket classification test endpoint

CREATE TABLE IF NOT EXISTS jd_bucket_test (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  job_function TEXT,
  job_family TEXT,
  industry TEXT,
  seniority TEXT,
  company_type TEXT,
  geography TEXT,
  standardized_title TEXT,
  bucket_label TEXT,
  skills JSONB,
  jd_quality TEXT,
  classification_confidence TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jd_bucket_test_job_id ON jd_bucket_test (job_id);
CREATE INDEX IF NOT EXISTS idx_jd_bucket_test_created_at ON jd_bucket_test (created_at DESC);
