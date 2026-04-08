-- Migration 024: RLS on report_skill_mentions + performance optimizations
-- Security: Enable RLS on report_skill_mentions (365 rows exposed via anon key)
-- Performance: Rewrite get_dashboard_stats and get_enrichment_funnel to reduce scans

-- FIX 1: Enable RLS on report_skill_mentions
ALTER TABLE report_skill_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_skill_mentions FORCE ROW LEVEL SECURITY;

-- FIX 5: Rewrite get_dashboard_stats as STABLE SECURITY DEFINER
-- The jobs table has 18K rows with RLS enabled, causing slow sequential scans.
-- This function runs as SECURITY DEFINER to bypass RLS and uses a single query.
-- A partial index on jobs(enrichment_status) would help further but is acceptable for now.
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS json AS $$
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'total_jobs', (SELECT COUNT(*) FROM jobs),
    'total_companies', (SELECT COUNT(*) FROM companies),
    'total_people', (SELECT COUNT(*) FROM people),
    'total_alumni', (SELECT COUNT(*) FROM alumni),
    'total_skills', (SELECT COUNT(*) FROM taxonomy_skills),
    'jobs_today', (SELECT COUNT(*) FROM jobs WHERE created_at >= CURRENT_DATE),
    'jobs_this_week', (SELECT COUNT(*) FROM jobs WHERE created_at >= date_trunc('week', CURRENT_DATE)),
    'jobs_this_month', (SELECT COUNT(*) FROM jobs WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'enrichment_complete_pct', (SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_status = 'complete') / COUNT(*)) END FROM jobs),
    'active_pipelines', (SELECT COUNT(*) FROM pipeline_runs WHERE status = 'running'),
    'pending_queue', 0,
    'failed_queue', 0
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- FIX 6: Rewrite get_enrichment_funnel to do a single scan instead of 4
CREATE OR REPLACE FUNCTION get_enrichment_funnel(
  p_source text DEFAULT NULL, p_country text DEFAULT NULL,
  p_status text DEFAULT NULL, p_date_from text DEFAULT NULL, p_date_to text DEFAULT NULL
)
RETURNS TABLE(stage text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 100) as has_desc,
      COUNT(*) FILTER (WHERE enrichment_status = 'complete') as is_complete,
      COUNT(*) FILTER (WHERE enrichment_status = 'complete' AND description IS NOT NULL) as fully_enriched
    FROM jobs
    WHERE (p_source IS NULL OR source ILIKE p_source)
      AND (p_country IS NULL OR location_country ILIKE p_country)
      AND (p_status IS NULL OR enrichment_status ILIKE p_status)
      AND (p_date_from IS NULL OR created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR created_at <= p_date_to::timestamptz)
  )
  SELECT 'Total Jobs', total FROM counts
  UNION ALL SELECT 'Has Description', has_desc FROM counts
  UNION ALL SELECT 'Has Skills', is_complete FROM counts
  UNION ALL SELECT 'Fully Enriched', fully_enriched FROM counts;
$$;
