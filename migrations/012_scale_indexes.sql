-- Migration 012: Add indexes for 500K job scale
-- These indexes are critical for query performance at scale

-- Jobs: most common query/filter patterns
CREATE INDEX IF NOT EXISTS idx_jobs_company_name ON jobs(company_name);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_enrichment_status ON jobs(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_jobs_quality_score ON jobs(quality_score);
CREATE INDEX IF NOT EXISTS idx_jobs_employment_type ON jobs(employment_type);
CREATE INDEX IF NOT EXISTS idx_jobs_location_country ON jobs(location_country);
CREATE INDEX IF NOT EXISTS idx_jobs_title_normalized ON jobs(title_normalized);
CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_external_id_source ON jobs(external_id, source);

-- Job skills: heavy join table at scale
CREATE INDEX IF NOT EXISTS idx_job_skills_job_id ON job_skills(job_id);
CREATE INDEX IF NOT EXISTS idx_job_skills_skill_id ON job_skills(taxonomy_skill_id);

-- Companies
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

-- People
CREATE INDEX IF NOT EXISTS idx_people_linkedin_url ON people(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_people_enrichment_status ON people(enrichment_status);
