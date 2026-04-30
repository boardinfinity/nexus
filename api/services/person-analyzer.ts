// ============================================================================
// person-analyzer.ts — the engine of the Alumni Insights v1 feature.
//
// Implements the three layers run synchronously per profile:
//   Layer 1: program master mapping (LLM-cached per (college_id, raw_degree, raw_field))
//   Layer 2: profile snapshot extraction (full alumni_profile_snapshot JSON)
//   Layer 3: job bucketing for first job + current job (deterministic shortcuts → LLM)
//
// Idempotency:
//   - Skip-on-content-hash: SHA-256 of canonical(experience||education) is computed
//     before any LLM work. If a snapshot row exists with the same hash AND the same
//     schema_version AND analyzed_at within `skipIfAnalyzedWithinHours`, we skip.
//   - Otherwise we UPSERT on (college_id, person_id, schema_version).
//
// Cost: ~$0.0003 per profile (gpt-4.1-mini streaming) → $3 per 10K profiles.
// Layer 3 LLM falls back only on ~30% of jobs, so amortized cost ≈ $0.00035/profile.
//
// Design decisions locked per /home/user/workspace/alumni_insights_design_context.md:
//   Q1 — CTC: bucket-implied bands only (read from bucket_ctc_bands)
//   Q2 — During-college internships: date overlap with alumni.start_year..graduation_year
//   Q3 — Comparison scope v1: same-college YoY only
//   Q4 — Bucket framework: generic schema, college framework picked via college_bucket_access
// ============================================================================

import crypto from "crypto";
import { supabase } from "../lib/supabase";
import { callGPT } from "../lib/openai";

// Current snapshot schema version. BUMP this when the snapshot JSON shape changes
// in a backward-incompatible way. Old version rows are kept; new rows get the new version.
export const CURRENT_SCHEMA_VERSION = 2;

// Default model for Layer 2 (profile extraction) and Layer 3 fallback (bucketing).
// Layer 1 (program mapping) also uses this model — it's cheap enough.
const DEFAULT_MODEL = "gpt-4.1-mini";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyzePersonInput {
  collegeId: string;
  personId: string;
  alumniId: string;
  // Pulled from the people row up front so the caller can batch the read.
  experience: any;          // jsonb from people.experience
  education: any;           // jsonb from people.education
  careerTransitions: any;   // jsonb from people.career_transitions (may be null)
  // Pulled from the alumni row up front.
  rawDegree: string | null;
  rawField: string | null;
  startYear: number | null;
  graduationYear: number | null;
  // Pipeline run context.
  runId: string;
  schemaVersion?: number;
  model?: string;
  skipIfAnalyzedWithinHours?: number;
}

export interface AnalyzePersonResult {
  status: "analyzed" | "skipped_unchanged" | "skipped_no_data" | "failed";
  reason?: string;
  snapshotId?: string;
  programMappingHit?: "cache" | "llm" | "fallback";
  bucketingShortcuts?: { firstJob?: 1 | 2 | 3 | null; currentJob?: 1 | 2 | 3 | null };
}

// ---------------------------------------------------------------------------
// Canonical content hash
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash of the canonical JSON form of the source profile data we feed to
 * Layer 2. Used to detect "nothing changed since last analysis" without trusting
 * `people.updated_at` (which may not bump on jsonb edits).
 *
 * Canonicalization:
 *   - Sort keys recursively so {a:1,b:2} and {b:2,a:1} hash identical.
 *   - Drop undefined/null values to avoid spurious diffs from optional fields.
 */
export function computeContentHash(experience: any, education: any): string {
  const canonical = JSON.stringify(
    { experience: canonicalize(experience), education: canonicalize(education) },
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(v: any): any {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      const c = canonicalize(v[k]);
      if (c !== null) out[k] = c;
    }
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function analyzePerson(input: AnalyzePersonInput): Promise<AnalyzePersonResult> {
  const schemaVersion = input.schemaVersion ?? CURRENT_SCHEMA_VERSION;
  const model = input.model ?? DEFAULT_MODEL;
  const skipHours = input.skipIfAnalyzedWithinHours ?? 24;

  // Bail early if the source data is empty — we can't analyze nothing.
  const hasExp = Array.isArray(input.experience) && input.experience.length > 0;
  const hasEdu = Array.isArray(input.education) && input.education.length > 0;
  if (!hasExp && !hasEdu) {
    return { status: "skipped_no_data", reason: "no experience or education data" };
  }

  // Compute hash and check for existing snapshot.
  const contentHash = computeContentHash(input.experience, input.education);
  if (skipHours > 0) {
    const { data: existing } = await supabase
      .from("alumni_profile_snapshots")
      .select("id, source_content_hash, analyzed_at")
      .eq("person_id", input.personId)
      .eq("college_id", input.collegeId)
      .eq("schema_version", schemaVersion)
      .maybeSingle();

    if (existing && existing.source_content_hash === contentHash && existing.analyzed_at) {
      const ageHours = (Date.now() - new Date(existing.analyzed_at).getTime()) / 3_600_000;
      if (ageHours < skipHours) {
        return { status: "skipped_unchanged", snapshotId: existing.id, reason: `hash match, age ${ageHours.toFixed(1)}h` };
      }
    }
  }

  try {
    // ---- Layer 1: program mapping ----
    const { programId, programHit } = await mapProgram({
      collegeId: input.collegeId,
      rawDegree: input.rawDegree ?? "",
      rawField: input.rawField ?? "",
      model,
    });

    // ---- Layer 2: profile snapshot ----
    const snapshot = await buildSnapshot({
      experience: input.experience,
      education: input.education,
      careerTransitions: input.careerTransitions,
      startYear: input.startYear,
      graduationYear: input.graduationYear,
      schemaVersion,
      model,
    });

    // ---- Layer 3: bucketing (first job + current job) ----
    const collegeFrameworkId = await resolveCollegeFramework(input.collegeId);
    const collegeTier = await resolveCollegeTier(input.collegeId);

    let firstJobShortcut: 1 | 2 | 3 | null = null;
    let currentJobShortcut: 1 | 2 | 3 | null = null;

    if (snapshot.immediate_after_college?.first_job?.company_name) {
      const fjResult = await bucketJob({
        companyName: snapshot.immediate_after_college.first_job.company_name,
        title: snapshot.immediate_after_college.first_job.title || "",
        frameworkId: collegeFrameworkId,
        model,
      });
      firstJobShortcut = fjResult.shortcut;
      if (fjResult.bucket) {
        snapshot.immediate_after_college.first_job.bucket_id = fjResult.bucket.id;
        snapshot.immediate_after_college.first_job.bucket_code = fjResult.bucket.code;
        snapshot.immediate_after_college.first_job.job_function = fjResult.bucket.domain || null;
        // CTC band lookup
        const ctcBand = await lookupCtcBand({
          bucketId: fjResult.bucket.id,
          geography: snapshot.immediate_after_college.first_job.location_country || "India",
          collegeTier,
        });
        if (ctcBand) {
          snapshot.immediate_after_college.first_job.ctc_band_label = ctcBand.label;
          snapshot.immediate_after_college.first_job.ctc_p25 = ctcBand.p25;
          snapshot.immediate_after_college.first_job.ctc_p50 = ctcBand.p50;
          snapshot.immediate_after_college.first_job.ctc_p75 = ctcBand.p75;
          snapshot.immediate_after_college.first_job.ctc_currency = ctcBand.currency;
        }
      }
    }

    if (snapshot.career_to_date?.current_job?.company_name) {
      const cjResult = await bucketJob({
        companyName: snapshot.career_to_date.current_job.company_name,
        title: snapshot.career_to_date.current_job.title || "",
        frameworkId: collegeFrameworkId,
        model,
      });
      currentJobShortcut = cjResult.shortcut;
      if (cjResult.bucket) {
        snapshot.career_to_date.current_job.bucket_id = cjResult.bucket.id;
        snapshot.career_to_date.current_job.bucket_code = cjResult.bucket.code;
      }
    }

    // SIP bucket (during-college internship at the company that became first job)
    let sipBucketId: string | null = null;
    if (snapshot.during_college?.sip_company_bucket_id === undefined) {
      const internships = snapshot.during_college?.internships || [];
      for (const ic of internships) {
        if (ic.company_name && ic.sub_type === "SIP") {
          const sipResult = await bucketJob({
            companyName: ic.company_name,
            title: ic.title || "",
            frameworkId: collegeFrameworkId,
            model,
          });
          if (sipResult.bucket) {
            ic.company_id = ic.company_id || null;
            sipBucketId = sipResult.bucket.id;
            snapshot.during_college.sip_company_bucket_id = sipBucketId;
          }
          break;
        }
      }
    }

    // is_ppo: first job company == any during-college internship company
    if (snapshot.immediate_after_college?.first_job?.company_name) {
      const fjCompany = normalizeCompanyName(snapshot.immediate_after_college.first_job.company_name);
      const internships = snapshot.during_college?.internships || [];
      snapshot.immediate_after_college.first_job.is_ppo = internships.some(
        (i: any) => i.company_name && normalizeCompanyName(i.company_name) === fjCompany,
      );
    }

    // ---- Persist ----
    const { data: saved, error } = await supabase
      .from("alumni_profile_snapshots")
      .upsert({
        college_id: input.collegeId,
        person_id: input.personId,
        program_id: programId,
        alumni_id: input.alumniId,
        schema_version: schemaVersion,
        snapshot,
        // Flat columns
        graduation_year: input.graduationYear,
        first_job_bucket_id: snapshot.immediate_after_college?.first_job?.bucket_id || null,
        first_job_bucket_code: snapshot.immediate_after_college?.first_job?.bucket_code || null,
        is_ppo: snapshot.immediate_after_college?.first_job?.is_ppo ?? null,
        sip_bucket_id: sipBucketId,
        undergrad_college_tier: snapshot.pre_college?.undergrad_college_tier || null,
        pre_college_total_exp_months: snapshot.pre_college?.total_work_months ?? null,
        current_job_bucket_id: snapshot.career_to_date?.current_job?.bucket_id || null,
        ctc_band_label: snapshot.immediate_after_college?.first_job?.ctc_band_label || null,
        completeness_score: snapshot.data_quality?.completeness_score ?? null,
        // Metadata
        model,
        analyzed_at: new Date().toISOString(),
        run_id: input.runId,
        source_content_hash: contentHash,
      }, { onConflict: "college_id,person_id,schema_version" })
      .select("id")
      .single();

    if (error) {
      return { status: "failed", reason: `upsert failed: ${error.message}` };
    }

    return {
      status: "analyzed",
      snapshotId: saved?.id,
      programMappingHit: programHit,
      bucketingShortcuts: { firstJob: firstJobShortcut, currentJob: currentJobShortcut },
    };
  } catch (err: any) {
    return { status: "failed", reason: err?.message?.slice(0, 300) || "unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Layer 1: Program Master Mapping
// ---------------------------------------------------------------------------

interface MapProgramInput {
  collegeId: string;
  rawDegree: string;
  rawField: string;
  model: string;
}

interface MapProgramResult {
  programId: string | null;
  confidence: number;
  programHit: "cache" | "llm" | "fallback";
}

async function mapProgram(input: MapProgramInput): Promise<MapProgramResult> {
  const rawDegree = (input.rawDegree || "").trim();
  const rawField = (input.rawField || "").trim();

  // Empty input → no LLM call, write a fallback cache row so we don't keep retrying.
  if (!rawDegree && !rawField) {
    return { programId: null, confidence: 0, programHit: "fallback" };
  }

  // Cache lookup.
  const { data: cached } = await supabase
    .from("program_mapping_cache")
    .select("mapped_program_id, confidence")
    .eq("college_id", input.collegeId)
    .eq("raw_degree", rawDegree)
    .eq("raw_field", rawField)
    .maybeSingle();

  if (cached) {
    return {
      programId: cached.mapped_program_id || null,
      confidence: cached.confidence || 0,
      programHit: "cache",
    };
  }

  // Cache miss — fetch the college's program list and ask the LLM.
  const { data: programs } = await supabase
    .from("college_programs")
    .select("id, name, degree_type, major, abbreviation")
    .eq("college_id", input.collegeId)
    .eq("is_active", true);

  if (!programs || programs.length === 0) {
    // No programs configured for this college — record fallback and move on.
    await supabase.from("program_mapping_cache").upsert({
      college_id: input.collegeId,
      raw_degree: rawDegree,
      raw_field: rawField,
      mapped_program_id: null,
      confidence: 0,
      model: input.model,
    }, { onConflict: "college_id,raw_degree,raw_field" });
    return { programId: null, confidence: 0, programHit: "fallback" };
  }

  const prompt = `You are a university program classifier. Given a college's program list and a raw degree/field string from a LinkedIn profile, return the best matching program_id and a confidence score 0-1.

College programs:
${JSON.stringify(programs.map(p => ({ id: p.id, name: p.name, degree_type: p.degree_type, major: p.major, abbreviation: p.abbreviation })))}

LinkedIn raw values:
  raw_degree: "${rawDegree}"
  raw_field:  "${rawField}"

Return ONLY a JSON object with keys: program_id (uuid or null), confidence (number 0-1), reasoning (string, max 80 chars).
If no program is a clear match, return program_id: null with confidence below 0.6.`;

  let programId: string | null = null;
  let confidence = 0;
  try {
    const raw = await callGPT(prompt);
    const parsed = JSON.parse(raw);
    confidence = Number(parsed.confidence) || 0;
    if (parsed.program_id && confidence >= 0.6) {
      // Validate it's actually one of the offered IDs.
      if (programs.some(p => p.id === parsed.program_id)) {
        programId = parsed.program_id;
      }
    }
  } catch {
    // LLM parse failed — leave programId null.
  }

  // Cache the result regardless of confidence (so we don't keep retrying).
  await supabase.from("program_mapping_cache").upsert({
    college_id: input.collegeId,
    raw_degree: rawDegree,
    raw_field: rawField,
    mapped_program_id: programId,
    confidence,
    model: input.model,
  }, { onConflict: "college_id,raw_degree,raw_field" });

  return { programId, confidence, programHit: "llm" };
}

// ---------------------------------------------------------------------------
// Layer 2: Profile Snapshot
// ---------------------------------------------------------------------------

interface BuildSnapshotInput {
  experience: any;
  education: any;
  careerTransitions: any;
  startYear: number | null;
  graduationYear: number | null;
  schemaVersion: number;
  model: string;
}

async function buildSnapshot(input: BuildSnapshotInput): Promise<any> {
  // We split the snapshot work into deterministic pieces (date math, overlap checks)
  // and one LLM call for the harder parts (undergrad tier classification, role/industry,
  // PPO/transition inference). This minimizes LLM tokens and keeps cost low.

  const exp = Array.isArray(input.experience) ? input.experience : [];
  const edu = Array.isArray(input.education) ? input.education : [];

  // ---- Deterministic: classify experiences as pre/during/post-college by date ----
  const startYear = input.startYear;
  const gradYear = input.graduationYear;

  const preCollege: any[] = [];
  const duringCollege: any[] = [];
  const postCollege: any[] = [];

  for (const e of exp) {
    const expStartYear = parseYear(e.starts_at);
    const expEndYear = parseYear(e.ends_at) ?? new Date().getFullYear();
    if (gradYear && expStartYear && expStartYear > gradYear) {
      postCollege.push(e);
    } else if (startYear && gradYear && expStartYear && expStartYear >= startYear && expEndYear <= gradYear + 1) {
      duringCollege.push(e);
    } else if (gradYear && expEndYear < startYear!) {
      preCollege.push(e);
    } else if (startYear && expStartYear && expStartYear < startYear) {
      preCollege.push(e);
    } else {
      // Ambiguous / overlapping — treat as during if it overlaps the program window,
      // otherwise post.
      if (
        startYear && gradYear &&
        expStartYear && expStartYear <= gradYear &&
        expEndYear >= startYear
      ) {
        duringCollege.push(e);
      } else {
        postCollege.push(e);
      }
    }
  }

  // Sort post-college by start date ascending; first one is "first_job".
  postCollege.sort((a, b) => (parseYearMonth(a.starts_at) || 0) - (parseYearMonth(b.starts_at) || 0));

  // Pre-college work months
  const preCollegeMonths = preCollege.reduce((sum, e) => sum + (durationMonths(e.starts_at, e.ends_at) || 0), 0);

  // Internship sub-type heuristic
  const internships = duringCollege.map(e => {
    const subType = classifyInternshipSubType(e.title || "", durationMonths(e.starts_at, e.ends_at) || 0);
    return {
      company_name: e.company || e.company_name || null,
      title: e.title || null,
      start_month: monthString(e.starts_at),
      end_month: monthString(e.ends_at),
      duration_months: durationMonths(e.starts_at, e.ends_at),
      sub_type: subType,
      ppo_offered: null,
      ppo_converted: null,
      company_id: null,
    };
  });

  const firstJob = postCollege[0] || null;
  const currentJob = postCollege.find(e => !e.ends_at) || postCollege[postCollege.length - 1] || null;

  // ---- LLM: undergrad tier + transition classification ----
  const llmPart = await llmEnrichSnapshot({
    education: edu,
    preCollegeRoles: preCollege.map(e => ({ company: e.company, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at })),
    postCollegeJobs: postCollege.map(e => ({ company: e.company, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at })),
    model: input.model,
  });

  // ---- Compose snapshot ----
  const snapshot: any = {
    schema_version: input.schemaVersion,
    analysis_version: new Date().toISOString().slice(0, 10),
    model: input.model,

    pre_college: {
      undergrad_college_name: llmPart.undergrad_college_name,
      undergrad_college_tier: llmPart.undergrad_college_tier,
      undergrad_degree: llmPart.undergrad_degree,
      undergrad_field: llmPart.undergrad_field,
      undergrad_graduation_year: llmPart.undergrad_graduation_year,
      total_work_months: preCollegeMonths,
      role_list: preCollege.map(e => e.title).filter(Boolean),
      industry_list: llmPart.pre_college_industries || [],
      has_prior_mba: llmPart.has_prior_mba ?? false,
      num_employers_pre_college: new Set(preCollege.map(e => e.company).filter(Boolean)).size,
    },

    during_college: {
      internships,
      projects: [],
      exchange_programs: [],
      certifications: [],
      internship_count: internships.length,
      sip_company_bucket_id: null, // filled by Layer 3 caller
    },

    immediate_after_college: {
      first_job: firstJob ? {
        company_name: firstJob.company || firstJob.company_name || null,
        company_id: null,
        title: firstJob.title || null,
        job_function: null,
        job_family: null,
        bucket_id: null,
        bucket_code: null,
        ctc_band_label: null,
        ctc_p25: null,
        ctc_p50: null,
        ctc_p75: null,
        ctc_currency: null,
        is_ppo: null,
        location_city: firstJob.location_city || null,
        location_country: firstJob.location_country || null,
        start_month: monthString(firstJob.starts_at),
        duration_months: durationMonths(firstJob.starts_at, firstJob.ends_at),
        is_current: !firstJob.ends_at,
      } : null,
      immediate_further_education: llmPart.immediate_further_education || null,
    },

    career_to_date: {
      current_job: currentJob ? {
        company_name: currentJob.company || currentJob.company_name || null,
        title: currentJob.title || null,
        bucket_id: null,
        bucket_code: null,
        start_month: monthString(currentJob.starts_at),
        is_current: !currentJob.ends_at,
      } : null,
      total_post_college_exp_months: postCollege.reduce((s, e) => s + (durationMonths(e.starts_at, e.ends_at) || 0), 0),
      n_companies_post_college: new Set(postCollege.map(e => e.company).filter(Boolean)).size,
      n_promotions_detected: llmPart.n_promotions_detected ?? 0,
      transitions: llmPart.transitions || [],
    },

    data_quality: {
      completeness_score: computeCompletenessScore({
        hasExperience: exp.length > 0,
        hasEducation: edu.length > 0,
        hasGradYear: gradYear != null,
        hasUndergradTier: !!llmPart.undergrad_college_tier,
        hasFirstJob: !!firstJob,
      }),
      fields_inferred: llmPart.fields_inferred || [],
      fields_missing: llmPart.fields_missing || [],
      has_experience_data: exp.length > 0,
      has_education_data: edu.length > 0,
      graduation_year_source: gradYear ? "alumni_record" : "missing",
    },
  };

  return snapshot;
}

// ---------------------------------------------------------------------------
// Layer 2 helper: LLM enrichment (the only LLM call for snapshot extraction)
// ---------------------------------------------------------------------------

async function llmEnrichSnapshot(args: {
  education: any[];
  preCollegeRoles: any[];
  postCollegeJobs: any[];
  model: string;
}): Promise<any> {
  const prompt = `You are an alumni profile analyzer. Given LinkedIn education and work history, extract structured info.

Education entries (jsonb):
${JSON.stringify(args.education).slice(0, 4000)}

Pre-MBA roles (chronological):
${JSON.stringify(args.preCollegeRoles).slice(0, 2000)}

Post-MBA jobs (chronological):
${JSON.stringify(args.postCollegeJobs).slice(0, 2000)}

Return a JSON object with these keys (use null for missing values):
{
  "undergrad_college_name": "string",
  "undergrad_college_tier": "string — one of: Cat-A+, Cat-A, Cat-B, Cat-C, Unknown",
  "undergrad_degree": "string — e.g. B.Tech, B.Com, BBA",
  "undergrad_field": "string — e.g. Computer Science, Commerce",
  "undergrad_graduation_year": 2018,
  "pre_college_industries": ["Technology", "BFSI"],
  "has_prior_mba": false,
  "n_promotions_detected": 0,
  "transitions": [
    { "from_company": "X", "from_bucket_code": null, "to_company": "Y", "to_bucket_code": null, "gap_months": 1, "transition_type": "lateral|step_up|step_down|sector_switch" }
  ],
  "immediate_further_education": null,
  "fields_inferred": ["undergrad_college_tier"],
  "fields_missing": []
}

Tier rules:
- Cat-A+: IIT/IIM/IISc/ISB/AIIMS/NLU
- Cat-A:  NIT/BITS/DTU/NITIE/SIBM/MDI/XLRI/IIFT
- Cat-B:  Tier-1 state univs, top state engineering colleges
- Cat-C:  other private colleges
- Unknown if you can't tell

Return ONLY the JSON object, no surrounding text.`;

  try {
    const raw = await callGPT(prompt);
    return JSON.parse(raw);
  } catch (err) {
    return {
      undergrad_college_name: null,
      undergrad_college_tier: "Unknown",
      undergrad_degree: null,
      undergrad_field: null,
      undergrad_graduation_year: null,
      pre_college_industries: [],
      has_prior_mba: false,
      n_promotions_detected: 0,
      transitions: [],
      immediate_further_education: null,
      fields_inferred: [],
      fields_missing: ["llm_enrichment_failed"],
    };
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Job Bucketing (deterministic shortcuts → LLM fallback)
// ---------------------------------------------------------------------------

interface BucketJobInput {
  companyName: string;
  title: string;
  frameworkId: string | null;
  model: string;
}

interface BucketJobResult {
  bucket: { id: string; code: string; name: string; domain: string | null } | null;
  shortcut: 1 | 2 | 3 | null;
}

async function bucketJob(input: BucketJobInput): Promise<BucketJobResult> {
  if (!input.frameworkId) {
    return { bucket: null, shortcut: null };
  }

  const norm = normalizeCompanyName(input.companyName);

  // Shortcut 1: jobs table lookup (existing JD analyzer output)
  const { data: jobMatch } = await supabase
    .from("jobs")
    .select("bucket")
    .ilike("company", `%${input.companyName.slice(0, 40)}%`)
    .ilike("title", `%${input.title.slice(0, 40)}%`)
    .not("bucket", "is", null)
    .limit(1)
    .maybeSingle();

  if (jobMatch?.bucket) {
    const { data: b } = await supabase
      .from("buckets")
      .select("id, code, name, domain")
      .eq("framework_id", input.frameworkId)
      .eq("code", jobMatch.bucket)
      .maybeSingle();
    if (b) return { bucket: b, shortcut: 1 };
  }

  // Shortcut 2: bucket_companies trigram lookup
  const { data: bcMatch } = await supabase
    .from("bucket_companies")
    .select("bucket_id, weight, buckets!inner(id, code, name, domain, framework_id)")
    .eq("buckets.framework_id", input.frameworkId)
    .ilike("company_name", `%${norm.slice(0, 40)}%`)
    .gte("weight", 0.7)
    .order("weight", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bcMatch && (bcMatch as any).buckets) {
    const b = (bcMatch as any).buckets;
    return { bucket: { id: b.id, code: b.code, name: b.name, domain: b.domain }, shortcut: 2 };
  }

  // Shortcut 3: LLM mini-call
  const { data: buckets } = await supabase
    .from("buckets")
    .select("id, code, name, domain, description")
    .eq("framework_id", input.frameworkId)
    .order("code");

  if (!buckets || buckets.length === 0) {
    return { bucket: null, shortcut: null };
  }

  const prompt = `Classify the following job into ONE of the provided buckets. Return ONLY {"bucket_code":"BXX","confidence":0.92}.

Buckets:
${buckets.map(b => `${b.code}: ${b.name} (${b.domain || "—"})${b.description ? " — " + b.description.slice(0, 80) : ""}`).join("\n")}

Job:
  Company: ${input.companyName}
  Title:   ${input.title}

Confidence < 0.5 means uncertain — return that and we'll skip.`;

  try {
    const raw = await callGPT(prompt);
    const parsed = JSON.parse(raw);
    if (parsed.confidence < 0.5) return { bucket: null, shortcut: 3 };
    const matched = buckets.find(b => b.code === parsed.bucket_code);
    if (matched) return { bucket: { id: matched.id, code: matched.code, name: matched.name, domain: matched.domain }, shortcut: 3 };
  } catch {
    // Fall through.
  }
  return { bucket: null, shortcut: 3 };
}

// ---------------------------------------------------------------------------
// CTC band lookup
// ---------------------------------------------------------------------------

async function lookupCtcBand(args: {
  bucketId: string;
  geography: string;
  collegeTier: number | null;
}): Promise<{ label: string; p25: number; p50: number; p75: number; currency: string } | null> {
  // Try exact (bucket, geography, tier) first; fall back to geography-only.
  let q = supabase
    .from("bucket_ctc_bands")
    .select("p25, p50, p75, currency, college_tier")
    .eq("bucket_id", args.bucketId)
    .eq("geography", args.geography);

  if (args.collegeTier != null) q = q.eq("college_tier", args.collegeTier);
  else q = q.is("college_tier", null);

  const { data: hit } = await q.limit(1).maybeSingle();

  if (!hit) {
    // Try geography-only fallback (any tier, prefer NULL)
    const { data: anyTier } = await supabase
      .from("bucket_ctc_bands")
      .select("p25, p50, p75, currency, college_tier")
      .eq("bucket_id", args.bucketId)
      .eq("geography", args.geography)
      .order("college_tier", { nullsFirst: true })
      .limit(1)
      .maybeSingle();
    if (!anyTier) return null;
    return formatCtcBand(anyTier);
  }
  return formatCtcBand(hit);
}

function formatCtcBand(b: { p25: number; p50: number; p75: number; currency: string }): { label: string; p25: number; p50: number; p75: number; currency: string } {
  const sym = b.currency === "INR" ? "₹" : (b.currency === "USD" ? "$" : `${b.currency} `);
  const unit = b.currency === "INR" ? " LPA" : "k";
  const display = b.currency === "INR"
    ? `${sym}${b.p25}–${b.p75}${unit}`
    : `${sym}${Math.round(b.p25 / 1000)}–${Math.round(b.p75 / 1000)}${unit}`;
  return { label: display, p25: b.p25, p50: b.p50, p75: b.p75, currency: b.currency };
}

// ---------------------------------------------------------------------------
// College framework + tier helpers
// ---------------------------------------------------------------------------

const _frameworkCache = new Map<string, string | null>();
const _tierCache = new Map<string, number | null>();

async function resolveCollegeFramework(collegeId: string): Promise<string | null> {
  if (_frameworkCache.has(collegeId)) return _frameworkCache.get(collegeId)!;

  // Check college_bucket_access for any framework's buckets
  const { data: access } = await supabase
    .from("college_bucket_access")
    .select("buckets!inner(framework_id)")
    .eq("college_id", collegeId)
    .limit(1)
    .maybeSingle();

  let frameworkId: string | null = null;
  if (access && (access as any).buckets) {
    frameworkId = (access as any).buckets.framework_id;
  } else {
    // Default to Tier1 MBA framework
    const { data: defaultFw } = await supabase
      .from("bucket_frameworks")
      .select("id")
      .eq("slug", "tier1_mba")
      .maybeSingle();
    frameworkId = defaultFw?.id || null;
  }

  _frameworkCache.set(collegeId, frameworkId);
  return frameworkId;
}

async function resolveCollegeTier(collegeId: string): Promise<number | null> {
  if (_tierCache.has(collegeId)) return _tierCache.get(collegeId)!;
  const { data } = await supabase
    .from("colleges")
    .select("tier")
    .eq("id", collegeId)
    .maybeSingle();
  const tier = data?.tier ?? null;
  _tierCache.set(collegeId, tier);
  return tier;
}

// ---------------------------------------------------------------------------
// Date / parsing helpers
// ---------------------------------------------------------------------------

function parseYear(s: any): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseYearMonth(s: any): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[-/](\d{1,2})/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const y = parseYear(s);
  return y ? y * 100 + 1 : null;
}

function monthString(s: any): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const y = parseYear(s);
  return y ? `${y}-01` : null;
}

function durationMonths(start: any, end: any): number | null {
  const s = parseYearMonth(start);
  const e = parseYearMonth(end) ?? (new Date().getFullYear() * 100 + new Date().getMonth() + 1);
  if (!s) return null;
  const sy = Math.floor(s / 100), sm = s % 100;
  const ey = Math.floor(e / 100), em = e % 100;
  return Math.max(0, (ey - sy) * 12 + (em - sm));
}

function classifyInternshipSubType(title: string, durationM: number): "SIP" | "summer_intern" | "live_project" | "other" {
  const t = title.toLowerCase();
  if (/(\bsip\b|summer internship project|2[ -]month internship)/i.test(t) && durationM >= 1 && durationM <= 4) return "SIP";
  if (/summer.{0,5}intern/i.test(t)) return "summer_intern";
  if (/live project|live[ -]?case|capstone/i.test(t)) return "live_project";
  if (/intern/i.test(t)) return "summer_intern";
  return "other";
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|inc|llc|llp|gmbh|corp|corporation|company|co|&)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeCompletenessScore(flags: {
  hasExperience: boolean;
  hasEducation: boolean;
  hasGradYear: boolean;
  hasUndergradTier: boolean;
  hasFirstJob: boolean;
}): number {
  // Simple weighted score: each flag contributes equally except "hasFirstJob" which
  // is the most important (drives the bucket dashboard).
  const weights = {
    hasExperience: 0.20,
    hasEducation: 0.15,
    hasGradYear: 0.15,
    hasUndergradTier: 0.15,
    hasFirstJob: 0.35,
  };
  let score = 0;
  for (const k of Object.keys(weights) as (keyof typeof weights)[]) {
    if (flags[k]) score += weights[k];
  }
  return Math.round(score * 100) / 100;
}
