import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requireReader } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleDashboardRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "dashboard", res)) return;

  if (path === "/dashboard/stats" && req.method === "GET") {
    const { data, error } = await supabase.rpc("get_dashboard_stats");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || {
      total_jobs: 0, total_companies: 0, total_people: 0, total_alumni: 0,
      total_skills: 0, jobs_today: 0, jobs_this_week: 0, jobs_this_month: 0,
      enrichment_complete_pct: 0, active_pipelines: 0, pending_queue: 0, failed_queue: 0
    });
  }

  if (path === "/dashboard/recent-jobs" && req.method === "GET") {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, company_name, location_raw, source, seniority_level, posted_at, enrichment_status, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path === "/dashboard/pipeline-activity" && req.method === "GET") {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  return undefined;
}
