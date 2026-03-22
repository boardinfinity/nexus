-- Jobs by source (GROUP BY in Postgres)
CREATE OR REPLACE FUNCTION get_jobs_by_source(p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('source', source, 'count', cnt))
    FROM (
      SELECT COALESCE(source, 'unknown') as source, count(*) as cnt
      FROM jobs
      WHERE (p_source IS NULL OR source = p_source)
        AND (p_country IS NULL OR location_country = p_country)
        AND (p_status IS NULL OR enrichment_status = p_status)
        AND (p_date_from IS NULL OR created_at >= p_date_from)
        AND (p_date_to IS NULL OR created_at <= p_date_to)
      GROUP BY source
      ORDER BY cnt DESC
    ) t
  );
END;
$$ LANGUAGE plpgsql;

-- Jobs by region
CREATE OR REPLACE FUNCTION get_jobs_by_region(p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('country', location_country, 'count', cnt))
    FROM (
      SELECT location_country, count(*) as cnt
      FROM jobs
      WHERE location_country IS NOT NULL
        AND (p_source IS NULL OR source = p_source)
        AND (p_country IS NULL OR location_country = p_country)
        AND (p_status IS NULL OR enrichment_status = p_status)
        AND (p_date_from IS NULL OR created_at >= p_date_from)
        AND (p_date_to IS NULL OR created_at <= p_date_to)
      GROUP BY location_country
      ORDER BY cnt DESC
      LIMIT 10
    ) t
  );
END;
$$ LANGUAGE plpgsql;

-- Jobs by role (top 30 titles)
CREATE OR REPLACE FUNCTION get_jobs_by_role(p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('title', title, 'count', cnt))
    FROM (
      SELECT title, count(*) as cnt
      FROM jobs
      WHERE title IS NOT NULL
        AND (p_source IS NULL OR source = p_source)
        AND (p_country IS NULL OR location_country = p_country)
        AND (p_status IS NULL OR enrichment_status = p_status)
        AND (p_date_from IS NULL OR created_at >= p_date_from)
        AND (p_date_to IS NULL OR created_at <= p_date_to)
      GROUP BY title
      ORDER BY cnt DESC
      LIMIT 30
    ) t
  );
END;
$$ LANGUAGE plpgsql;

-- Enrichment funnel
CREATE OR REPLACE FUNCTION get_enrichment_funnel(p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('status', enrichment_status, 'count', cnt))
    FROM (
      SELECT COALESCE(enrichment_status, 'unknown') as enrichment_status, count(*) as cnt
      FROM jobs
      WHERE (p_source IS NULL OR source = p_source)
        AND (p_country IS NULL OR location_country = p_country)
        AND (p_status IS NULL OR enrichment_status = p_status)
        AND (p_date_from IS NULL OR created_at >= p_date_from)
        AND (p_date_to IS NULL OR created_at <= p_date_to)
      GROUP BY enrichment_status
    ) t
  );
END;
$$ LANGUAGE plpgsql;

-- Timeline (jobs per day/week)
CREATE OR REPLACE FUNCTION get_jobs_timeline(p_days INTEGER DEFAULT 30, p_granularity TEXT DEFAULT 'day', p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('date', dt, 'count', cnt))
    FROM (
      SELECT date_trunc(p_granularity, created_at)::date as dt, count(*) as cnt
      FROM jobs
      WHERE created_at >= now() - make_interval(days => p_days)
        AND (p_source IS NULL OR source = p_source)
        AND (p_country IS NULL OR location_country = p_country)
        AND (p_status IS NULL OR enrichment_status = p_status)
        AND (p_date_from IS NULL OR created_at >= p_date_from)
        AND (p_date_to IS NULL OR created_at <= p_date_to)
      GROUP BY dt
      ORDER BY dt
    ) t
  );
END;
$$ LANGUAGE plpgsql;

-- Top skills
CREATE OR REPLACE FUNCTION get_top_skills(p_limit INTEGER DEFAULT 20, p_source TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL, p_date_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object('skill', skill_name, 'count', cnt))
    FROM (
      SELECT js.skill_name, count(*) as cnt
      FROM job_skills js
      JOIN jobs j ON js.job_id = j.id
      WHERE (p_source IS NULL OR j.source = p_source)
        AND (p_country IS NULL OR j.location_country = p_country)
        AND (p_status IS NULL OR j.enrichment_status = p_status)
        AND (p_date_from IS NULL OR j.created_at >= p_date_from)
        AND (p_date_to IS NULL OR j.created_at <= p_date_to)
      GROUP BY js.skill_name
      ORDER BY cnt DESC
      LIMIT p_limit
    ) t
  );
END;
$$ LANGUAGE plpgsql;
