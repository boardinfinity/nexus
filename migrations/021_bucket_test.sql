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

-- v2 columns: sub-role, CTC, experience, education, prompt versioning
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS sub_role TEXT;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS ctc_min NUMERIC;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS ctc_max NUMERIC;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS ctc_currency TEXT;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS experience_min_years INTEGER;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS experience_max_years INTEGER;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS min_education TEXT;
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS preferred_fields TEXT[];
ALTER TABLE jd_bucket_test ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT 'v1';
