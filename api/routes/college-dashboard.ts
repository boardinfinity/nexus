/**
 * api/routes/college-dashboard.ts
 * =====================================================================
 * Consolidated College Dashboard endpoint — returns all 8 panels in one
 * payload. Designed for low round-trip count and easy future caching via
 * a college_dashboard_snapshots table (Phase 2, migration 045).
 *
 * Authenticated route:
 *   GET /college-dashboard/:college_id        — for logged-in admin / college_rep
 *
 * Public demo route (auth-bypassed via /public prefix):
 *   GET /public/college-dashboard/by-slug/:slug
 *     — slug is an unguessable token for the UOWD leadership demo.
 *     — slug→college_id mapping is hard-coded in DEMO_SLUGS below.
 *     — Phase 1 will replace this with a college_dashboard_share_tokens
 *       table + proper RLS scoping.
 *
 * Panels returned:
 *   1. hero              college header + counts
 *   2. programs          UOWD programs list (top N)
 *   3. uae_jobs_scan     UAE/GCC job-market headline numbers
 *   4. top_skills        Top in-demand skills (region) — best-available
 *                        signal: extracted job_skills if present, else
 *                        report_skill_mentions
 *   5. college_jobs      campus_upload_batches × jobs.upload_batch_id
 *                        KPIs; empty-state ready
 *   6. alumni            UOWD alumni glimpse (count + top employers /
 *                        titles / locations via people join)
 *   7. gap_heatmap       Program × Skill demand-vs-coverage delta
 *   8. exec_summary      Auto-generated three strengths / three gaps /
 *                        three emerging skills
 *
 * Each panel carries a `data_quality` tag — "live", "live_partial", or
 * "illustrative" — so the UI can label honestly.
 *
 * Author:   thread cd-uowd14
 * Date:     2026-05-14
 * =====================================================================
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requireReader } from "../lib/auth";
import { supabase } from "../lib/supabase";

// ── Unguessable slug map for tomorrow's UOWD demo ────────────────────
// Slug is intentionally cryptographic-grade random + a friendly prefix.
// Phase 1 moves this to a Postgres table with RLS.
const DEMO_SLUGS: Record<string, string> = {
  "uowd-9k3xr2vp": "66fb2cfd-e272-49b8-ba99-192b210a0409", // University of Wollongong, Dubai
};

// UAE / GCC country variants seen in the live `jobs` table
const UAE_GCC_COUNTRIES = [
  "United Arab Emirates",
  "United Arab Emirates (UAE)",
  "UAE",
  "AE",
  "Dubai",
  "Saudi Arabia",
  "SA",
  "Riyadh",
  "Qatar",
  "QA",
  "Oman",
  "OM",
  "Bahrain",
  "BH",
  "Kuwait",
  "KW",
];

type DataQuality = "live" | "live_partial" | "illustrative";

interface Panel<T> {
  data_quality: DataQuality;
  note?: string;
  data: T;
}

// ── Internal: assemble one full dashboard payload ────────────────────
async function buildDashboardPayload(college_id: string): Promise<any> {
  // 0. College header
  const { data: college } = await supabase
    .from("colleges")
    .select("id, name, short_name, country, city, state, tier, nirf_rank, website, logo_url")
    .eq("id", college_id)
    .single();

  // 1. Hero counts — programs / courses / mapped skills / campus drives / jobs
  // Two-step approach (no RPCs needed). Each count is its own simple query.
  const [programsCountRes, coursesCountRes, campusBatchesRes] = await Promise.all([
    supabase.from("college_programs").select("id", { count: "exact", head: true }).eq("college_id", college_id),
    supabase.from("college_courses").select("id", { count: "exact", head: true }).eq("college_id", college_id),
    supabase.from("campus_upload_batches").select("id", { count: "exact", head: true }).eq("college_id", college_id),
  ]);

  // course_skill count — fetch course ids, then count course_skills.
  const { data: collegeCourseIdsRaw } = await supabase
    .from("college_courses")
    .select("id")
    .eq("college_id", college_id);
  const collegeCourseIds = (collegeCourseIdsRaw || []).map((c: any) => c.id);
  const { count: courseSkillCountRaw } = collegeCourseIds.length > 0
    ? await supabase
        .from("course_skills")
        .select("id", { count: "exact", head: true })
        .in("course_id", collegeCourseIds)
    : { count: 0 };
  const courseSkillCount = courseSkillCountRaw || 0;

  // campus jobs count
  const { data: batchIdsRaw } = await supabase
    .from("campus_upload_batches")
    .select("id")
    .eq("college_id", college_id);
  const heroBatchIds = (batchIdsRaw || []).map((b: any) => b.id);
  const { count: campusJobCountRaw } = heroBatchIds.length > 0
    ? await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .in("upload_batch_id", heroBatchIds)
    : { count: 0 };
  const campusJobCount = campusJobCountRaw || 0;

  // Alumni count via tight name match (UOWD-specific until university_id
  // becomes structured — works for any "Wollongong %dubai%" / "%UOWD%" match)
  const collegeName = (college?.name || "").toLowerCase();
  const isUOWD = collegeName.includes("wollongong");
  const { count: alumniCountRaw } = isUOWD
    ? await supabase
        .from("alumni")
        .select("id", { count: "exact", head: true })
        .or("university_name.ilike.%wollongong%dubai%,university_name.ilike.%uowd%")
    : await supabase.from("alumni").select("id", { count: "exact", head: true }).eq("university_id", college_id);
  const alumniCount = alumniCountRaw || 0;

  const hero: Panel<any> = {
    data_quality: "live",
    data: {
      college,
      counts: {
        programs: programsCountRes.count || 0,
        courses: coursesCountRes.count || 0,
        mapped_skills: courseSkillCount,
        alumni: alumniCount,
        college_jobs: campusJobCount,
        campus_drives: campusBatchesRes.count || 0,
      },
    },
  };

  // 2. Programs panel
  const { data: programs } = await supabase
    .from("college_programs")
    .select("id, name, degree_type, abbreviation, major, duration_years, total_credit_points, delivery_mode")
    .eq("college_id", college_id)
    .order("name", { ascending: true })
    .limit(50);

  const programsPanel: Panel<any> = {
    data_quality: "live",
    data: { items: programs || [], total: (programs || []).length },
  };

  // 3. UAE/GCC jobs scan — headline stats
  const { count: uaeJobsTotal } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("location_country", UAE_GCC_COUNTRIES);

  const { data: uaeByCountry } = await supabase
    .from("jobs")
    .select("location_country")
    .in("location_country", UAE_GCC_COUNTRIES)
    .limit(20000); // safety cap

  const byCountry: Record<string, number> = {};
  (uaeByCountry || []).forEach((r: any) => {
    const c = r.location_country;
    byCountry[c] = (byCountry[c] || 0) + 1;
  });
  // Normalize country variants
  const countryNorm: Record<string, string> = {
    "United Arab Emirates (UAE)": "UAE",
    "United Arab Emirates": "UAE",
    AE: "UAE",
    Dubai: "UAE",
    SA: "Saudi Arabia",
    Riyadh: "Saudi Arabia",
    QA: "Qatar",
    OM: "Oman",
    BH: "Bahrain",
    KW: "Kuwait",
  };
  const byCountryNormalized: Record<string, number> = {};
  Object.entries(byCountry).forEach(([k, v]) => {
    const norm = countryNorm[k] || k;
    byCountryNormalized[norm] = (byCountryNormalized[norm] || 0) + v;
  });

  // Top hiring companies in UAE/GCC
  const { data: topCompaniesRaw } = await supabase
    .from("jobs")
    .select("company_name")
    .in("location_country", UAE_GCC_COUNTRIES)
    .not("company_name", "is", null)
    .limit(20000);

  const companyCounts: Record<string, number> = {};
  (topCompaniesRaw || []).forEach((j: any) => {
    if (!j.company_name) return;
    companyCounts[j.company_name] = (companyCounts[j.company_name] || 0) + 1;
  });
  const topCompanies = Object.entries(companyCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const uaeJobsPanel: Panel<any> = {
    data_quality: "live",
    data: {
      total_jobs: uaeJobsTotal || 0,
      by_country: byCountryNormalized,
      top_companies: topCompanies,
    },
  };

  // 4. Top skills — try job_skills first (extracted demand), fall back to
  //    report_skill_mentions (secondary-research demand)
  let topSkillsData: any = null;
  let topSkillsQuality: DataQuality = "live";
  let topSkillsNote: string | undefined;

  // Try extracted demand from UAE/GCC jobs
  const { data: uaeJobIdsRaw } = await supabase
    .from("jobs")
    .select("id")
    .in("location_country", UAE_GCC_COUNTRIES)
    .eq("analysis_version", "v2")
    .limit(20000);
  const uaeJobIds = (uaeJobIdsRaw || []).map((r: any) => r.id);

  if (uaeJobIds.length >= 50) {
    // Real extracted-demand signal exists
    const { data: extractedSkills } = await supabase
      .from("job_skills")
      .select("taxonomy_skill_id, taxonomy_skills!inner(name, l1, l2, category)")
      .in("job_id", uaeJobIds)
      .not("taxonomy_skill_id", "is", null)
      .limit(50000);

    const skillCounts: Record<string, { name: string; l1: string | null; l2: string | null; category: string | null; count: number }> = {};
    (extractedSkills || []).forEach((row: any) => {
      const id = row.taxonomy_skill_id;
      if (!skillCounts[id]) {
        skillCounts[id] = {
          name: row.taxonomy_skills?.name || "Unknown",
          l1: row.taxonomy_skills?.l1 || null,
          l2: row.taxonomy_skills?.l2 || null,
          category: row.taxonomy_skills?.category || null,
          count: 0,
        };
      }
      skillCounts[id].count++;
    });
    const ranked = Object.entries(skillCounts)
      .map(([id, v]) => ({ taxonomy_skill_id: id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    topSkillsData = { items: ranked, source: "extracted_job_skills", uae_jobs_analyzed: uaeJobIds.length };
    topSkillsQuality = uaeJobIds.length >= 1000 ? "live" : "live_partial";
    topSkillsNote = uaeJobIds.length < 1000 ? `Extracted from ${uaeJobIds.length} UAE/GCC JDs (more in pipeline)` : undefined;
  } else {
    // Fall back to secondary research reports
    const { data: reportSkills } = await supabase
      .from("report_skill_mentions")
      .select("taxonomy_skill_id, skill_name, taxonomy_skills(name, l1, l2, category)")
      .not("taxonomy_skill_id", "is", null);

    const counts: Record<string, { name: string; l1: string | null; l2: string | null; category: string | null; count: number }> = {};
    (reportSkills || []).forEach((row: any) => {
      const id = row.taxonomy_skill_id;
      if (!counts[id]) {
        counts[id] = {
          name: row.taxonomy_skills?.name || row.skill_name || "Unknown",
          l1: row.taxonomy_skills?.l1 || null,
          l2: row.taxonomy_skills?.l2 || null,
          category: row.taxonomy_skills?.category || null,
          count: 0,
        };
      }
      counts[id].count++;
    });
    const ranked = Object.entries(counts)
      .map(([id, v]) => ({ taxonomy_skill_id: id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    topSkillsData = { items: ranked, source: "report_skill_mentions" };
    topSkillsQuality = "live_partial";
    topSkillsNote = "Demand signal from 28 secondary-research reports. Job-extracted demand pipeline in progress.";
  }

  const topSkillsPanel: Panel<any> = {
    data_quality: topSkillsQuality,
    note: topSkillsNote,
    data: topSkillsData,
  };

  // 5. College Jobs panel — campus_upload_batches × jobs
  const { data: batches } = await supabase
    .from("campus_upload_batches")
    .select("id, program, job_type, drive_year, source, ctc_tag, status, total_files, jds_committed, created_at")
    .eq("college_id", college_id)
    .order("created_at", { ascending: false })
    .limit(100);

  let collegeJobsPanel: Panel<any>;
  if (!batches || batches.length === 0) {
    collegeJobsPanel = {
      data_quality: "live",
      note: "No campus drives uploaded yet. Upload at /upload/campus.",
      data: { drives: 0, total_jds: 0, job_type_mix: {}, ctc_tag_mix: {}, top_recruiters: [], recent_batches: [] },
    };
  } else {
    const batchIds = batches.map((b: any) => b.id);
    const { data: campusJobs } = await supabase
      .from("jobs")
      .select("id, company_name, upload_batch_id")
      .in("upload_batch_id", batchIds)
      .limit(10000);

    const totalJds = (campusJobs || []).length;
    const jobTypeMix: Record<string, number> = {};
    const ctcMix: Record<string, number> = {};
    batches.forEach((b: any) => {
      const jt = b.job_type || "other";
      const ctc = b.ctc_tag || "untagged";
      // Weight by jds_committed if present, else by 1 (batch-level)
      const w = b.jds_committed || 0;
      jobTypeMix[jt] = (jobTypeMix[jt] || 0) + w;
      ctcMix[ctc] = (ctcMix[ctc] || 0) + w;
    });
    const recruiterCounts: Record<string, number> = {};
    (campusJobs || []).forEach((j: any) => {
      if (!j.company_name) return;
      recruiterCounts[j.company_name] = (recruiterCounts[j.company_name] || 0) + 1;
    });
    const topRecruiters = Object.entries(recruiterCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    collegeJobsPanel = {
      data_quality: "live",
      data: {
        drives: batches.length,
        total_jds: totalJds,
        job_type_mix: jobTypeMix,
        ctc_tag_mix: ctcMix,
        top_recruiters: topRecruiters,
        recent_batches: batches.slice(0, 10),
      },
    };
  }

  // 6. Alumni glimpse — count + location distribution + sample headlines
  // Note: alumni.current_status and people.current_title are raw LinkedIn
  // headlines (e.g. 'Future AI Engineer | Big Data Student | Solving...'),
  // not normalized job titles. We surface honest signal: total, country
  // distribution, and a small sample of recent headlines for flavor.
  const { data: alumniRows } = isUOWD
    ? await supabase
        .from("alumni")
        .select("id, person_id, current_status, university_name, created_at, people(current_title, location_city, location_country, headline)")
        .or("university_name.ilike.%wollongong%dubai%,university_name.ilike.%uowd%")
        .order("created_at", { ascending: false })
        .limit(10000)
    : await supabase
        .from("alumni")
        .select("id, person_id, current_status, university_name, created_at, people(current_title, location_city, location_country, headline)")
        .eq("university_id", college_id)
        .order("created_at", { ascending: false })
        .limit(10000);

  const countryCounts: Record<string, number> = {};
  const samples: Array<{ title: string; country: string | null }> = [];
  (alumniRows || []).forEach((a: any, idx: number) => {
    const p = a.people;
    const country = p?.location_country || null;
    if (country) {
      // Normalize common 2-letter codes
      const norm =
        country === "AE" ? "UAE" :
        country === "IN" ? "India" :
        country === "US" ? "USA" :
        country === "GB" ? "UK" :
        country === "CA" ? "Canada" :
        country === "SA" ? "Saudi Arabia" :
        country;
      countryCounts[norm] = (countryCounts[norm] || 0) + 1;
    } else {
      countryCounts["Unknown"] = (countryCounts["Unknown"] || 0) + 1;
    }
    if (idx < 12 && (p?.current_title || a.current_status)) {
      const title = (p?.current_title || a.current_status || "").trim();
      // Trim to a reasonable preview length
      const preview = title.length > 90 ? title.slice(0, 87) + "…" : title;
      samples.push({ title: preview, country: country });
    }
  });
  const countryDist = Object.entries(countryCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));

  const alumniPanel: Panel<any> = {
    data_quality: alumniCount > 0 ? "live" : "live_partial",
    note: "Alumni linked via LinkedIn name-match on university (no graduation_year on file yet). Survey overlay in Phase 4 will add cohort + role normalization.",
    data: {
      total: alumniCount,
      sample_size: (alumniRows || []).length,
      country_distribution: countryDist,
      sample_headlines: samples,
    },
  };

  // 7. Gap heatmap — program × skill demand-vs-coverage
  // Demand: top skill from chosen source (extracted or reports)
  // Coverage: # courses in program that teach that skill
  const topDemandSkills = (topSkillsData?.items || []).slice(0, 25);

  // Fetch program → course → skill links for this college
  const { data: cpRows } = await supabase
    .from("college_programs")
    .select("id, name, abbreviation, degree_type")
    .eq("college_id", college_id)
    .limit(80);

  const programList = cpRows || [];
  const programIds = programList.map((p: any) => p.id);

  // Join program_courses → course_skills
  const { data: progCourses } = await supabase
    .from("program_courses")
    .select("program_id, course_id")
    .in("program_id", programIds);

  const courseIds = Array.from(new Set((progCourses || []).map((r: any) => r.course_id)));

  const { data: courseSkillRows } = courseIds.length > 0
    ? await supabase
        .from("course_skills")
        .select("course_id, taxonomy_skill_id")
        .in("course_id", courseIds)
        .not("taxonomy_skill_id", "is", null)
    : { data: [] };

  // Map: program_id → Set<taxonomy_skill_id> → courses_covering_count
  const programSkillCoverage: Record<string, Record<string, number>> = {};
  (progCourses || []).forEach((pc: any) => {
    if (!programSkillCoverage[pc.program_id]) programSkillCoverage[pc.program_id] = {};
  });
  // For each course_skill, attribute to every program containing this course
  const courseToPrograms: Record<string, string[]> = {};
  (progCourses || []).forEach((pc: any) => {
    if (!courseToPrograms[pc.course_id]) courseToPrograms[pc.course_id] = [];
    courseToPrograms[pc.course_id].push(pc.program_id);
  });
  (courseSkillRows || []).forEach((cs: any) => {
    const programs = courseToPrograms[cs.course_id] || [];
    programs.forEach((pid) => {
      if (!programSkillCoverage[pid]) programSkillCoverage[pid] = {};
      programSkillCoverage[pid][cs.taxonomy_skill_id] = (programSkillCoverage[pid][cs.taxonomy_skill_id] || 0) + 1;
    });
  });

  // Build heatmap cells
  const heatmap: any[] = [];
  programList.forEach((p: any) => {
    const coverage = programSkillCoverage[p.id] || {};
    topDemandSkills.forEach((s: any) => {
      const cover = coverage[s.taxonomy_skill_id] || 0;
      heatmap.push({
        program_id: p.id,
        program_name: p.abbreviation || p.name,
        skill_id: s.taxonomy_skill_id,
        skill_name: s.name,
        demand_score: s.count, // raw demand count
        coverage_courses: cover,
      });
    });
  });

  const gapPanel: Panel<any> = {
    data_quality: topSkillsQuality, // inherits from demand source
    note: topSkillsNote ? `Demand: ${topSkillsNote.toLowerCase()}` : undefined,
    data: {
      programs: programList.map((p: any) => ({ id: p.id, name: p.abbreviation || p.name })),
      skills: topDemandSkills.map((s: any) => ({ id: s.taxonomy_skill_id, name: s.name, demand_score: s.count })),
      cells: heatmap,
    },
  };

  // 8. Exec summary — derive top 3 strengths / gaps / emerging skills
  const skillsWithCoverage = topDemandSkills.map((s: any) => {
    let totalCoverage = 0;
    programList.forEach((p: any) => {
      totalCoverage += (programSkillCoverage[p.id] || {})[s.taxonomy_skill_id] || 0;
    });
    return { ...s, total_coverage: totalCoverage };
  });

  const strengths = skillsWithCoverage
    .filter((s: any) => s.total_coverage > 0)
    .sort((a: any, b: any) => b.total_coverage - a.total_coverage)
    .slice(0, 3)
    .map((s: any) => ({ skill: s.name, demand: s.count, coverage: s.total_coverage }));

  const gaps = skillsWithCoverage
    .filter((s: any) => s.total_coverage === 0)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 3)
    .map((s: any) => ({ skill: s.name, demand: s.count, coverage: 0 }));

  const emerging = skillsWithCoverage
    .filter((s: any) => s.total_coverage <= 1 && s.count >= (topDemandSkills[0]?.count || 100) / 5)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 3)
    .map((s: any) => ({ skill: s.name, demand: s.count, coverage: s.total_coverage }));

  const execPanel: Panel<any> = {
    data_quality: topSkillsQuality,
    data: { strengths, gaps, emerging },
  };

  return {
    college_id,
    generated_at: new Date().toISOString(),
    panels: {
      hero,
      programs: programsPanel,
      uae_jobs: uaeJobsPanel,
      top_skills: topSkillsPanel,
      college_jobs: collegeJobsPanel,
      alumni: alumniPanel,
      gap_heatmap: gapPanel,
      exec_summary: execPanel,
    },
  };
}

// ── Route handler (authenticated) ────────────────────────────────────
export async function handleCollegeDashboardRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  // GET /college-dashboard/:id
  const match = path.match(/^\/college-dashboard\/([0-9a-f-]{36})$/i);
  if (match && req.method === "GET") {
    if (!requireReader(auth, "college_dashboard", res)) return;
    try {
      const payload = await buildDashboardPayload(match[1]);
      return res.json(payload);
    } catch (e: any) {
      console.error("[college-dashboard] error:", e);
      return res.status(500).json({ error: e?.message || "Failed to build dashboard" });
    }
  }
  return undefined;
}

// ── Route handler (public — auth-bypassed) ───────────────────────────
export async function handlePublicCollegeDashboardRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse | undefined> {
  // GET /public/college-dashboard/by-slug/:slug
  const match = path.match(/^\/public\/college-dashboard\/by-slug\/([a-z0-9-]{6,64})$/i);
  if (match && req.method === "GET") {
    const slug = match[1].toLowerCase();
    const collegeId = DEMO_SLUGS[slug];
    if (!collegeId) {
      return res.status(404).json({ error: "Unknown share token" });
    }
    try {
      const payload = await buildDashboardPayload(collegeId);
      // Tag the payload so the frontend knows it's the public demo view
      payload.view = "public_demo";
      payload.slug = slug;
      return res.json(payload);
    } catch (e: any) {
      console.error("[public college-dashboard] error:", e);
      return res.status(500).json({ error: e?.message || "Failed to build dashboard" });
    }
  }
  return undefined;
}
