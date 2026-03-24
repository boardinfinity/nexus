-- Migration 017: Scale RPCs — move JS aggregations to PostgreSQL
-- Fixes endpoints that fetch all rows and aggregate in JS (PostgREST 1000-row limit)

-- Company job stats for auto-enrichment
CREATE OR REPLACE FUNCTION get_company_job_stats(p_company_id UUID)
RETURNS TABLE(
  job_count BIGINT,
  top_location TEXT,
  top_employment_type TEXT,
  latest_posted_at TIMESTAMPTZ
) AS $$
  SELECT
    COUNT(*),
    MODE() WITHIN GROUP (ORDER BY location_raw) FILTER (WHERE location_raw IS NOT NULL),
    MODE() WITHIN GROUP (ORDER BY employment_type::TEXT) FILTER (WHERE employment_type IS NOT NULL),
    MAX(posted_at)
  FROM jobs WHERE company_id = p_company_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Quality score distribution
CREATE OR REPLACE FUNCTION get_quality_score_distribution()
RETURNS TABLE(bucket TEXT, count BIGINT) AS $$
  SELECT
    CASE
      WHEN quality_score <= 20 THEN '0-20'
      WHEN quality_score <= 40 THEN '21-40'
      WHEN quality_score <= 60 THEN '41-60'
      WHEN quality_score <= 80 THEN '61-80'
      ELSE '81-100'
    END AS bucket,
    COUNT(*)
  FROM jobs
  GROUP BY bucket
  ORDER BY bucket;
$$ LANGUAGE sql SECURITY DEFINER;

-- Find duplicate companies by normalized name
CREATE OR REPLACE FUNCTION find_duplicate_companies()
RETURNS TABLE(normalized_name TEXT, company_ids UUID[], company_names TEXT[], count BIGINT) AS $$
  SELECT
    name_normalized,
    ARRAY_AGG(id),
    ARRAY_AGG(name),
    COUNT(*)
  FROM companies
  WHERE name_normalized IS NOT NULL
  GROUP BY name_normalized
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT 100;
$$ LANGUAGE sql SECURITY DEFINER;
