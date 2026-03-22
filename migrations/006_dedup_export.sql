-- Migration 006: Data Quality, Dedup & Skill Co-occurrence
-- Features 10 & 11

-- Feature 10: Data Quality & Dedup columns on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quality_score SMALLINT DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES jobs(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_dedup_key ON jobs (dedup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_quality ON jobs (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_is_duplicate ON jobs (is_duplicate);

-- Feature 11: Skill Co-occurrence table
CREATE TABLE IF NOT EXISTS skill_cooccurrence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    skill_a_id UUID REFERENCES taxonomy_skills(id),
    skill_b_id UUID REFERENCES taxonomy_skills(id),
    skill_a_name TEXT NOT NULL,
    skill_b_name TEXT NOT NULL,
    cooccurrence_count INTEGER DEFAULT 0,
    jobs_with_a INTEGER DEFAULT 0,
    jobs_with_b INTEGER DEFAULT 0,
    pmi_score FLOAT,
    last_updated TIMESTAMPTZ DEFAULT now(),
    UNIQUE (skill_a_name, skill_b_name)
);

CREATE INDEX IF NOT EXISTS idx_cooccurrence_count ON skill_cooccurrence (cooccurrence_count DESC);

-- SQL Function: Normalize job fields for dedup
CREATE OR REPLACE FUNCTION normalize_job_fields() RETURNS void AS $$
BEGIN
    UPDATE jobs SET
        title_normalized = lower(regexp_replace(trim(COALESCE(title, '')), '[^a-z0-9 ]', '', 'gi')),
        company_name_normalized = lower(regexp_replace(trim(COALESCE(company_name, '')), '[^a-z0-9 ]', '', 'gi'))
    WHERE title_normalized IS NULL OR company_name_normalized IS NULL;

    UPDATE jobs SET
        dedup_key = md5(
            coalesce(title_normalized, '') || '|' ||
            coalesce(company_name_normalized, '') || '|' ||
            coalesce(lower(trim(location_city)), '')
        )
    WHERE dedup_key IS NULL;
END;
$$ LANGUAGE plpgsql;

-- SQL Function: Find duplicate groups
CREATE OR REPLACE FUNCTION find_duplicate_groups()
RETURNS TABLE(dedup_key TEXT, job_ids UUID[], quality_scores SMALLINT[]) AS $$
BEGIN
    RETURN QUERY
    SELECT
        j.dedup_key,
        array_agg(j.id ORDER BY j.quality_score DESC) AS job_ids,
        array_agg(j.quality_score ORDER BY j.quality_score DESC) AS quality_scores
    FROM jobs j
    WHERE j.dedup_key IS NOT NULL AND j.is_duplicate = false
    GROUP BY j.dedup_key
    HAVING count(*) > 1;
END;
$$ LANGUAGE plpgsql;

-- SQL Function: Recompute quality scores
CREATE OR REPLACE FUNCTION recompute_quality_scores() RETURNS void AS $$
BEGIN
    UPDATE jobs SET quality_score = (
        CASE WHEN title IS NOT NULL AND trim(title) != '' THEN 10 ELSE 0 END +
        CASE WHEN company_name IS NOT NULL AND trim(company_name) != '' THEN 10 ELSE 0 END +
        CASE WHEN description IS NOT NULL AND length(description) > 100 THEN 25 ELSE 0 END +
        CASE WHEN location_city IS NOT NULL AND location_country IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN posted_at IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN seniority_level IS NOT NULL AND seniority_level::text != 'unknown' THEN 5 ELSE 0 END +
        CASE WHEN employment_type IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN enrichment_status::text = 'complete' THEN 20 ELSE 0 END +
        CASE WHEN salary_min IS NOT NULL OR inferred_salary_min IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN application_url IS NOT NULL THEN 5 ELSE 0 END
    );
END;
$$ LANGUAGE plpgsql;

-- SQL Function: Compute PMI scores
CREATE OR REPLACE FUNCTION compute_pmi_scores(p_total_jobs INTEGER) RETURNS void AS $$
BEGIN
    UPDATE skill_cooccurrence sc
    SET pmi_score = ln(
        (sc.cooccurrence_count::float / GREATEST(p_total_jobs, 1))
        / GREATEST(
            (sc.jobs_with_a::float / GREATEST(p_total_jobs, 1)) * (sc.jobs_with_b::float / GREATEST(p_total_jobs, 1)),
            0.0001
        )
    ),
    last_updated = now();
END;
$$ LANGUAGE plpgsql;
