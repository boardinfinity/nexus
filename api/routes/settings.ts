import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, APIFY_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY } from "../lib/supabase";
import { MANDRILL_API_KEY, MANDRILL_FROM_EMAIL, MANDRILL_FROM_NAME } from "../lib/mailer";
import { type AuthResult, requireAdmin } from "../lib/auth";

export async function handleSettingsRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireAdmin(auth, res)) return;

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
    // Fetch live Apify usage in parallel with plan details
    let apifyUsage: { used?: number; limit?: number; plan?: string } = {};
    if (APIFY_API_KEY) {
      try {
        const [limitsRes, userRes] = await Promise.all([
          fetch(`https://api.apify.com/v2/users/me/limits?token=${APIFY_API_KEY}`),
          fetch(`https://api.apify.com/v2/users/me?token=${APIFY_API_KEY}`),
        ]);
        if (limitsRes.ok && userRes.ok) {
          const limitsData = await limitsRes.json();
          const userData = await userRes.json();
          apifyUsage = {
            used: limitsData?.data?.current?.monthlyUsageUsd || 0,
            limit: limitsData?.data?.limits?.maxMonthlyUsageUsd || 0,
            plan: userData?.data?.plan?.id || null,
          };
        }
      } catch {}
    }
    return res.json({
      apify: {
        configured: !!APIFY_API_KEY,
        key_preview: APIFY_API_KEY ? `${APIFY_API_KEY.slice(0, 8)}…${APIFY_API_KEY.slice(-6)}` : null,
        usage: apifyUsage,
      },
      openai: {
        configured: !!OPENAI_API_KEY,
        key_preview: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 8)}…${OPENAI_API_KEY.slice(-6)}` : null,
      },
      anthropic: {
        configured: !!ANTHROPIC_API_KEY,
        key_preview: ANTHROPIC_API_KEY ? `${ANTHROPIC_API_KEY.slice(0, 8)}…${ANTHROPIC_API_KEY.slice(-6)}` : null,
      },
      mandrill: {
        configured: !!MANDRILL_API_KEY,
        key_preview: MANDRILL_API_KEY ? `${MANDRILL_API_KEY.slice(0, 6)}…${MANDRILL_API_KEY.slice(-4)}` : null,
        from_email: MANDRILL_FROM_EMAIL,
        from_name: MANDRILL_FROM_NAME,
      },
    });
  }

  return undefined;
}
