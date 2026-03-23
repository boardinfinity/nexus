import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, APIFY_API_KEY, RAPIDAPI_KEY, OPENAI_API_KEY } from "../lib/supabase";
import type { AuthResult } from "../lib/auth";

export async function handleSettingsRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (path === "/providers/credits" && req.method === "GET") {
    const { data, error } = await supabase.from("provider_credits").select("*").order("provider");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path === "/monitoring/queue-stats" && req.method === "GET") {
    const { count: pendingCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "pending");
    const { count: processingCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "processing");
    const { count: deadLetterCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "dead_letter");
    return res.json({ pending: pendingCount || 0, processing: processingCount || 0, dead_letter: deadLetterCount || 0 });
  }

  if (path === "/monitoring/enrichment-logs" && req.method === "GET") {
    const { provider, status, entity_type, limit = "50" } = req.query as Record<string, string>;
    let query = supabase.from("enrichment_logs").select("*").order("created_at", { ascending: false }).limit(parseInt(limit));
    if (provider) query = query.eq("provider", provider);
    if (status) query = query.eq("status", status);
    if (entity_type) query = query.eq("entity_type", entity_type);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path === "/monitoring/pipeline-stats" && req.method === "GET") {
    const { data, error } = await supabase.rpc("get_pipeline_stats", { p_days: 30 });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path === "/settings/providers" && req.method === "GET") {
    return res.json({
      apify: { configured: !!APIFY_API_KEY, key_preview: APIFY_API_KEY ? `...${APIFY_API_KEY.slice(-6)}` : null },
      rapidapi: { configured: !!RAPIDAPI_KEY, key_preview: RAPIDAPI_KEY ? `...${RAPIDAPI_KEY.slice(-6)}` : null },
      apollo: { configured: false, key_preview: null },
      proxycurl: { configured: false, key_preview: null },
      hunter: { configured: false, key_preview: null },
      openai: { configured: !!OPENAI_API_KEY, key_preview: OPENAI_API_KEY ? `...${OPENAI_API_KEY.slice(-6)}` : null },
    });
  }

  if (path === "/migrate/csv-upload" && req.method === "POST") {
    const statements = [
      `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
      `CREATE TABLE IF NOT EXISTS csv_uploads (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      filename TEXT NOT NULL,
      source_type TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      processed_rows INTEGER DEFAULT 0,
      skipped_rows INTEGER DEFAULT 0,
      failed_rows INTEGER DEFAULT 0,
      error_log JSONB DEFAULT '[]',
      status TEXT DEFAULT 'processing',
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    )`,
      `CREATE INDEX IF NOT EXISTS idx_csv_uploads_status ON csv_uploads (status, created_at DESC)`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_normalized TEXT`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_name_normalized TEXT`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_unit TEXT`,
    ];
    const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
    for (const sql of statements) {
      const { error } = await supabase.rpc("exec_sql", { query: sql }).maybeSingle();
      if (error) {
        const { error: directError } = await supabase.from("csv_uploads").select("id").limit(0);
        results.push({ sql: sql.slice(0, 80), ok: !directError, error: error.message });
      } else {
        results.push({ sql: sql.slice(0, 80), ok: true });
      }
    }
    return res.json({ message: "Migration attempted", results });
  }

  if (path === "/migrate/company-dedup" && req.method === "POST") {
    const statements = [
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_normalized TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_companies_name_normalized ON companies(name_normalized)`,
      `UPDATE companies SET name_normalized = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(name), '\\s*(pvt\\.?\\s*ltd\\.?|ltd\\.?|inc\\.?|llc|corp\\.?|corporation|private\\s+limited|limited|india)\\s*$', '', 'gi'), '\\s+', ' ', 'g')) WHERE name_normalized IS NULL`,
    ];
    const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
    for (const sql of statements) {
      const { error } = await supabase.rpc("exec_sql", { query: sql }).maybeSingle();
      results.push({ sql: sql.slice(0, 80), ok: !error, error: error?.message });
    }
    return res.json({ message: "Company dedup migration attempted", results });
  }

  return undefined;
}
