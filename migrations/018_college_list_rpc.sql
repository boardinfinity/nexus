-- Migration 018: College list RPC + Dashboard stats RPC
-- Fixes N+1 query on colleges list and provides dashboard KPI aggregation

-- 1. College list with stats (replaces N+1 per-college sub-queries)
CREATE OR REPLACE FUNCTION get_colleges_with_stats(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, name text, short_name text, country text, city text,
  website text, catalog_year text, board_hub_account_id text,
  created_at timestamptz,
  program_count bigint, course_count bigint, skill_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.name, c.short_name, c.country, c.city,
    c.website, c.catalog_year, c.board_hub_account_id,
    c.created_at,
    COALESCE(p.cnt, 0) AS program_count,
    COALESCE(cr.cnt, 0) AS course_count,
    COALESCE(s.cnt, 0) AS skill_count
  FROM colleges c
  LEFT JOIN (
    SELECT college_id, COUNT(*) AS cnt FROM college_programs GROUP BY college_id
  ) p ON p.college_id = c.id
  LEFT JOIN (
    SELECT college_id, COUNT(*) AS cnt FROM college_courses GROUP BY college_id
  ) cr ON cr.college_id = c.id
  LEFT JOIN (
    SELECT cc.college_id, COUNT(DISTINCT cs.id) AS cnt
    FROM college_courses cc
    JOIN course_skills cs ON cs.course_id = cc.id
    GROUP BY cc.college_id
  ) s ON s.college_id = c.id
  WHERE (p_search IS NULL OR c.name ILIKE '%' || p_search || '%')
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper: total count for pagination
CREATE OR REPLACE FUNCTION get_colleges_count(p_search text DEFAULT NULL)
RETURNS bigint AS $$
  SELECT COUNT(*) FROM colleges
  WHERE (p_search IS NULL OR name ILIKE '%' || p_search || '%');
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- 2. Dashboard stats RPC (single call for all KPI cards)
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS json AS $$
DECLARE
  result json;
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
    'enrichment_complete_pct', (
      SELECT CASE WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_status = 'complete') / COUNT(*))
      END FROM jobs
    ),
    'active_pipelines', (SELECT COUNT(*) FROM pipeline_runs WHERE status = 'running'),
    'pending_queue', (SELECT COUNT(*) FROM pipeline_queue WHERE status = 'pending'),
    'failed_queue', (SELECT COUNT(*) FROM pipeline_queue WHERE status = 'failed')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
