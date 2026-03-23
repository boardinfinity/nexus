import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleCompaniesRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
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
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, location_city, location_state, location_country, employment_type")
        .eq("company_id", company.id);

      if (!jobs || jobs.length === 0) continue;

      const locationCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};
      for (const j of jobs) {
        if (j.location_city) locationCounts[j.location_city] = (locationCounts[j.location_city] || 0) + 1;
        if (j.location_country) countryCounts[j.location_country] = (countryCounts[j.location_country] || 0) + 1;
      }
      const topCity = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const topState = jobs.find(j => j.location_city === topCity)?.location_state || null;

      const jobIds = jobs.map(j => j.id);
      const { data: skills } = await supabase
        .from("job_skills")
        .select("skill_name")
        .in("job_id", jobIds.slice(0, 100));

      const skillCounts: Record<string, number> = {};
      for (const s of skills || []) {
        skillCounts[s.skill_name] = (skillCounts[s.skill_name] || 0) + 1;
      }
      const topSkills = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name]) => name);

      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (topCity) updates.headquarters_city = topCity;
      if (topState) updates.headquarters_state = topState;
      if (topCountry) updates.headquarters_country = topCountry;
      if (topSkills.length > 0) updates.specialities = topSkills;

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
    const { data: companies, error: fetchErr } = await supabase
      .from("companies")
      .select("id, name, name_normalized, domain, website, linkedin_url, logo_url, industry, sub_industry, company_type, founded_year, size_range, employee_count, headquarters_city, headquarters_state, headquarters_country, description, specialities, enrichment_score");
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    for (const c of companies || []) {
      if (!c.name_normalized && c.name) {
        const norm = c.name.toLowerCase()
          .replace(/\s*(pvt\.?\s*ltd\.?|ltd\.?|inc\.?|llc|corp\.?|corporation|private\s+limited|limited|india)\s*$/gi, "")
          .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        c.name_normalized = norm;
        await supabase.from("companies").update({ name_normalized: norm }).eq("id", c.id);
      }
    }

    const groups: Record<string, typeof companies> = {};
    for (const c of companies || []) {
      const key = c.name_normalized || c.name?.toLowerCase() || c.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }

    let merged = 0;
    for (const [, group] of Object.entries(groups)) {
      if (group.length <= 1) continue;

      group.sort((a: any, b: any) => (b.enrichment_score || 0) - (a.enrichment_score || 0));
      const keeper = group[0];
      const duplicates = group.slice(1);

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

    return res.json({ success: true, merged, groups_found: Object.values(groups).filter((g: any) => g.length > 1).length });
  }

  if (path.match(/^\/companies\/[^/]+$/) && req.method === "PATCH") {
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
