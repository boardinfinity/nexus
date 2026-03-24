-- Migration 020: Performance indexes and aggregation RPCs
-- Adds missing indexes and creates RPCs for server-side aggregation

-- ============================================================
-- PART 1: MISSING INDEXES
-- ============================================================

-- Priority 0: Tables with ZERO indexes
CREATE INDEX IF NOT EXISTS idx_alumni_person_id ON alumni(person_id);
CREATE INDEX IF NOT EXISTS idx_alumni_college_id ON alumni(college_id);
CREATE INDEX IF NOT EXISTS idx_alumni_graduation_year ON alumni(graduation_year);
CREATE INDEX IF NOT EXISTS idx_alumni_created_at ON alumni(created_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_type ON pipeline_runs(pipeline_type);

-- Priority 1: Commonly filtered/sorted
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);
CREATE INDEX IF NOT EXISTS idx_companies_enrichment_status ON companies(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_companies_created_at ON companies(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_people_seniority ON people(seniority);
CREATE INDEX IF NOT EXISTS idx_people_function ON people(function);
CREATE INDEX IF NOT EXISTS idx_people_created_at ON people(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_people_current_company_id ON people(current_company_id);

CREATE INDEX IF NOT EXISTS idx_jobs_seniority_level ON jobs(seniority_level);
CREATE INDEX IF NOT EXISTS idx_jobs_jd_fetch_status ON jobs(jd_fetch_status);

-- Priority 2: PlaceIntel
CREATE INDEX IF NOT EXISTS idx_placement_cycles_profile_id ON placement_cycles(profile_id);
CREATE INDEX IF NOT EXISTS idx_placement_cycles_college_id ON placement_cycles(college_id);

-- ============================================================
-- PART 2: AGGREGATION RPCs
-- ============================================================

-- RPC: get_taxonomy_stats — category distribution + top skills by job count
CREATE OR REPLACE FUNCTION get_taxonomy_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM taxonomy_skills),
    'by_category', (
      SELECT COALESCE(json_object_agg(category, cnt), '{}'::json)
      FROM (
        SELECT category, COUNT(*) AS cnt
        FROM taxonomy_skills
        GROUP BY category
        ORDER BY cnt DESC
      ) sub
    ),
    'hot_technologies', (
      SELECT COUNT(*) FROM taxonomy_skills WHERE is_hot_technology = true
    ),
    'top_skills', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT skill_name AS name, COUNT(*) AS job_count
        FROM job_skills
        GROUP BY skill_name
        ORDER BY job_count DESC
        LIMIT 20
      ) t
    )
  );
$$;

-- RPC: get_analytics_overview — overview metrics (unique skill count)
CREATE OR REPLACE FUNCTION get_analytics_overview()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'unique_skills', (SELECT COUNT(DISTINCT skill_name) FROM job_skills)
  );
$$;

-- RPC: get_pipeline_health — pipeline status aggregation (last 30 days)
CREATE OR REPLACE FUNCTION get_pipeline_health()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT pipeline_type, status, COUNT(*) AS count
    FROM pipeline_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY pipeline_type, status
    ORDER BY pipeline_type, status
  ) t;
$$;

-- RPC: get_skill_export_stats — aggregated skill export data
CREATE OR REPLACE FUNCTION get_skill_export_stats(p_min_frequency int DEFAULT 2)
RETURNS TABLE(
  skill_name text,
  taxonomy_skill_id uuid,
  frequency bigint,
  avg_confidence numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    js.skill_name,
    js.taxonomy_skill_id,
    COUNT(*) AS frequency,
    ROUND(AVG(js.confidence_score)::numeric, 2) AS avg_confidence
  FROM job_skills js
  GROUP BY js.skill_name, js.taxonomy_skill_id
  HAVING COUNT(*) >= p_min_frequency
  ORDER BY frequency DESC;
$$;

-- RPC: get_survey_dashboard_stats — aggregated survey dashboard stats
CREATE OR REPLACE FUNCTION get_survey_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_respondents', (SELECT COUNT(*) FROM survey_respondents),
    'total_responses', (SELECT COUNT(*) FROM survey_responses),
    'total_ratings', (SELECT COUNT(*) FROM survey_skill_ratings),
    'respondents_with_name', (SELECT COUNT(*) FROM survey_respondents WHERE full_name IS NOT NULL),
    'respondents_with_login', (SELECT COUNT(*) FROM survey_respondents WHERE last_login_at IS NOT NULL),
    'sections_completion', (
      SELECT COALESCE(json_object_agg(section_key, cnt), '{}'::json)
      FROM (
        SELECT section_key, COUNT(DISTINCT respondent_id) AS cnt
        FROM survey_responses
        GROUP BY section_key
      ) sub
    ),
    'responses_by_industry', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT industry, COUNT(*) AS count
        FROM survey_respondents
        WHERE industry IS NOT NULL
        GROUP BY industry
        ORDER BY count DESC
      ) t
    ),
    'responses_by_company_size', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT company_size, COUNT(*) AS count
        FROM survey_respondents
        WHERE company_size IS NOT NULL
        GROUP BY company_size
        ORDER BY count DESC
      ) t
    ),
    'skill_ratings_summary', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT
          skill_name AS skill,
          ROUND(AVG(importance_rating)::numeric, 1) AS importance,
          ROUND(AVG(demonstration_rating)::numeric, 1) AS demonstration,
          ROUND(AVG(importance_rating - demonstration_rating)::numeric, 1) AS gap,
          COUNT(*) AS respondent_count
        FROM survey_skill_ratings
        GROUP BY skill_name
        ORDER BY gap DESC
      ) t
    )
  ) INTO result;
  RETURN result;
END;
$$;
