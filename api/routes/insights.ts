// =============================================================================
// api/routes/insights.ts
// Alumni Insights v1 — read endpoints + report generation.
// Spec: /home/user/workspace/alumni_insights_spec.md §10 (API Endpoint Catalog).
// =============================================================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import {
  AuthResult,
  requireReader,
  requirePermission,
  requireAdmin,
} from "../lib/auth";

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 2;
const MIN_COMPLETENESS_FOR_DASHBOARD = 0.5;
const REDACTION_MIN_N = 5;

// ──────────────────────────────────────────────────────────────────────────
// Path matchers
// Routes handled here:
//   /colleges/:id/insights/summary          GET
//   /colleges/:id/insights/cohort           GET    ?graduation_year=&program_id=
//   /colleges/:id/insights/yoy              GET    ?year_from=&year_to=&program_id=
//   /colleges/:id/insights/pipeline-history GET
//   /colleges/:id/insights/reports          GET | POST
//   /colleges/:id/insights/program-mapping  GET | POST
//   /colleges/:id/insights/person/:pid/snapshot GET
//   /reports/public/:report_id              GET   (no auth — handled in index.ts before auth)
// ──────────────────────────────────────────────────────────────────────────

const COLLEGE_INSIGHTS_PREFIX = /^\/colleges\/([0-9a-f-]{36})\/insights/i;

export function isInsightsPath(path: string): boolean {
  return COLLEGE_INSIGHTS_PREFIX.test(path);
}

export function isPublicReportPath(path: string): boolean {
  return /^\/reports\/public\/[0-9a-f-]{36}$/i.test(path);
}

// ──────────────────────────────────────────────────────────────────────────
// Public handler — used by index.ts BEFORE auth (no auth required)
// ──────────────────────────────────────────────────────────────────────────
export async function handlePublicReportRoute(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse | undefined> {
  const m = path.match(/^\/reports\/public\/([0-9a-f-]{36})$/i);
  if (!m || req.method !== "GET") return undefined;
  const reportId = m[1];

  const { data, error } = await supabase
    .from("insight_reports")
    .select(`
      id, college_id, graduation_year, program_id, report_type,
      title, caption, status, chart_urls, redacted_widgets,
      filters_applied, created_at, expires_at, is_public,
      college:colleges!insight_reports_college_id_fkey(id, name, short_name, linkedin_slug)
    `)
    .eq("id", reportId)
    .eq("is_public", true)
    .eq("status", "ready")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Report not found or not published" });

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.status(410).json({ error: "Report has expired" });
  }

  // No PII in this payload — only aggregate chart URLs + caption.
  return res.json(data);
}

// ──────────────────────────────────────────────────────────────────────────
// Authenticated handler — mounted under /colleges/:id/insights/*
// ──────────────────────────────────────────────────────────────────────────
export async function handleInsightsRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult,
): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "colleges", res)) return;

  const m = path.match(COLLEGE_INSIGHTS_PREFIX);
  if (!m) return undefined;
  const collegeId = m[1];
  const subPath = path.slice(m[0].length); // e.g. "/summary", "/cohort", "/reports"

  // --- Endpoint 3: GET /colleges/:id/insights/summary ---
  if (subPath === "/summary" && req.method === "GET") {
    return await getSummary(collegeId, req, res);
  }

  // --- Endpoint 4: GET /colleges/:id/insights/cohort ---
  if (subPath === "/cohort" && req.method === "GET") {
    return await getCohort(collegeId, req, res);
  }

  // --- Endpoint 5: GET /colleges/:id/insights/yoy ---
  if (subPath === "/yoy" && req.method === "GET") {
    return await getYoY(collegeId, req, res);
  }

  // --- Endpoint 6: GET /colleges/:id/insights/pipeline-history ---
  if (subPath === "/pipeline-history" && req.method === "GET") {
    return await getPipelineHistory(collegeId, req, res);
  }

  // --- Endpoint 7+8: /colleges/:id/insights/reports (POST | GET) ---
  if (subPath === "/reports") {
    if (req.method === "POST") {
      if (!requireAdmin(auth, res)) return;
      return await createReport(collegeId, req, res, auth);
    }
    if (req.method === "GET") {
      return await listReports(collegeId, req, res);
    }
  }

  // --- Endpoint 10+11: /colleges/:id/insights/program-mapping ---
  if (subPath === "/program-mapping") {
    if (req.method === "GET") {
      if (!requireAdmin(auth, res)) return;
      return await listProgramMappingReview(collegeId, req, res);
    }
    if (req.method === "POST") {
      if (!requireAdmin(auth, res)) return;
      return await upsertProgramMapping(collegeId, req, res);
    }
  }

  // --- Endpoint 12: GET /colleges/:id/insights/person/:pid/snapshot ---
  const personSnap = subPath.match(/^\/person\/([0-9a-f-]{36})\/snapshot$/i);
  if (personSnap && req.method === "GET") {
    if (!requireAdmin(auth, res)) return;
    return await getPersonSnapshot(collegeId, personSnap[1], res);
  }

  return undefined;
}

// ══════════════════════════════════════════════════════════════════════════
// Endpoint implementations
// ══════════════════════════════════════════════════════════════════════════

// --- 3. Cohort coverage stats -------------------------------------------------
async function getSummary(collegeId: string, _req: VercelRequest, res: VercelResponse) {
  // Fetch college metadata
  const { data: college, error: cErr } = await supabase
    .from("colleges")
    .select("id, name, short_name, linkedin_slug")
    .eq("id", collegeId)
    .maybeSingle();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!college) return res.status(404).json({ error: "College not found" });

  // Total alumni per graduation year (from `alumni`, joined via university_name match)
  const { data: alumniRows, error: aErr } = await supabase
    .from("alumni")
    .select("graduation_year, person_id")
    .eq("university_id", collegeId)
    .not("graduation_year", "is", null);

  // Fallback: alumni rows without university_id are matched by name
  let alumni = alumniRows || [];
  if (!alumni.length || aErr) {
    const { data: byName } = await supabase
      .from("alumni")
      .select("graduation_year, person_id")
      .ilike("university_name", `%${college.name}%`)
      .not("graduation_year", "is", null);
    if (byName) alumni = byName;
  }

  // Tally totals per graduation year
  const totalsByYear = new Map<number, number>();
  for (const row of alumni) {
    const y = (row as any).graduation_year as number;
    if (!y) continue;
    totalsByYear.set(y, (totalsByYear.get(y) || 0) + 1);
  }

  // Analyzed counts per graduation year (from snapshots)
  const { data: snapRows, error: sErr } = await supabase
    .from("alumni_profile_snapshots")
    .select("graduation_year, completeness_score")
    .eq("college_id", collegeId)
    .eq("schema_version", CURRENT_SCHEMA_VERSION);
  if (sErr) return res.status(500).json({ error: sErr.message });

  const analyzedByYear = new Map<number, { analyzed: number; complete: number }>();
  for (const row of snapRows || []) {
    const y = (row as any).graduation_year as number;
    if (!y) continue;
    const cur = analyzedByYear.get(y) || { analyzed: 0, complete: 0 };
    cur.analyzed += 1;
    if (((row as any).completeness_score || 0) >= MIN_COMPLETENESS_FOR_DASHBOARD) cur.complete += 1;
    analyzedByYear.set(y, cur);
  }

  // Build response: union of years from totals and analyzed
  const allYears = new Set<number>([...totalsByYear.keys(), ...analyzedByYear.keys()]);
  const byYear = Array.from(allYears)
    .sort((a, b) => b - a)
    .map((y) => {
      const total = totalsByYear.get(y) || 0;
      const a = analyzedByYear.get(y) || { analyzed: 0, complete: 0 };
      return {
        graduation_year: y,
        total_alumni: total,
        analyzed: a.analyzed,
        analyzed_complete: a.complete,
        coverage_pct: total > 0 ? Math.round((a.analyzed / total) * 1000) / 10 : 0,
      };
    });

  const totals = {
    total_alumni: Array.from(totalsByYear.values()).reduce((a, b) => a + b, 0),
    analyzed: (snapRows || []).length,
    analyzed_complete: (snapRows || []).filter(
      (r: any) => (r.completeness_score || 0) >= MIN_COMPLETENESS_FOR_DASHBOARD,
    ).length,
  };

  return res.json({ college, totals, by_year: byYear });
}

// --- 4. Cohort dashboard data (all widgets in one call) ---------------------
async function getCohort(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const gradYear = parseInt((req.query.graduation_year as string) || "");
  const programId = (req.query.program_id as string) || null;
  if (!gradYear) return res.status(400).json({ error: "graduation_year is required" });

  // Base filter applied to all widget queries
  const baseFilter = (q: any) => {
    let qq = q
      .eq("college_id", collegeId)
      .eq("schema_version", CURRENT_SCHEMA_VERSION)
      .eq("graduation_year", gradYear);
    if (programId) qq = qq.eq("program_id", programId);
    return qq;
  };

  // Fetch all snapshots for the cohort (single read powers all widgets)
  const { data: rows, error } = await baseFilter(
    supabase.from("alumni_profile_snapshots").select(`
      id, person_id, program_id, snapshot,
      first_job_bucket_id, first_job_bucket_code, is_ppo, sip_bucket_id,
      undergrad_college_tier, pre_college_total_exp_months,
      current_job_bucket_id, ctc_band_label, completeness_score
    `),
  );
  if (error) return res.status(500).json({ error: error.message });

  const snaps = (rows || []) as any[];
  const dashboardEligible = snaps.filter(
    (s) => (s.completeness_score || 0) >= MIN_COMPLETENESS_FOR_DASHBOARD,
  );

  // Resolve bucket metadata in one query
  const bucketIds = new Set<string>();
  for (const s of snaps) {
    if (s.first_job_bucket_id) bucketIds.add(s.first_job_bucket_id);
    if (s.current_job_bucket_id) bucketIds.add(s.current_job_bucket_id);
    if (s.sip_bucket_id) bucketIds.add(s.sip_bucket_id);
  }
  const bucketsById = new Map<string, any>();
  if (bucketIds.size > 0) {
    const { data: buckets } = await supabase
      .from("buckets")
      .select("id, code, name, domain, color_hex")
      .in("id", Array.from(bucketIds));
    for (const b of buckets || []) bucketsById.set((b as any).id, b);
  }

  // Widget 1 — Bucket distribution
  const bucketDist = aggregate(
    dashboardEligible,
    (s) => s.first_job_bucket_code || "UNMAPPED",
    (key, n) => {
      const sample = dashboardEligible.find((s) => (s.first_job_bucket_code || "UNMAPPED") === key);
      const meta = sample?.first_job_bucket_id ? bucketsById.get(sample.first_job_bucket_id) : null;
      return {
        bucket_code: key,
        bucket_name: meta?.name || (key === "UNMAPPED" ? "Unmapped" : key),
        domain: meta?.domain || null,
        color_hex: meta?.color_hex || null,
        n_alumni: n,
        pct_cohort: pct(n, dashboardEligible.length),
      };
    },
  );

  // Widget 2 — Undergrad tier distribution
  const undergradTier = aggregate(
    dashboardEligible,
    (s) => s.undergrad_college_tier || "Unknown",
    (key, n) => ({ tier: key, n_alumni: n, pct_cohort: pct(n, dashboardEligible.length) }),
  );

  // Widget 3 — Pre-MBA experience histogram (10 breakpoints)
  const expHist = expHistogram(dashboardEligible);

  // Widget 4 — Top employers (from JSONB, since not flat)
  const employerTally = new Map<string, number>();
  for (const s of dashboardEligible) {
    const co = s.snapshot?.immediate_after_college?.first_job?.company_name;
    if (co && typeof co === "string") {
      employerTally.set(co, (employerTally.get(co) || 0) + 1);
    }
  }
  const topEmployers = Array.from(employerTally.entries())
    .map(([company, n]) => ({
      company_name: company,
      n_alumni: n,
      pct_cohort: pct(n, dashboardEligible.length),
    }))
    .sort((a, b) => b.n_alumni - a.n_alumni)
    .slice(0, 25);

  // Widget 5 — Function split (job_function, from JSONB)
  const fnTally = new Map<string, number>();
  for (const s of dashboardEligible) {
    const fn = s.snapshot?.immediate_after_college?.first_job?.job_function || "Unknown";
    fnTally.set(fn, (fnTally.get(fn) || 0) + 1);
  }
  const functionSplit = Array.from(fnTally.entries())
    .map(([fn, n]) => ({
      function: fn,
      n_alumni: n,
      pct_cohort: pct(n, dashboardEligible.length),
    }))
    .sort((a, b) => b.n_alumni - a.n_alumni);

  // Widget 6 — PPO + SIP conversion
  const allCohort = snaps; // PPO/SIP measured against analyzed cohort, not just complete
  const sipCount = allCohort.filter((s) => s.sip_bucket_id).length;
  const ppoCount = allCohort.filter((s) => s.is_ppo === true).length;
  const ppoStats = {
    total_analyzed: allCohort.length,
    had_sip: sipCount,
    ppo_converted: ppoCount,
    ppo_conversion_rate_pct: sipCount > 0 ? pct(ppoCount, sipCount) : 0,
  };

  // Widget 7 — CTC band distribution
  const ctcBand = aggregate(
    dashboardEligible,
    (s) => s.ctc_band_label || "Unknown",
    (key, n) => ({ ctc_band: key, n_alumni: n, pct_cohort: pct(n, dashboardEligible.length) }),
  );

  return res.json({
    college_id: collegeId,
    graduation_year: gradYear,
    program_id: programId,
    cohort_size: snaps.length,
    dashboard_eligible_count: dashboardEligible.length,
    completeness_threshold: MIN_COMPLETENESS_FOR_DASHBOARD,
    widgets: {
      bucket_distribution: bucketDist,
      undergrad_tier: undergradTier,
      experience_histogram: expHist,
      top_employers: topEmployers,
      function_split: functionSplit,
      ppo_stats: ppoStats,
      ctc_band: ctcBand,
    },
  });
}

// --- 5. YoY comparison data -------------------------------------------------
async function getYoY(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const yearFrom = parseInt((req.query.year_from as string) || "");
  const yearTo = parseInt((req.query.year_to as string) || "");
  const programId = (req.query.program_id as string) || null;
  if (!yearFrom || !yearTo) {
    return res.status(400).json({ error: "year_from and year_to are required" });
  }
  if (yearTo - yearFrom > 9) {
    return res.status(400).json({ error: "Maximum YoY span is 10 years" });
  }

  let q = supabase
    .from("alumni_profile_snapshots")
    .select(`graduation_year, first_job_bucket_id, first_job_bucket_code, completeness_score`)
    .eq("college_id", collegeId)
    .eq("schema_version", CURRENT_SCHEMA_VERSION)
    .gte("graduation_year", yearFrom)
    .lte("graduation_year", yearTo)
    .gte("completeness_score", MIN_COMPLETENESS_FOR_DASHBOARD);
  if (programId) q = q.eq("program_id", programId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Tally per (year, bucket)
  const tally = new Map<string, { year: number; code: string; n: number }>();
  const yearTotals = new Map<number, number>();
  for (const row of (data || []) as any[]) {
    const code = row.first_job_bucket_code || "UNMAPPED";
    const key = `${row.graduation_year}::${code}`;
    const cur = tally.get(key) || { year: row.graduation_year, code, n: 0 };
    cur.n += 1;
    tally.set(key, cur);
    yearTotals.set(row.graduation_year, (yearTotals.get(row.graduation_year) || 0) + 1);
  }

  // Resolve bucket names
  const codes = Array.from(new Set(Array.from(tally.values()).map((v) => v.code)));
  const bucketsByCode = new Map<string, any>();
  if (codes.length > 0) {
    const { data: buckets } = await supabase
      .from("buckets")
      .select("code, name, domain, color_hex")
      .in("code", codes);
    for (const b of buckets || []) bucketsByCode.set((b as any).code, b);
  }

  const series = Array.from(tally.values())
    .map((row) => {
      const meta = bucketsByCode.get(row.code) || {};
      const total = yearTotals.get(row.year) || 0;
      return {
        graduation_year: row.year,
        bucket_code: row.code,
        bucket_name: meta.name || (row.code === "UNMAPPED" ? "Unmapped" : row.code),
        domain: meta.domain || null,
        color_hex: meta.color_hex || null,
        n_alumni: row.n,
        pct_cohort: pct(row.n, total),
      };
    })
    .sort((a, b) => (b.graduation_year - a.graduation_year) || (b.n_alumni - a.n_alumni));

  return res.json({
    college_id: collegeId,
    year_from: yearFrom,
    year_to: yearTo,
    program_id: programId,
    cohort_sizes: Array.from(yearTotals.entries()).map(([y, n]) => ({ graduation_year: y, n_alumni: n })),
    series,
  });
}

// --- 6. Pipeline history ----------------------------------------------------
async function getPipelineHistory(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const limit = Math.min(parseInt((req.query.limit as string) || "25") || 25, 100);

  const { data, error } = await supabase
    .from("pipeline_runs")
    .select(`
      id, pipeline_type, trigger_type, config, status,
      total_items, processed_items, failed_items, skipped_items,
      error_message, started_at, completed_at, triggered_by
    `)
    .eq("pipeline_type", "person_analysis")
    .contains("config", { college_id: collegeId })
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], total: (data || []).length });
}

// --- 7. POST /colleges/:id/insights/reports — Create new report ------------
async function createReport(
  collegeId: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult,
) {
  const {
    graduation_year,
    program_id,
    report_type = "cohort",
    title,
    is_public = true,
    expires_at,
  } = req.body || {};

  if (!graduation_year && report_type === "cohort") {
    return res.status(400).json({ error: "graduation_year is required for cohort reports" });
  }

  // Compute the cohort data NOW so we can apply N>=5 redaction at generation time
  // and persist redacted_widgets list for transparency.
  const cohortReq = {
    query: { graduation_year: String(graduation_year || ""), program_id: program_id || "" },
  } as VercelRequest;

  // Reuse getCohort by capturing its output via a minimal mock res
  const captured: any = await new Promise((resolve, reject) => {
    const fakeRes: any = {
      status(_n: number) { return fakeRes; },
      json(payload: any) { resolve(payload); return fakeRes; },
    };
    getCohort(collegeId, cohortReq, fakeRes).catch(reject);
  });

  if (captured?.error) {
    return res.status(400).json({ error: captured.error });
  }

  const { redactedWidgets, redactedPayload } = applyRedaction(captured);

  // Auto-caption (140 chars max)
  const caption = generateCaption(captured, redactedPayload);

  const insertPayload: any = {
    college_id: collegeId,
    graduation_year: graduation_year || null,
    program_id: program_id || null,
    report_type,
    title: title || null,
    caption,
    status: "pending",
    chart_urls: {},
    redacted_widgets: redactedWidgets,
    filters_applied: { graduation_year, program_id },
    schema_version_used: CURRENT_SCHEMA_VERSION,
    generated_by: auth.nexusUser?.email || "system",
    expires_at: expires_at || null,
    is_public: is_public !== false,
  };

  const { data: report, error: insErr } = await supabase
    .from("insight_reports")
    .insert(insertPayload)
    .select()
    .single();

  if (insErr) return res.status(500).json({ error: insErr.message });

  // Build the chart URL set. We use the share-card route — see api/routes/insights-share-card.ts.
  // Each widget gets its own OG image so the report page can display them.
  // We do NOT block on rendering; we mark the report as "ready" since OG images
  // are rendered on-demand at request time.
  const chartUrls = buildChartUrlSet((report as any).id);

  const { data: ready, error: updErr } = await supabase
    .from("insight_reports")
    .update({ status: "ready", chart_urls: chartUrls })
    .eq("id", (report as any).id)
    .select()
    .single();

  if (updErr) return res.status(500).json({ error: updErr.message });

  return res.json({
    ...ready,
    public_url: `/public/college/insights/${(report as any).id}`,
    cohort_data: redactedPayload,
  });
}

// --- 8. GET /colleges/:id/insights/reports — List ---------------------------
async function listReports(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const { data, error } = await supabase
    .from("insight_reports")
    .select(`
      id, college_id, graduation_year, program_id, report_type,
      title, caption, status, chart_urls, redacted_widgets,
      generated_by, is_public, expires_at, created_at, updated_at, error_message
    `)
    .eq("college_id", collegeId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], total: (data || []).length });
}

// --- 10. GET /colleges/:id/insights/program-mapping ------------------------
async function listProgramMappingReview(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const includeMapped = req.query.include_mapped === "true";

  let q = supabase
    .from("program_mapping_cache")
    .select(`
      id, raw_degree, raw_field, mapped_program_id, confidence,
      model, manually_overridden, created_at, updated_at,
      program:college_programs!program_mapping_cache_mapped_program_id_fkey(id, name, abbreviation, degree_type, major)
    `)
    .eq("college_id", collegeId);

  if (!includeMapped) {
    // Only flagged: unmapped OR low-confidence (<0.6)
    q = q.or("mapped_program_id.is.null,confidence.lt.0.6");
  }

  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });

  // Also list available college_programs so the UI dropdown can populate
  const { data: programs } = await supabase
    .from("college_programs")
    .select("id, name, abbreviation, degree_type, major")
    .eq("college_id", collegeId)
    .order("name");

  return res.json({
    data: data || [],
    available_programs: programs || [],
    total: (data || []).length,
  });
}

// --- 11. POST /colleges/:id/insights/program-mapping -----------------------
async function upsertProgramMapping(collegeId: string, req: VercelRequest, res: VercelResponse) {
  const { raw_degree, raw_field = "", mapped_program_id } = req.body || {};
  if (!raw_degree) return res.status(400).json({ error: "raw_degree is required" });

  // mapped_program_id can be null to explicitly unmap
  const payload = {
    college_id: collegeId,
    raw_degree,
    raw_field: raw_field || "",
    mapped_program_id: mapped_program_id || null,
    confidence: mapped_program_id ? 1.0 : null,
    model: "manual",
    manually_overridden: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("program_mapping_cache")
    .upsert(payload, { onConflict: "college_id,raw_degree,raw_field" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

// --- 12. GET /colleges/:id/insights/person/:pid/snapshot --------------------
async function getPersonSnapshot(collegeId: string, personId: string, res: VercelResponse) {
  const { data, error } = await supabase
    .from("alumni_profile_snapshots")
    .select("*")
    .eq("college_id", collegeId)
    .eq("person_id", personId)
    .order("schema_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Snapshot not found for this person" });
  return res.json(data);
}

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function aggregate<T, R>(
  rows: T[],
  keyFn: (row: T) => string,
  builder: (key: string, n: number) => R,
): R[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = keyFn(row);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, n]) => builder(k, n))
    .sort((a: any, b: any) => (b.n_alumni || 0) - (a.n_alumni || 0));
}

function expHistogram(snaps: any[]) {
  const buckets = [
    { label: "0 (fresher)", min: 0, max: 0 },
    { label: "1–12 months", min: 1, max: 12 },
    { label: "13–24 months", min: 13, max: 24 },
    { label: "25–36 months", min: 25, max: 36 },
    { label: "37–48 months", min: 37, max: 48 },
    { label: "48+ months", min: 49, max: Infinity },
  ];

  const counts = buckets.map((b) => ({ ...b, n_alumni: 0 }));
  let unknown = 0;
  for (const s of snaps) {
    const m = s.pre_college_total_exp_months;
    if (m === null || m === undefined) {
      unknown += 1;
      continue;
    }
    const idx = counts.findIndex((c) => m >= c.min && m <= c.max);
    if (idx >= 0) counts[idx].n_alumni += 1;
  }

  const total = snaps.length;
  const out = counts.map((c) => ({
    exp_bucket: c.label,
    n_alumni: c.n_alumni,
    pct_cohort: pct(c.n_alumni, total),
  }));
  if (unknown > 0) {
    out.push({ exp_bucket: "Unknown", n_alumni: unknown, pct_cohort: pct(unknown, total) });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Public-report redaction (N>=5 rule, spec §8)
// ──────────────────────────────────────────────────────────────────────────
function applyRedaction(payload: any): { redactedPayload: any; redactedWidgets: string[] } {
  const w = payload?.widgets || {};
  const redacted: string[] = [];
  const out: any = { ...payload, widgets: {} };

  // Group-level redaction: any group n<5 becomes "Other"
  const redactGroupArray = (
    arr: any[] | undefined,
    nameKey: string,
    widgetName: string,
  ): any[] | null => {
    if (!arr || !arr.length) {
      redacted.push(widgetName);
      return null;
    }
    const keep = arr.filter((g) => (g.n_alumni || 0) >= REDACTION_MIN_N);
    const drop = arr.filter((g) => (g.n_alumni || 0) < REDACTION_MIN_N);
    const otherN = drop.reduce((s, g) => s + (g.n_alumni || 0), 0);
    const otherPct = drop.reduce((s, g) => s + (g.pct_cohort || 0), 0);
    if (drop.length > 0 && otherN >= REDACTION_MIN_N) {
      keep.push({ [nameKey]: "Other", n_alumni: otherN, pct_cohort: Math.round(otherPct * 10) / 10 });
    }
    if (keep.length === 0) {
      redacted.push(widgetName);
      return null;
    }
    return keep;
  };

  out.widgets.bucket_distribution = redactGroupArray(
    w.bucket_distribution,
    "bucket_name",
    "bucket_distribution",
  );
  out.widgets.undergrad_tier = redactGroupArray(
    w.undergrad_tier,
    "tier",
    "undergrad_tier",
  );
  out.widgets.experience_histogram = redactGroupArray(
    w.experience_histogram,
    "exp_bucket",
    "experience_histogram",
  );
  out.widgets.top_employers = redactGroupArray(
    w.top_employers,
    "company_name",
    "top_employers",
  );
  out.widgets.function_split = redactGroupArray(
    w.function_split,
    "function",
    "function_split",
  );
  out.widgets.ctc_band = redactGroupArray(
    w.ctc_band,
    "ctc_band",
    "ctc_band",
  );

  // PPO stats redacted only if total_analyzed < 5 OR had_sip < 5
  const ppo = w.ppo_stats;
  if (!ppo || ppo.total_analyzed < REDACTION_MIN_N) {
    out.widgets.ppo_stats = null;
    redacted.push("ppo_stats");
  } else if (ppo.had_sip < REDACTION_MIN_N) {
    out.widgets.ppo_stats = { ...ppo, ppo_converted: null, ppo_conversion_rate_pct: null };
  } else {
    out.widgets.ppo_stats = ppo;
  }

  return { redactedPayload: out, redactedWidgets: redacted };
}

function generateCaption(full: any, redacted: any): string {
  // Find top bucket from redacted set
  const dist = redacted?.widgets?.bucket_distribution || [];
  if (!dist.length) return "Insufficient data to summarise this cohort publicly.";

  const top = dist[0];
  const year = full.graduation_year;
  const second = dist[1];

  let s = `Class of ${year}: ${top.pct_cohort}% placed in ${top.bucket_name}`;
  if (second && second.bucket_code !== "Other") {
    s += `, ${second.pct_cohort}% in ${second.bucket_name}`;
  }
  s += ".";
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

function buildChartUrlSet(reportId: string): Record<string, string> {
  // OG images served from the share-card route (registered separately).
  // Each widget gets its own URL with widget=<name> query param.
  const base = `/api/insights-share-card?report_id=${reportId}`;
  return {
    summary_card: base,
    bucket_distribution: `${base}&widget=bucket_distribution`,
    undergrad_tier: `${base}&widget=undergrad_tier`,
    experience_histogram: `${base}&widget=experience_histogram`,
    function_split: `${base}&widget=function_split`,
    top_employers: `${base}&widget=top_employers`,
    ctc_band: `${base}&widget=ctc_band`,
    ppo_stats: `${base}&widget=ppo_stats`,
  };
}
