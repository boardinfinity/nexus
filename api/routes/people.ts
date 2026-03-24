import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { type AuthResult, requireReader } from "../lib/auth";

export async function handlePeopleRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "people", res)) return;

  if (path.match(/^\/people\/?$/) && req.method === "GET") {
    const { search, seniority, function: fn, is_recruiter, is_hiring_manager, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("people")
      .select("id, full_name, first_name, last_name, email, linkedin_url, current_title, current_company_id, seniority, function, location_city, location_country, is_hiring_manager, is_recruiter, enrichment_status, enrichment_score, created_at, company:companies!current_company_id(name)", { count: "exact" });

    if (search) query = query.ilike("full_name", `%${search}%`);
    if (seniority) query = query.eq("seniority", seniority);
    if (fn) query = query.eq("function", fn);
    if (is_recruiter === "true") query = query.eq("is_recruiter", true);
    if (is_hiring_manager === "true") query = query.eq("is_hiring_manager", true);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  if (path.match(/^\/people\/[^/]+$/) && req.method === "GET") {
    const id = path.split("/").pop();
    const { data, error } = await supabase.from("people").select("*").eq("id", id).single();
    if (error) return res.status(404).json({ error: "Person not found" });
    return res.json(data);
  }

  if (path.match(/^\/alumni\/?$/) && req.method === "GET") {
    const { search, university_name, graduation_year, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("alumni")
      .select(`
      id, university_name, university_id, degree, field_of_study, graduation_year, start_year, current_status, created_at,
      person:people!alumni_person_id_fkey(id, full_name, first_name, last_name, email, linkedin_url, current_title, location_city, location_country)
    `, { count: "exact" });

    if (university_name) query = query.ilike("university_name", `%${university_name}%`);
    if (graduation_year) query = query.eq("graduation_year", parseInt(graduation_year));

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  return undefined;
}
