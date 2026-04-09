import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requireReader } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleJobsRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "jobs", res)) return;

  if (path.match(/^\/jobs\/?$/) && req.method === "GET") {
    const { search, source, enrichment_status, seniority_level, employment_type, location_country, has_description, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("jobs")
      .select("id, external_id, title, company_name, location_raw, location_city, location_country, source, seniority_level, employment_type, salary_min, salary_max, salary_currency, posted_at, enrichment_status, job_status, status_checked_at, source_url, created_at", { count: "exact" });

    if (search) query = query.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`);
    if (has_description === "true") query = query.not("description", "is", null);
    if (source) query = query.ilike("source", source);
    if (enrichment_status) query = query.ilike("enrichment_status", enrichment_status);
    if (seniority_level) query = query.eq("seniority_level", seniority_level);
    if (employment_type) query = query.eq("employment_type", employment_type);
    if (location_country) query = query.ilike("location_country", `%${location_country}%`);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  if (path.match(/^\/jobs\/[^/]+\/skills$/) && req.method === "GET") {
    const jobId = path.split("/")[2];
    const { data, error } = await supabase
      .from("job_skills")
      .select("*, taxonomy_skill:taxonomy_skills(id, name, category, subcategory)")
      .eq("job_id", jobId)
      .order("confidence_score", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (path.match(/^\/jobs\/[^/]+$/) && req.method === "GET") {
    const id = path.split("/").pop();
    const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (error) return res.status(404).json({ error: "Job not found" });

    const { data: skills } = await supabase.from("job_skills").select("*").eq("job_id", id);
    return res.json({ ...data, skills: skills || [] });
  }

  // ── Add a new job manually from JD Analyzer ─────────────────────────────────
  if (path === "/jobs/add" && req.method === "POST") {
    if (!requireEditor(auth, "jobs", res)) return;
    const { title, company_name, description, location_raw } = req.body || {};
    if (!title || !company_name) return res.status(400).json({ error: "title and company_name required" });
    const { data, error } = await supabase.from("jobs").insert({
      title: title.trim(),
      company_name: company_name.trim(),
      description: description || null,
      location_raw: location_raw || null,
      source: "manual",
      enrichment_status: "partial",
      created_at: new Date().toISOString(),
    }).select("id, title, company_name").single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }


  return undefined;
}
