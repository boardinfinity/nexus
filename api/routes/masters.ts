import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requireReader, requireAdmin } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleMastersRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {

  // ── GET /masters/summary ──────────────────────────────────────────
  if (path === "/masters/summary" && req.method === "GET") {
    if (!requireReader(auth, "masters", res)) return;
    try {
      const [roles, skills, families, industries, functions, colleges] = await Promise.all([
        supabase.from("job_roles").select("*", { count: "exact", head: true }),
        supabase.from("taxonomy_skills").select("*", { count: "exact", head: true }),
        supabase.from("job_families").select("*", { count: "exact", head: true }),
        supabase.from("job_industries").select("*", { count: "exact", head: true }),
        supabase.from("job_functions").select("*", { count: "exact", head: true }),
        supabase.from("colleges").select("*", { count: "exact", head: true }),
      ]);
      return res.json({
        job_roles: roles.count ?? 0,
        skills: skills.count ?? 0,
        job_families: families.count ?? 0,
        job_industries: industries.count ?? 0,
        job_functions: functions.count ?? 0,
        colleges: colleges.count ?? 0,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET /masters/job-roles ────────────────────────────────────────
  if (path === "/masters/job-roles" && req.method === "GET") {
    if (!requireReader(auth, "masters", res)) return;
    const { data, error } = await supabase
      .from("job_roles")
      .select("id, name, family, synonyms, airtable_id, created_at")
      .order("family")
      .order("name");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // ── POST /masters/job-roles ───────────────────────────────────────
  if (path === "/masters/job-roles" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;
    const { name, family, synonyms } = req.body;
    if (!name || !family) return res.status(400).json({ error: "name and family are required" });
    const { data, error } = await supabase
      .from("job_roles")
      .insert({ name, family, synonyms: synonyms || [] })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT /masters/job-roles/:id ────────────────────────────────────
  const putMatch = path.match(/^\/masters\/job-roles\/([a-f0-9-]+)$/);
  if (putMatch && req.method === "PUT") {
    if (!requireAdmin(auth, res)) return;
    const id = putMatch[1];
    const { name, family, synonyms } = req.body;
    const { data, error } = await supabase
      .from("job_roles")
      .update({ name, family, synonyms })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE /masters/job-roles/:id ─────────────────────────────────
  const delMatch = path.match(/^\/masters\/job-roles\/([a-f0-9-]+)$/);
  if (delMatch && req.method === "DELETE") {
    if (!requireAdmin(auth, res)) return;
    const id = delMatch[1];
    // Check FK references
    const { count } = await supabase
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("job_role_id", id);
    if (count && count > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${count} jobs reference this role`,
        referenced_jobs: count,
      });
    }
    const { error } = await supabase.from("job_roles").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // ── GET /masters/colleges ────────────────────────────────────────
  if (path === "/masters/colleges" && req.method === "GET") {
    if (!requireReader(auth, "masters", res)) return;
    const { country, degree_level, tier, state, search } = req.query as Record<string, string | undefined>;
    let query = supabase
      .from("colleges")
      .select("id, name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug, website, created_at, updated_at");
    if (country) query = query.eq("country", country);
    if (degree_level) query = query.eq("degree_level", degree_level);
    if (tier) query = query.eq("tier", tier);
    if (state) query = query.eq("state", state);
    if (search) query = query.ilike("name", `%${search}%`);
    query = query.order("nirf_rank", { ascending: true, nullsFirst: false });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // ── POST /masters/colleges ───────────────────────────────────────
  if (path === "/masters/colleges" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;
    const { name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug, website } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const { data, error } = await supabase
      .from("colleges")
      .insert({ name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug, website })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT /masters/colleges/:id ────────────────────────────────────
  const collegePutMatch = path.match(/^\/masters\/colleges\/([a-f0-9-]+)$/);
  if (collegePutMatch && req.method === "PUT") {
    if (!requireAdmin(auth, res)) return;
    const id = collegePutMatch[1];
    const { name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug, website } = req.body;
    const { data, error } = await supabase
      .from("colleges")
      .update({ name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug, website, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE /masters/colleges/:id ─────────────────────────────────
  const collegeDelMatch = path.match(/^\/masters\/colleges\/([a-f0-9-]+)$/);
  if (collegeDelMatch && req.method === "DELETE") {
    if (!requireAdmin(auth, res)) return;
    const id = collegeDelMatch[1];
    // Check FK references in alumni table
    const { count } = await supabase
      .from("alumni")
      .select("*", { count: "exact", head: true })
      .eq("college_id", id);
    if (count && count > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${count} alumni reference this college`,
        referenced_alumni: count,
      });
    }
    const { error } = await supabase.from("colleges").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return undefined;
}
