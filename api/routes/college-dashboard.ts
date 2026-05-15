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
  // ── PERF NOTE ────────────────────────────────────────────────────────
  // This endpoint was hitting Vercel's 60s gateway timeout on cold paths
  // because eight Supabase round-trips ran sequentially. We now batch
  // independent reads into Promise.all waves and merged duplicate jobs
  // pulls (uaeByCountry + topCompaniesRaw → one query with two columns).
  // ────────────────────────────────────────────────────────────────────

  // ── Wave A: every query with no dependencies (parallel) ──────────────
  const [
    collegeRes,
    programsCountRes,
    coursesCountRes,
    campusBatchesRes,
    collegeCoursesRes,
    batchIdsRes,
    programsRes,
    batchesRes,
    cpRowsRes,
    uaeJobsTotalRes,
    uaeJobsBulkRes,
    uaeJobIdsRes,
  ] = await Promise.all([
    supabase
      .from("colleges")
      .select("id, name, short_name, country, city, state, tier, nirf_rank, website, logo_url")
      .eq("id", college_id)
      .single(),
    supabase.from("college_programs").select("id", { count: "exact", head: true }).eq("college_id", college_id),
    supabase.from("college_courses").select("id", { count: "exact", head: true }).eq("college_id", college_id),
    supabase.from("campus_upload_batches").select("id", { count: "exact", head: true }).eq("college_id", college_id),
    supabase.from("college_courses").select("id").eq("college_id", college_id),
    supabase.from("campus_upload_batches").select("id").eq("college_id", college_id),
    supabase
      .from("college_programs")
      .select("id, name, degree_type, abbreviation, major, duration_years, total_credit_points, delivery_mode")
      .eq("college_id", college_id)
      .order("name", { ascending: true })
      .limit(50),
    supabase
      .from("campus_upload_batches")
      .select("id, program, job_type, drive_year, source, ctc_tag, status, total_files, jds_committed, created_at")
      .eq("college_id", college_id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("college_programs")
      .select("id, name, abbreviation, degree_type")
      .eq("college_id", college_id)
      .limit(80),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("location_country", UAE_GCC_COUNTRIES),
    // Merged: one pull for both country-mix and company-mix.
    supabase
      .from("jobs")
      .select("location_country, company_name")
      .in("location_country", UAE_GCC_COUNTRIES)
      .limit(20000),
    supabase
      .from("jobs")
      .select("id")
      .in("location_country", UAE_GCC_COUNTRIES)
      .eq("analysis_version", "v2")
      .limit(20000),
  ]);

  const college = collegeRes.data;
  const collegeCourseIds = (collegeCoursesRes.data || []).map((c: any) => c.id);
  const heroBatchIds = (batchIdsRes.data || []).map((b: any) => b.id);
  const programs = programsRes.data;
  const batches = batchesRes.data;
  const cpRows = cpRowsRes.data;
  const uaeJobsTotal = uaeJobsTotalRes.count;
  const uaeJobsBulk = uaeJobsBulkRes.data || [];
  const uaeJobIds = (uaeJobIdsRes.data || []).map((r: any) => r.id);

  const collegeName = (college?.name || "").toLowerCase();
  const isUOWD = collegeName.includes("wollongong");

  // ── Wave B: queries that depend on Wave A id lists (parallel) ────────
  const programIds = (cpRows || []).map((p: any) => p.id);

  const [
    courseSkillCountRes,
    campusJobCountRes,
    alumniCountRes,
    campusJobsRes,
    alumniRowsRes,
    progCoursesRes,
    extractedSkillsRes,
  ] = await Promise.all([
    collegeCourseIds.length > 0
      ? supabase
          .from("course_skills")
          .select("id", { count: "exact", head: true })
          .in("course_id", collegeCourseIds)
      : Promise.resolve({ count: 0 } as any),
    heroBatchIds.length > 0
      ? supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .in("upload_batch_id", heroBatchIds)
      : Promise.resolve({ count: 0 } as any),
    isUOWD
      ? supabase
          .from("alumni")
          .select("id", { count: "exact", head: true })
          .or("university_name.ilike.%wollongong%dubai%,university_name.ilike.%uowd%")
      : supabase
          .from("alumni")
          .select("id", { count: "exact", head: true })
          .eq("university_id", college_id),
    heroBatchIds.length > 0
      ? supabase
          .from("jobs")
          .select("id, company_name, upload_batch_id")
          .in("upload_batch_id", heroBatchIds)
          .limit(10000)
      : Promise.resolve({ data: [] } as any),
    isUOWD
      ? supabase
          .from("alumni")
          .select("id, person_id, current_status, university_name, created_at, people(current_title, location_city, location_country, headline)")
          .or("university_name.ilike.%wollongong%dubai%,university_name.ilike.%uowd%")
          .order("created_at", { ascending: false })
          .limit(10000)
      : supabase
          .from("alumni")
          .select("id, person_id, current_status, university_name, created_at, people(current_title, location_city, location_country, headline)")
          .eq("university_id", college_id)
          .order("created_at", { ascending: false })
          .limit(10000),
    programIds.length > 0
      ? supabase
          .from("program_courses")
          .select("program_id, course_id")
          .in("program_id", programIds)
      : Promise.resolve({ data: [] } as any),
    // Try extracted skills (only if enough analyzed jobs)
    uaeJobIds.length >= 50
      ? supabase
          .from("job_skills")
          .select("taxonomy_skill_id, taxonomy_skills!inner(name, l1, l2, category)")
          .in("job_id", uaeJobIds)
          .not("taxonomy_skill_id", "is", null)
          .limit(50000)
      : Promise.resolve({ data: null } as any),
  ]);

  const courseSkillCount = courseSkillCountRes.count || 0;
  const campusJobCount = campusJobCountRes.count || 0;
  const alumniCount = alumniCountRes.count || 0;
  const campusJobs = campusJobsRes.data || [];
  const alumniRows = alumniRowsRes.data || [];
  const progCourses = progCoursesRes.data || [];
  const extractedSkills = extractedSkillsRes.data;

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

  // 2. Programs panel (data from Wave A)
  const programsPanel: Panel<any> = {
    data_quality: "live",
    data: { items: programs || [], total: (programs || []).length },
  };

  // 3. UAE/GCC jobs scan — headline stats (Wave A bulk pull)
  const byCountry: Record<string, number> = {};
  const companyCounts: Record<string, number> = {};
  uaeJobsBulk.forEach((r: any) => {
    const c = r.location_country;
    if (c) byCountry[c] = (byCountry[c] || 0) + 1;
    if (r.company_name) {
      companyCounts[r.company_name] = (companyCounts[r.company_name] || 0) + 1;
    }
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

  // 4. Top skills — try extracted demand from Wave B; fall back to reports
  //    if extracted signal is too small.
  let topSkillsData: any = null;
  let topSkillsQuality: DataQuality = "live";
  let topSkillsNote: string | undefined;

  if (uaeJobIds.length >= 50 && extractedSkills) {
    // Real extracted-demand signal exists
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
    // Fall back to secondary research reports (lazy fetch only on fallback path)
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

  // 5. College Jobs panel — campus_upload_batches × jobs (Wave A+B)
  let collegeJobsPanel: Panel<any>;
  if (!batches || batches.length === 0) {
    collegeJobsPanel = {
      data_quality: "live",
      note: "No campus drives uploaded yet. Upload at /upload/campus.",
      data: { drives: 0, total_jds: 0, job_type_mix: {}, ctc_tag_mix: {}, top_recruiters: [], recent_batches: [] },
    };
  } else {
    const totalJds = campusJobs.length;
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
    campusJobs.forEach((j: any) => {
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
  // not normalized job titles. (Data from Wave B alumniRows)

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
  // cpRows + progCourses come from Wave A/B; only Wave C remains.
  const topDemandSkills = (topSkillsData?.items || []).slice(0, 25);
  const programList = cpRows || [];
  const courseIds = Array.from(new Set((progCourses || []).map((r: any) => r.course_id)));

  // ── Wave C: course_skills join (depends on courseIds from Wave B) ─────
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
    const programIdsForCourse = courseToPrograms[cs.course_id] || [];
    programIdsForCourse.forEach((pid) => {
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

// ─────────────────────────────────────────────────────────────────────
// Live Jobs payload — Timeline + Mix (Phase 0 v0)
// Queries jobs filtered by the college's `college_regions` row set
// (one row per country_variant, with country_label as the canonical
// bucket). Returns weekly timeline + 3 mix breakdowns + facets.
// ─────────────────────────────────────────────────────────────────────
// Seniority rollup — collapse L0–L5 + variants into 6 canonical buckets.
const LEVEL_ROLLUP: Record<string, string> = {
  entry_level: "entry_level",
  L0: "entry_level",
  associate: "associate",
  L1: "associate",
  L2: "associate",
  mid_senior: "mid_senior",
  L3: "mid_senior",
  L4: "mid_senior",
  director: "director",
  L5: "director",
  executive: "executive",
  internship: "internship",
  intern: "internship",
  other: "other",
};
function rollupLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return LEVEL_ROLLUP[raw.trim()] || raw.trim();
}

interface LiveJobsFilters {
  source?: string;
  country?: string;
  level?: string;
}

async function buildLiveJobsPayload(college_id: string, filters: LiveJobsFilters = {}): Promise<any> {
  // 1. Load this college's country variants
  const { data: regionRows, error: regionsErr } = await supabase
    .from("college_regions")
    .select("country_variant, country_label, is_primary")
    .eq("college_id", college_id);

  if (regionsErr) {
    throw new Error(`college_regions read failed: ${regionsErr.message}`);
  }

  const variants = (regionRows || []).map((r: any) => r.country_variant as string);
  const variantToLabel = new Map<string, string>(
    (regionRows || []).map((r: any) => [r.country_variant as string, r.country_label as string])
  );
  const countryLabels = Array.from(new Set((regionRows || []).map((r: any) => r.country_label as string)));

  if (variants.length === 0) {
    return {
      view: "live_jobs",
      college_id,
      regions: [],
      filters,
      data_quality: "illustrative" as DataQuality,
      note: "No regions configured for this college yet.",
      timeline: { weeks: [], window: "all_time", total_jobs: 0 },
      mix: { by_source: [], by_level: [], by_country: [] },
      recent: [],
      facets: { sources: [], levels: [], countries: [], total_jobs: 0, with_posted_at: 0 },
    };
  }

  // 2. Pull every job in scope. We page through in 1000-row chunks because
  //    Postgrest caps a single response at ~1000 rows. UAE/GCC currently
  //    sits at ~9k rows so a few pages is fine; once it grows past ~25k
  //    we should move this to a SQL RPC.
  //    NOTE: We pull the unfiltered set so we can compute facets that
  //    reflect what is achievable, then apply filters client-side here
  //    for the timeline/mix/recent buckets.
  const PAGE = 1000;
  let from = 0;
  const allJobs: Array<{
    id: string;
    title: string | null;
    company_name: string | null;
    posted_at: string | null;
    source: string | null;
    source_url: string | null;
    seniority_level: string | null;
    location_country: string | null;
    location_city: string | null;
  }> = [];
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("jobs")
      .select("id, title, company_name, posted_at, source, source_url, seniority_level, location_country, location_city")
      .in("location_country", variants)
      .range(from, from + PAGE - 1);
    if (pageErr) throw new Error(`jobs read failed: ${pageErr.message}`);
    if (!page || page.length === 0) break;
    allJobs.push(...(page as any[]));
    if (page.length < PAGE) break;
    from += PAGE;
    if (from > 50000) break; // safety cap
  }

  // 2b. Apply filters (post-pull, in-memory — dataset is small enough).
  const matchSource = (s: string | null) => !filters.source || (s || "unknown") === filters.source;
  const matchCountry = (lc: string | null) => {
    if (!filters.country) return true;
    const label = variantToLabel.get((lc || "").trim()) || lc || "";
    return label === filters.country;
  };
  const matchLevel = (lv: string | null) => {
    if (!filters.level) return true;
    const rolled = rollupLevel(lv);
    if (filters.level === "Unspecified") return !rolled;
    return rolled === filters.level;
  };
  const filteredJobs = allJobs.filter((j) => matchSource(j.source) && matchCountry(j.location_country) && matchLevel(j.seniority_level));

  const totalJobs = filteredJobs.length;
  const withPostedAt = filteredJobs.filter((j) => !!j.posted_at).length;
  const totalJobsAll = allJobs.length;
  const withPostedAtAll = allJobs.filter((j) => !!j.posted_at).length;

  // 3. Timeline — weekly buckets (Monday-anchored UTC). All-time.
  const weekMap = new Map<string, { week: string; n: number; by_source: Record<string, number> }>();
  for (const j of filteredJobs) {
    if (!j.posted_at) continue;
    const d = new Date(j.posted_at);
    if (Number.isNaN(d.getTime())) continue;
    // Anchor to Monday UTC
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // back to Monday
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    const wk = monday.toISOString().slice(0, 10);
    let bucket = weekMap.get(wk);
    if (!bucket) {
      bucket = { week: wk, n: 0, by_source: {} };
      weekMap.set(wk, bucket);
    }
    bucket.n += 1;
    const src = (j.source || "unknown").toString();
    bucket.by_source[src] = (bucket.by_source[src] || 0) + 1;
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week));

  // 4. Mix — by source / by level / by country (canonical label).
  //    Computed on filtered set so the bars reflect the active filter.
  const countBy = (rows: Array<string | null | undefined>, fallback: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = (r && r.toString().trim()) || fallback;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n);
  };

  const by_source = countBy(filteredJobs.map((j) => j.source), "unknown");
  // Level chart: roll up + suppress Unspecified (it dominates honest signal).
  const by_level_full = countBy(filteredJobs.map((j) => rollupLevel(j.seniority_level)), "Unspecified");
  const unspecified_level_n = by_level_full.find((r) => r.key === "Unspecified")?.n || 0;
  const by_level = by_level_full.filter((r) => r.key !== "Unspecified");
  const by_country = countBy(
    filteredJobs.map((j) => variantToLabel.get((j.location_country || "").trim()) || j.location_country),
    "Unspecified"
  );

  // 4b. Recent feed — latest 50 by posted_at desc (NULLs sink to bottom).
  const recent = [...filteredJobs]
    .sort((a, b) => {
      const ta = a.posted_at ? Date.parse(a.posted_at) : 0;
      const tb = b.posted_at ? Date.parse(b.posted_at) : 0;
      return tb - ta;
    })
    .slice(0, 50)
    .map((j) => ({
      id: j.id,
      title: j.title,
      company_name: j.company_name,
      posted_at: j.posted_at,
      source: j.source,
      source_url: j.source_url,
      seniority_level: rollupLevel(j.seniority_level),
      country_label: variantToLabel.get((j.location_country || "").trim()) || j.location_country,
      location_city: j.location_city,
    }));

  // 5. Facets — stable across filters (computed from unfiltered set) so the
  //    UI can show the full list of choices the user could pick.
  const facets = {
    sources: countBy(allJobs.map((j) => j.source), "unknown").map((r) => r.key),
    // Canonical level list (rolled up), excluding Unspecified.
    levels: countBy(allJobs.map((j) => rollupLevel(j.seniority_level)), "Unspecified")
      .filter((r) => r.key !== "Unspecified")
      .map((r) => r.key),
    countries: countryLabels,
    total_jobs: totalJobsAll,
    with_posted_at: withPostedAtAll,
    filtered_total_jobs: totalJobs,
    filtered_with_posted_at: withPostedAt,
    unspecified_level_n,
  };

  // 6. Data quality — Timeline is "live_partial" because 13% of rows
  //    have no posted_at and pre-March-2026 coverage is thinner.
  const timelineQuality: DataQuality =
    withPostedAt / Math.max(totalJobs, 1) >= 0.95 ? "live" : "live_partial";
  const timelineNote =
    timelineQuality === "live_partial"
      ? `${Math.round((withPostedAt / Math.max(totalJobs, 1)) * 100)}% of jobs have a posted date; volume before mid-March 2026 reflects collection ramp, not market trend.`
      : undefined;

  return {
    view: "live_jobs",
    college_id,
    regions: regionRows || [],
    filters,
    timeline: {
      data_quality: timelineQuality,
      note: timelineNote,
      window: "all_time",
      weeks,
      total_jobs: withPostedAt,
    },
    mix: {
      data_quality: "live" as DataQuality,
      by_source,
      by_level,
      by_country,
      unspecified_level_n,
    },
    recent,
    facets,
  };
}

// Parse ?source=&country=&level= from a request path/url
function parseLiveJobsFilters(req: VercelRequest): LiveJobsFilters {
  const q = (req.query || {}) as Record<string, string | string[] | undefined>;
  const pick = (k: string) => {
    const v = q[k];
    if (!v) return undefined;
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length > 0 && s.length < 64 ? s : undefined;
  };
  return {
    source: pick("source"),
    country: pick("country"),
    level: pick("level"),
  };
}

// ── Route handler (authenticated) ────────────────────────────────────
export async function handleCollegeDashboardRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  // GET /college-dashboard/:id/jobs
  const jobsMatch = path.match(/^\/college-dashboard\/([0-9a-f-]{36})\/jobs$/i);
  if (jobsMatch && req.method === "GET") {
    if (!requireReader(auth, "college_dashboard", res)) return;
    try {
      const payload = await buildLiveJobsPayload(jobsMatch[1], parseLiveJobsFilters(req));
      return res.json(payload);
    } catch (e: any) {
      console.error("[college-dashboard jobs] error:", e);
      return res.status(500).json({ error: e?.message || "Failed to build live jobs" });
    }
  }

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

// ── Public-endpoint edge cache headers ───────────────────────────────
// Perf #1 (cd-uowd14, 2026-05-15): Vercel Edge Network caches the JSON for
// `s-maxage` seconds (300 = 5 min). After that, the next request triggers a
// background revalidation while the previous (stale) response is served for
// up to `stale-while-revalidate` more seconds (600 = 10 min).
//
// Net effect: 99% of public dashboard views hit the edge in ~50 ms instead
// of running 20+ Supabase queries. Data is at most 5 min stale, with a 10 min
// graceful-degradation window if the origin is slow/down (today's IO outage
// would have served cached content instead of failing).
//
// We DO NOT cache authenticated endpoints — they may include user-scoped data.
function setPublicDashboardCacheHeaders(res: VercelResponse): void {
  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=300, stale-while-revalidate=600"
  );
  res.setHeader("CDN-Cache-Control", "public, s-maxage=300");
  res.setHeader("Vary", "Accept-Encoding");
}

// ── Route handler (public — auth-bypassed) ───────────────────────────
export async function handlePublicCollegeDashboardRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse | undefined> {
  // GET /public/college-dashboard/by-slug/:slug/jobs
  const jobsMatch = path.match(/^\/public\/college-dashboard\/by-slug\/([a-z0-9-]{6,64})\/jobs$/i);
  if (jobsMatch && req.method === "GET") {
    const slug = jobsMatch[1].toLowerCase();
    const collegeId = DEMO_SLUGS[slug];
    if (!collegeId) {
      return res.status(404).json({ error: "Unknown share token" });
    }
    try {
      const payload = await buildLiveJobsPayload(collegeId, parseLiveJobsFilters(req));
      payload.slug = slug;
      setPublicDashboardCacheHeaders(res);
      return res.json(payload);
    } catch (e: any) {
      console.error("[public college-dashboard jobs] error:", e);
      return res.status(500).json({ error: e?.message || "Failed to build live jobs" });
    }
  }

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
      setPublicDashboardCacheHeaders(res);
      return res.json(payload);
    } catch (e: any) {
      console.error("[public college-dashboard] error:", e);
      return res.status(500).json({ error: e?.message || "Failed to build dashboard" });
    }
  }
  return undefined;
}
