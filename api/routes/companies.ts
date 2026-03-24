import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission, requireReader, requireEditor } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleCompaniesRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "companies", res)) return;

  if (path.match(/^\/companies\/?$/) && req.method === "GET") {
    const { search, industry, size_range, headquarters_country, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("companies")
      .select("id, name, domain, website, linkedin_url, logo_url, industry, company_type, size_range, employee_count, headquarters_city, headquarters_country, enrichment_status, enrichment_score, created_at, updated_at", { count: "exact" });

    if (search) query = query.ilike("name", `%${search}%`);
    if (industry) query = query.eq("industry", industry);
    if (size_range) query = query.eq("size_range", size_range);
    if (headquarters_country) query = query.ilike("headquarters_country", `%${headquarters_country}%`);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  if (path === "/companies/auto-enrich" && req.method === "POST") {
    if (!requirePermission("companies", "write")(auth, res)) return;
    const { data: companies, error: compErr } = await supabase
      .from("companies")
      .select("id, name");
    if (compErr) return res.status(500).json({ error: compErr.message });

    let enriched = 0;
    for (const company of companies || []) {
      // Use RPC to get aggregated job stats instead of fetching all rows
      const { data: stats } = await supabase.rpc("get_company_job_stats", { p_company_id: company.id });
      const jobStats = Array.isArray(stats) ? stats[0] : stats;

      if (!jobStats || jobStats.job_count === 0) continue;

      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (jobStats.top_location) updates.headquarters_city = jobStats.top_location;

      const { data: current } = await supabase.from("companies").select("*").eq("id", company.id).single();
      if (current) {
        const fields = ["industry", "employee_count", "headquarters_city", "headquarters_country", "website", "linkedin_url", "description", "founded_year"];
        const merged = { ...current, ...updates };
        const filledCount = fields.filter(f => merged[f] != null && merged[f] !== "").length;
        updates.enrichment_score = Math.round((filledCount / fields.length) * 100);
        if (updates.enrichment_score > 0 && (!current.enrichment_status || current.enrichment_status === "pending")) {
          updates.enrichment_status = "partial";
        }
      }

      await supabase.from("companies").update(updates).eq("id", company.id);
      enriched++;
    }

    return res.json({ success: true, enriched, total: (companies || []).length });
  }

  if (path === "/companies/deduplicate" && req.method === "POST") {
    if (!requirePermission("companies", "full")(auth, res)) return;

    // Use RPC to find duplicate groups by normalized name instead of fetching all companies
    const { data: dupGroups, error: dupErr } = await supabase.rpc("find_duplicate_companies");
    if (dupErr) return res.status(500).json({ error: dupErr.message });

    let merged = 0;
    for (const group of dupGroups || []) {
      const companyIds: string[] = group.company_ids;
      if (companyIds.length <= 1) continue;

      // Fetch full details only for duplicate groups
      const { data: groupCompanies } = await supabase
        .from("companies")
        .select("id, name, name_normalized, domain, website, linkedin_url, logo_url, industry, sub_industry, company_type, founded_year, size_range, employee_count, headquarters_city, headquarters_state, headquarters_country, description, specialities, enrichment_score")
        .in("id", companyIds);

      if (!groupCompanies || groupCompanies.length <= 1) continue;

      groupCompanies.sort((a: any, b: any) => (b.enrichment_score || 0) - (a.enrichment_score || 0));
      const keeper = groupCompanies[0];
      const duplicates = groupCompanies.slice(1);

      const fillFields = ["domain", "website", "linkedin_url", "logo_url", "industry", "sub_industry", "company_type", "founded_year", "size_range", "employee_count", "headquarters_city", "headquarters_state", "headquarters_country", "description"];
      const updates: Record<string, any> = {};
      for (const field of fillFields) {
        if (!(keeper as any)[field]) {
          for (const dup of duplicates) {
            if ((dup as any)[field]) { updates[field] = (dup as any)[field]; break; }
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabase.from("companies").update(updates).eq("id", keeper.id);
      }

      for (const dup of duplicates) {
        await supabase.from("jobs").update({ company_id: keeper.id }).eq("company_id", dup.id);
        await supabase.from("companies").delete().eq("id", dup.id);
      }

      merged += duplicates.length;
    }

    return res.json({ success: true, merged, groups_found: (dupGroups || []).length });
  }

  if (path.match(/^\/companies\/[^/]+$/) && req.method === "PATCH") {
    if (!requireEditor(auth, "companies", res)) return;
    const id = path.split("/").pop();
    const allowedFields = [
      "industry", "sub_industry", "company_type", "size_range", "employee_count",
      "headquarters_city", "headquarters_state", "headquarters_country",
      "website", "linkedin_url", "description", "founded_year",
    ];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (req.body?.[field] !== undefined) updates[field] = req.body[field];
    }

    const { data: current } = await supabase.from("companies").select("*").eq("id", id).single();
    if (current) {
      const fields = ["industry", "employee_count", "headquarters_city", "headquarters_country", "website", "linkedin_url", "description", "founded_year"];
      const merged = { ...current, ...updates };
      const filledCount = fields.filter(f => merged[f] != null && merged[f] !== "").length;
      updates.enrichment_score = Math.round((filledCount / fields.length) * 100);
    }

    const { data, error } = await supabase.from("companies").update(updates).eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (path.match(/^\/companies\/[^/]+$/) && req.method === "GET") {
    const id = path.split("/").pop();
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
    if (error) return res.status(404).json({ error: "Company not found" });
    return res.json(data);
  }

  return undefined;
}
