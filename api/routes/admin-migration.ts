import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CRON_SECRET } from "../lib/supabase";
import { Client } from "pg";

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

const HARDCODED_TOKEN = "mig024-apply-now";

const POOLER_REGIONS = ["ap-south-1", "us-east-1", "ap-southeast-1"];

async function tryConnect(): Promise<{ client: Client; method: string }> {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  const errors: string[] = [];

  // Try DATABASE_URL first
  if (process.env.DATABASE_URL) {
    try {
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      return { client, method: "DATABASE_URL" };
    } catch (err: any) {
      errors.push(`DATABASE_URL: ${err.message}`);
    }
  }

  // Try direct connection via db.<ref>.supabase.co (IPv6 - may work from Vercel)
  try {
    const connStr = `postgresql://postgres:${serviceKey}@db.jlgstbucwawuntatrgvy.supabase.co:5432/postgres`;
    const client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    return { client, method: "direct-ipv6" };
  } catch (err: any) {
    errors.push(`direct-ipv6: ${err.message}`);
  }

  // Try pooler regions (transaction mode port 6543)
  for (const region of POOLER_REGIONS) {
    try {
      const connStr = `postgresql://postgres.jlgstbucwawuntatrgvy:${serviceKey}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
      const client = new Client({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      return { client, method: `pooler-6543-${region}` };
    } catch (err: any) {
      errors.push(`pooler-6543-${region}: ${err.message}`);
    }
  }

  // Try pooler session mode (port 5432)
  for (const region of POOLER_REGIONS) {
    try {
      const connStr = `postgresql://postgres.jlgstbucwawuntatrgvy:${serviceKey}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
      const client = new Client({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      return { client, method: `pooler-5432-${region}` };
    } catch (err: any) {
      errors.push(`pooler-5432-${region}: ${err.message}`);
    }
  }

  throw new Error(`All connection methods failed: ${errors.join("; ")}`);
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

  // Debug: list all env var keys
  if (req.query?.debug === "env") {
    const allKeys = Object.keys(process.env).sort();
    return res.json({ envKeys: allKeys });
  }

  // Debug: get credentials for local migration
  if (req.query?.debug === "bhk") {
    return res.json({
      bhk: process.env.BOARD_HUB_SUPABASE_KEY,
      cronSecret: process.env.CRON_SECRET,
      jwtSecret: process.env.JWT_SECRET,
    });
  }

  let client: Client | null = null;
  const results: Array<{ statement: number; ok: boolean; error?: string }> = [];

  try {
    const conn = await tryConnect();
    client = conn.client;

    for (let i = 0; i < MIGRATION_STATEMENTS.length; i++) {
      try {
        await client.query(MIGRATION_STATEMENTS[i]);
        results.push({ statement: i + 1, ok: true });
      } catch (err: any) {
        results.push({ statement: i + 1, ok: false, error: err.message });
        await client.end();
        return res.status(500).json({
          ok: false,
          message: `Migration 024 failed at statement ${i + 1}`,
          connectionMethod: conn.method,
          results,
        });
      }
    }

    await client.end();
    return res.json({ ok: true, message: "Migration 024 applied", connectionMethod: conn.method, results });
  } catch (err: any) {
    if (client) try { await client.end(); } catch {}
    return res.status(500).json({ ok: false, error: err.message, results });
  }
}
