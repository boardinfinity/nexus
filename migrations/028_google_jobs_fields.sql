-- Migration 028: Add fields for richer Google Jobs data from Apify
-- Also useful for LinkedIn and future sources

-- is_remote: whether the job is remote/work-from-home
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_remote BOOLEAN DEFAULT NULL;

-- job_publisher: which platform originally listed the job (e.g. "Glassdoor", "Internshala", "LinkedIn")
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_publisher TEXT;

-- apply_platforms: comma-separated list of platforms where the job can be applied to
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_platforms TEXT;

-- qualifications: structured qualifications/requirements extracted from the listing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS qualifications TEXT[];

-- responsibilities: structured responsibilities extracted from the listing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS responsibilities TEXT[];

-- benefits: structured benefits extracted from the listing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits TEXT[];

-- salary_text: human-readable salary string (e.g. "₹5L-8L per year")
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_text TEXT;

-- Normalized title for better dedup (some jobs already have this)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_normalized TEXT;

-- Normalized company name for better dedup
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_name_normalized TEXT;

-- Index for remote jobs filter
CREATE INDEX IF NOT EXISTS idx_jobs_is_remote ON jobs(is_remote) WHERE is_remote = true;
CREATE INDEX IF NOT EXISTS idx_jobs_publisher ON jobs(job_publisher);
