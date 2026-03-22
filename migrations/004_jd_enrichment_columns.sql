-- Migration 004: JD Enrichment Pipeline columns
-- Adds columns for Feature 4 (JD Fetch) and Feature 5 (JD Analysis)
-- Run this migration via Supabase SQL Editor

-- New columns for Feature 4 (JD Fetch)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jd_fetch_status TEXT DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jd_fetched_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS min_experience_years SMALLINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_experience_years SMALLINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS education_requirements TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS certifications_required TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inferred_salary_min NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inferred_salary_max NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inferred_salary_currency TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inferred_salary_source TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS industry_domain TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tools_platforms TEXT[];

-- Set jd_fetch_status for existing jobs
UPDATE jobs SET jd_fetch_status = 'not_needed' WHERE description IS NOT NULL AND length(description) > 100;
UPDATE jobs SET jd_fetch_status = 'pending' WHERE description IS NULL OR length(description) <= 100;
