import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, APIFY_API_KEY, RAPIDAPI_KEY, OPENAI_API_KEY } from "../lib/supabase";
import { type AuthResult, requireAdmin } from "../lib/auth";

export async function handleSettingsRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireAdmin(auth, res)) return;

  if (path === "/providers/credits" && req.method === "GET") {
    const { data, error } = await supabase.from("provider_credits").select("*").order("provider");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path === "/monitoring/queue-stats" && req.method === "GET") {
    const [{ count: pendingCount }, { count: processingCount }, { count: deadLetterCount }] = await Promise.all([
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "processing"),
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "dead_letter"),
    ]);
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

  return undefined;
}
