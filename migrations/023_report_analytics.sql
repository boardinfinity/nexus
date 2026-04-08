-- Migration 023: Report Analytics RPCs
-- Provides analytics functions for the Reports Analytics Dashboard

-- RPC 1: Overview KPIs
CREATE OR REPLACE FUNCTION get_reports_analytics_overview()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'total_reports', (SELECT COUNT(*) FROM secondary_reports WHERE processing_status = 'completed'),
    'unique_skills', (SELECT COUNT(DISTINCT sm.skill_name) FROM report_skill_mentions sm JOIN secondary_reports r ON r.id = sm.report_id WHERE r.processing_status = 'completed'),
    'total_findings', (SELECT COALESCE(SUM(jsonb_array_length(key_findings)), 0) FROM secondary_reports WHERE processing_status = 'completed' AND key_findings IS NOT NULL),
    'year_min', (SELECT MIN(report_year) FROM secondary_reports WHERE processing_status = 'completed'),
    'year_max', (SELECT MAX(report_year) FROM secondary_reports WHERE processing_status = 'completed'),
    'growing_signals', (SELECT COUNT(*) FROM report_skill_mentions sm JOIN secondary_reports r ON r.id = sm.report_id WHERE r.processing_status = 'completed' AND sm.growth_indicator IN ('growing', 'emerging')),
    'declining_signals', (SELECT COUNT(*) FROM report_skill_mentions sm JOIN secondary_reports r ON r.id = sm.report_id WHERE r.processing_status = 'completed' AND sm.growth_indicator = 'declining'),
    'source_count', (SELECT COUNT(DISTINCT source_org) FROM secondary_reports WHERE processing_status = 'completed')
  ) INTO result;
  RETURN result;
END; $$;

-- RPC 2: Skill Consensus
CREATE OR REPLACE FUNCTION get_report_skill_consensus(p_filter TEXT DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS TABLE(
  skill_name TEXT, total_mentions BIGINT, source_count BIGINT, report_count BIGINT,
  growing_count BIGINT, declining_count BIGINT, emerging_count BIGINT, stable_count BIGINT,
  dominant_signal TEXT, sources TEXT[], sample_data_point TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sm.skill_name,
    COUNT(*) as total_mentions,
    COUNT(DISTINCT r.source_org) as source_count,
    COUNT(DISTINCT r.id) as report_count,
    COUNT(*) FILTER (WHERE sm.growth_indicator = 'growing') as growing_count,
    COUNT(*) FILTER (WHERE sm.growth_indicator = 'declining') as declining_count,
    COUNT(*) FILTER (WHERE sm.growth_indicator = 'emerging') as emerging_count,
    COUNT(*) FILTER (WHERE sm.growth_indicator IN ('stable', 'reducing')) as stable_count,
    CASE
      WHEN COUNT(*) FILTER (WHERE sm.growth_indicator IN ('growing','emerging')) >
           COUNT(*) FILTER (WHERE sm.growth_indicator IN ('declining','stable','reducing'))
      THEN 'growing'
      WHEN COUNT(*) FILTER (WHERE sm.growth_indicator = 'declining') > 0 THEN 'declining'
      ELSE 'stable'
    END as dominant_signal,
    array_agg(DISTINCT r.source_org) as sources,
    MAX(sm.data_point) FILTER (WHERE sm.data_point IS NOT NULL) as sample_data_point
  FROM report_skill_mentions sm
  JOIN secondary_reports r ON r.id = sm.report_id
  WHERE r.processing_status = 'completed'
    AND sm.skill_name IS NOT NULL
    AND (p_filter IS NULL OR
         (p_filter = 'growing' AND sm.growth_indicator IN ('growing','emerging')) OR
         (p_filter = 'declining' AND sm.growth_indicator = 'declining') OR
         (p_filter = 'stable' AND sm.growth_indicator IN ('stable','reducing')))
  GROUP BY sm.skill_name
  ORDER BY source_count DESC, total_mentions DESC
  LIMIT p_limit;
$$;

-- RPC 3: Skills Timeline
CREATE OR REPLACE FUNCTION get_report_skills_timeline()
RETURNS TABLE(year INT, rising_count BIGINT, declining_count BIGINT, total_count BIGINT, reports TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.report_year as year,
    COUNT(*) FILTER (WHERE sm.growth_indicator IN ('growing','emerging')) as rising_count,
    COUNT(*) FILTER (WHERE sm.growth_indicator = 'declining') as declining_count,
    COUNT(*) as total_count,
    array_agg(DISTINCT r.title) as reports
  FROM report_skill_mentions sm
  JOIN secondary_reports r ON r.id = sm.report_id
  WHERE r.processing_status = 'completed' AND r.report_year IS NOT NULL
  GROUP BY r.report_year
  ORDER BY r.report_year;
$$;

-- RPC 4: Key Findings
CREATE OR REPLACE FUNCTION get_report_key_findings(
  p_category TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_min_confidence NUMERIC DEFAULT 0,
  p_limit INT DEFAULT 100
)
RETURNS TABLE(
  report_id UUID, report_title TEXT, source_org TEXT, report_year INT, region TEXT,
  finding TEXT, category TEXT, confidence NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id as report_id,
    r.title as report_title,
    r.source_org,
    r.report_year,
    r.region,
    (f->>'finding') as finding,
    (f->>'category') as category,
    ((f->>'confidence')::numeric) as confidence
  FROM secondary_reports r,
  jsonb_array_elements(r.key_findings) f
  WHERE r.processing_status = 'completed'
    AND r.key_findings IS NOT NULL
    AND (p_category IS NULL OR (f->>'category') = p_category)
    AND (p_source IS NULL OR r.source_org = p_source)
    AND (f->>'confidence')::numeric >= p_min_confidence
  ORDER BY ((f->>'confidence')::numeric) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- RPC 5: Sources Summary
CREATE OR REPLACE FUNCTION get_report_sources_summary()
RETURNS TABLE(
  source_org TEXT, report_count BIGINT, year_min INT, year_max INT,
  top_skills TEXT[], skill_count BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.source_org,
    COUNT(DISTINCT r.id) as report_count,
    MIN(r.report_year) as year_min,
    MAX(r.report_year) as year_max,
    array_agg(DISTINCT sm.skill_name ORDER BY sm.skill_name)[:5] as top_skills,
    COUNT(DISTINCT sm.skill_name) as skill_count
  FROM secondary_reports r
  LEFT JOIN report_skill_mentions sm ON sm.report_id = r.id
  WHERE r.processing_status = 'completed' AND r.source_org IS NOT NULL
  GROUP BY r.source_org
  ORDER BY report_count DESC, skill_count DESC;
$$;
