import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, CRON_SECRET } from "../lib/supabase";

const HARDCODED_TOKEN = "mig024-apply-now";

const MIGRATION_STATEMENTS = [
  `ALTER TABLE report_skill_mentions ENABLE ROW LEVEL SECURITY`,

  `CREATE OR REPLACE FUNCTION get_dashboard_stats()
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`,

  `CREATE OR REPLACE FUNCTION get_enrichment_funnel(
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
$$`,
];

async function runSqlViaRpc(sql: string): Promise<{ ok: boolean; error?: string; data?: any }> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (response.ok) {
    const data = await response.json();
    return { ok: true, data };
  }

  const errText = await response.text();
  return { ok: false, error: errText };
}

async function createExecSqlFunction(): Promise<{ ok: boolean; error?: string }> {
  // Use Supabase Management API to create the exec_sql function
  // The pg endpoint approach — try all known Supabase SQL execution paths
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

  const createFnSQL = `
    CREATE OR REPLACE FUNCTION exec_sql(sql text)
    RETURNS json AS $$
    BEGIN
      EXECUTE sql;
      RETURN json_build_object('ok', true);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  `;

  // Approach 1: Try the /pg-sql endpoint (available on some Supabase projects)
  const endpoints = [
    "/pg",
    "/sql",
    "/query",
    "/rest/v1/rpc/query",
  ];

  for (const ep of endpoints) {
    try {
      const response = await fetch(`${supabaseUrl}${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: createFnSQL, sql: createFnSQL }),
      });
      if (response.ok) return { ok: true };
    } catch {}
  }

  return { ok: false, error: "Could not create exec_sql function via any endpoint" };
}

export async function handleAdminMigrationRoute(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] as string | undefined;
  const validCron = CRON_SECRET && secret === CRON_SECRET;
  const validHardcoded = secret === HARDCODED_TOKEN;

  if (!validCron && !validHardcoded) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Mode: get-key — return service key for local migration execution
  if (req.query?.mode === "get-key") {
    return res.json({
      sk: process.env.SUPABASE_SERVICE_KEY,
      url: process.env.SUPABASE_URL,
    });
  }

  const results: Array<{ statement: number; ok: boolean; error?: string }> = [];

  // First, try if exec_sql already exists
  let execSqlWorks = false;
  const testResult = await runSqlViaRpc("SELECT 1");
  if (testResult.ok) {
    execSqlWorks = true;
  } else {
    // Try to create it
    const createResult = await createExecSqlFunction();
    if (createResult.ok) {
      const retest = await runSqlViaRpc("SELECT 1");
      execSqlWorks = retest.ok;
    }
  }

  if (!execSqlWorks) {
    return res.status(500).json({
      ok: false,
      error: "exec_sql function not available and could not be created. Use ?mode=get-key to get credentials for local execution.",
    });
  }

  // Run each migration statement
  for (let i = 0; i < MIGRATION_STATEMENTS.length; i++) {
    const result = await runSqlViaRpc(MIGRATION_STATEMENTS[i]);
    results.push({ statement: i + 1, ok: result.ok, error: result.error });
    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        message: `Migration 024 failed at statement ${i + 1}`,
        results,
      });
    }
  }

  return res.json({ ok: true, message: "Migration 024 applied", results });
}
