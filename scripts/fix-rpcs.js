#!/usr/bin/env node
/**
 * Fix missing RPCs by connecting directly to PostgreSQL via the `pg` module.
 *
 * Background: Migrations 018 and 020 were applied via `exec_sql`, but
 * get_colleges_with_stats referenced a non-existent `catalog_status` column,
 * causing it (and all subsequent RPCs) to silently fail. This script
 * recreates the 8 missing functions with the bug fixed.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/fix-rpcs.js
 *
 * Or set DATABASE_URL in .env at the project root.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Load .env if present
try {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (_) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "ERROR: DATABASE_URL must be set.\n" +
      "  Example: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
  );
  process.exit(1);
}

// ---------- SQL for each missing RPC ----------

const RPC_STATEMENTS = [
  {
    name: "get_colleges_with_stats",
    sql: `
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;`,
  },
  {
    name: "get_colleges_count",
    sql: `
CREATE OR REPLACE FUNCTION get_colleges_count(p_search text DEFAULT NULL)
RETURNS bigint AS $$
  SELECT COUNT(*) FROM colleges
  WHERE (p_search IS NULL OR name ILIKE '%' || p_search || '%');
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;`,
  },
  {
    name: "get_company_job_stats",
    sql: `
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
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;`,
  },
  {
    name: "get_taxonomy_stats",
    sql: `
CREATE OR REPLACE FUNCTION get_taxonomy_stats()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
$$;`,
  },
  {
    name: "get_analytics_overview",
    sql: `
CREATE OR REPLACE FUNCTION get_analytics_overview()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'unique_skills', (SELECT COUNT(DISTINCT skill_name) FROM job_skills)
  );
$$;`,
  },
  {
    name: "get_pipeline_health",
    sql: `
CREATE OR REPLACE FUNCTION get_pipeline_health()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT pipeline_type, status, COUNT(*) AS count
    FROM pipeline_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY pipeline_type, status
    ORDER BY pipeline_type, status
  ) t;
$$;`,
  },
  {
    name: "get_skill_export_stats",
    sql: `
CREATE OR REPLACE FUNCTION get_skill_export_stats(p_min_frequency int DEFAULT 2)
RETURNS TABLE(
  skill_name text,
  taxonomy_skill_id uuid,
  frequency bigint,
  avg_confidence numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
$$;`,
  },
  {
    name: "get_survey_dashboard_stats",
    sql: `
CREATE OR REPLACE FUNCTION get_survey_dashboard_stats()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
$$;`,
  },
];

// ---------- Main ----------

async function main() {
  console.log("Connecting to PostgreSQL...");
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.\n");

  let success = 0;
  let failed = 0;

  for (const rpc of RPC_STATEMENTS) {
    process.stdout.write(`Creating ${rpc.name}... `);
    try {
      await client.query(rpc.sql);
      console.log("OK");
      success++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed out of ${RPC_STATEMENTS.length}.`);

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
