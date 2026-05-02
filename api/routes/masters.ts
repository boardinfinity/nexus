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
      const [roles, skills, families, industries, functions, colleges, buckets] = await Promise.all([
        supabase.from("job_roles").select("*", { count: "exact", head: true }),
        supabase.from("taxonomy_skills").select("*", { count: "exact", head: true }),
        supabase.from("job_families").select("*", { count: "exact", head: true }),
        supabase.from("job_industries").select("*", { count: "exact", head: true }),
        supabase.from("job_functions").select("*", { count: "exact", head: true }),
        supabase.from("colleges").select("*", { count: "exact", head: true }),
        supabase.from("job_buckets").select("*", { count: "exact", head: true }),
      ]);
      return res.json({
        job_roles: roles.count ?? 0,
        skills: skills.count ?? 0,
        job_families: families.count ?? 0,
        job_industries: industries.count ?? 0,
        job_functions: functions.count ?? 0,
        colleges: colleges.count ?? 0,
        job_buckets: buckets.count ?? 0,
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

  // ── GET /masters/buckets ─────────────────────────────────────────
  // Lists job_buckets with related function/family/industry names and
  // alias counts. Reads via service-role supabase client and therefore
  // bypasses RLS — gating is enforced via requireAdmin so candidate
  // (non-validated) buckets stay admin-only.
  if (path === "/masters/buckets" && req.method === "GET") {
    if (!requireAdmin(auth, res)) return;
    try {
      const { status, scope, geography, search } = req.query as Record<string, string | undefined>;

      let query = supabase
        .from("job_buckets")
        .select(`
          id, bucket_code, name, description, bucket_scope,
          function_id, family_id, industry_id,
          seniority_level, standardized_title, company_type, geography_scope,
          nature_of_work, exclusion_rules, status, confidence_threshold,
          mention_count, company_count, evidence_count,
          source, first_seen_at, validated_at, validated_by,
          deprecated_at, merged_into_id, created_by, updated_by,
          created_at, updated_at
        `);

      if (status && status !== "all") query = query.eq("status", status);
      if (scope && scope !== "all") query = query.eq("bucket_scope", scope);
      if (geography && geography !== "all") query = query.eq("geography_scope", geography);
      if (search) {
        const s = search.replace(/[%_]/g, m => `\\${m}`);
        query = query.or(
          `bucket_code.ilike.%${s}%,name.ilike.%${s}%,standardized_title.ilike.%${s}%,company_type.ilike.%${s}%,geography_scope.ilike.%${s}%`
        );
      }

      query = query.order("status", { ascending: true }).order("name");
      const { data: buckets, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Lookups: functions / families / industries
      const functionIds = Array.from(new Set((buckets || []).map((b: any) => b.function_id).filter(Boolean)));
      const familyIds = Array.from(new Set((buckets || []).map((b: any) => b.family_id).filter(Boolean)));
      const industryIds = Array.from(new Set((buckets || []).map((b: any) => b.industry_id).filter(Boolean)));

      const [funcRes, famRes, indRes] = await Promise.all([
        functionIds.length ? supabase.from("job_functions").select("id, name").in("id", functionIds) : Promise.resolve({ data: [], error: null }),
        familyIds.length ? supabase.from("job_families").select("id, name").in("id", familyIds) : Promise.resolve({ data: [], error: null }),
        industryIds.length ? supabase.from("job_industries").select("id, name").in("id", industryIds) : Promise.resolve({ data: [], error: null }),
      ]);

      const funcMap = new Map<string, string>((funcRes.data || []).map((r: any) => [r.id, r.name]));
      const famMap = new Map<string, string>((famRes.data || []).map((r: any) => [r.id, r.name]));
      const indMap = new Map<string, string>((indRes.data || []).map((r: any) => [r.id, r.name]));

      // Per-bucket alias and job counts (best-effort — don't fail the list if these error).
      const bucketIds = (buckets || []).map((b: any) => b.id);
      const aliasCounts = new Map<string, number>();
      const jobCounts = new Map<string, number>();

      if (bucketIds.length > 0) {
        const { data: aliasRows } = await supabase
          .from("job_bucket_aliases")
          .select("bucket_id")
          .in("bucket_id", bucketIds);
        for (const r of aliasRows || []) {
          aliasCounts.set(r.bucket_id, (aliasCounts.get(r.bucket_id) || 0) + 1);
        }

        const { data: jobRows } = await supabase
          .from("jobs")
          .select("bucket_id")
          .in("bucket_id", bucketIds);
        for (const r of jobRows || []) {
          if (r.bucket_id) jobCounts.set(r.bucket_id, (jobCounts.get(r.bucket_id) || 0) + 1);
        }
      }

      const enriched = (buckets || []).map((b: any) => ({
        ...b,
        function_name: b.function_id ? (funcMap.get(b.function_id) ?? null) : null,
        family_name: b.family_id ? (famMap.get(b.family_id) ?? null) : null,
        industry_name: b.industry_id ? (indMap.get(b.industry_id) ?? null) : null,
        alias_count: aliasCounts.get(b.id) ?? 0,
        job_count: jobCounts.get(b.id) ?? 0,
      }));

      return res.json(enriched);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET /masters/buckets/:id ─────────────────────────────────────
  const bucketGetMatch = path.match(/^\/masters\/buckets\/([a-f0-9-]+)$/);
  if (bucketGetMatch && req.method === "GET") {
    if (!requireAdmin(auth, res)) return;
    const id = bucketGetMatch[1];
    try {
      const { data: bucket, error } = await supabase
        .from("job_buckets")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return res.status(404).json({ error: error.message });

      const [funcRes, famRes, indRes, aliasRes, overlayRes, evCount, skillCount, jobCount] = await Promise.all([
        bucket.function_id ? supabase.from("job_functions").select("id, name").eq("id", bucket.function_id).maybeSingle() : Promise.resolve({ data: null }),
        bucket.family_id ? supabase.from("job_families").select("id, name").eq("id", bucket.family_id).maybeSingle() : Promise.resolve({ data: null }),
        bucket.industry_id ? supabase.from("job_industries").select("id, name").eq("id", bucket.industry_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("job_bucket_aliases").select("id, alias, alias_norm, source, confidence, created_at").eq("bucket_id", id).order("alias"),
        supabase.from("job_bucket_overlays").select("id, overlay_type, program_type, college_segment, geography, ctc_min, ctc_median, ctc_max, ctc_currency, evidence_count, updated_at").eq("bucket_id", id),
        supabase.from("job_bucket_evidence").select("*", { count: "exact", head: true }).eq("bucket_id", id),
        supabase.from("job_bucket_skill_map").select("*", { count: "exact", head: true }).eq("bucket_id", id),
        supabase.from("jobs").select("*", { count: "exact", head: true }).eq("bucket_id", id),
      ]);

      return res.json({
        ...bucket,
        function_name: (funcRes.data as any)?.name ?? null,
        family_name: (famRes.data as any)?.name ?? null,
        industry_name: (indRes.data as any)?.name ?? null,
        aliases: aliasRes.data || [],
        overlays: overlayRes.data || [],
        evidence_count_actual: evCount.count ?? 0,
        skill_map_count: skillCount.count ?? 0,
        job_count: jobCount.count ?? 0,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH /masters/buckets/:id/status ─────────────────────────────
  // Admin-only. Allowed transitions: candidate -> validated, validated -> deprecated.
  // No destructive deletes; merge/reject are intentionally not implemented yet.
  const bucketStatusMatch = path.match(/^\/masters\/buckets\/([a-f0-9-]+)\/status$/);
  if (bucketStatusMatch && req.method === "PATCH") {
    if (!requireAdmin(auth, res)) return;
    const id = bucketStatusMatch[1];
    const { status: nextStatus } = req.body || {};
    if (!nextStatus || !["validated", "deprecated"].includes(nextStatus)) {
      return res.status(400).json({ error: "status must be 'validated' or 'deprecated'" });
    }

    try {
      const { data: current, error: getErr } = await supabase
        .from("job_buckets")
        .select("id, status")
        .eq("id", id)
        .single();
      if (getErr || !current) return res.status(404).json({ error: getErr?.message || "Bucket not found" });

      const allowed: Record<string, string[]> = {
        candidate: ["validated"],
        validated: ["deprecated"],
      };
      if (!allowed[current.status]?.includes(nextStatus)) {
        return res.status(409).json({
          error: `Invalid transition: ${current.status} -> ${nextStatus}`,
        });
      }

      const actor = auth.nexusUser?.email ?? auth.email ?? null;
      const nowIso = new Date().toISOString();
      const updates: Record<string, any> = {
        status: nextStatus,
        updated_at: nowIso,
        updated_by: actor,
      };
      if (nextStatus === "validated") {
        updates.validated_at = nowIso;
        updates.validated_by = actor;
      } else if (nextStatus === "deprecated") {
        updates.deprecated_at = nowIso;
      }

      const { data, error } = await supabase
        .from("job_buckets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return undefined;
}
