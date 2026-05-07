/**
 * api/lib/analyze-jd.ts
 * ──────────────────────────────────────────────────────────────
 * Unified JD analysis pipeline — Track A (jdenh001)
 *
 * All three entry points funnel through runAnalyzeJd():
 *   1. manual_single  — jd-analyzer.tsx paste / upload / select-job
 *   2. async_batch    — OpenAI Batch API nightly enrichment
 *   3. bulk_upload    — campus upload batch
 *
 * Instrumentation:
 *   Every call writes a row to analyze_jd_runs:
 *     queued → running → succeeded | failed | partial
 *
 * Error policy:
 *   - upsert_skill RPC errors are logged to analyze_jd_runs.error_message
 *     (no more silent catch {})
 *   - Bucket resolver failures are non-fatal but logged
 *   - Top-level failures set status = 'failed'
 */

import { supabase, OPENAI_API_KEY } from "./supabase";
import { resolveBucket } from "./bucketResolver";
import {
  type ClassificationResult,
  type ClassificationSkill,
  categoryToTier,
  confidenceBandToScore,
} from "./bucketTypes";

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

export const ANALYZE_JD_PROMPT_VERSION = "v2.1"; // bump when prompt changes
const REALTIME_MODEL = "gpt-4.1-mini";

/** L2 category → L1 group (deterministic, mirrors l2_to_l1_lookup table) */
export const L2_TO_L1: Record<string, string> = {
  Technology:    "TECHNICAL SKILLS",
  Tool:          "TECHNICAL SKILLS",
  Methodology:   "TECHNICAL SKILLS",
  Language:      "TECHNICAL SKILLS",
  Knowledge:     "KNOWLEDGE",
  Domain:        "KNOWLEDGE",
  Skill:         "COMPETENCIES",
  Competency:    "COMPETENCIES",
  Ability:       "COMPETENCIES",
  Certification: "CREDENTIAL",
};

/** Capitalise first letter of category for L2 normalisation */
function normaliseCategory(raw: string): string {
  const s = (raw || "skill").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export const JD_CLASSIFICATION_PROMPT = `You are an expert job market analyst specializing in Indian MBA/graduate placement intelligence. Classify the given job description into structured fields.

Return a JSON object with:

{
  // FUNCTION (what type of work) — pick exactly ONE from the 26 codes:
  // FN-ACC: Accounting | FN-ADM: Administrative | FN-ART: Arts & Design | FN-BDV: Business Development
  // FN-CON: Consulting | FN-CUS: Customer Success & Support | FN-EDU: Education | FN-ENG: Engineering
  // FN-ENT: Entrepreneurship | FN-FIN: Finance | FN-HLT: Healthcare Services | FN-HRM: Human Resources
  // FN-ITE: Information Technology | FN-LEG: Legal | FN-MKT: Marketing | FN-MED: Media & Communication
  // FN-OPS: Operations | FN-PDM: Product Management | FN-PGM: Program & Project Management
  // FN-PUR: Purchasing | FN-QAS: Quality Assurance | FN-RES: Real Estate | FN-RSC: Research
  // FN-SAL: Sales | FN-DAT: Data & Analytics | FN-GEN: General Management
  "job_function": "FN-XXX",
  "job_function_name": "Name",

  // FAMILY (career bucket for Indian placement) — pick exactly ONE from 20:
  // JF-01: Strategy & Consulting | JF-02: Finance & Banking | JF-03: Marketing & Brand
  // JF-04: Sales & Business Development | JF-05: Supply Chain & Operations | JF-06: FMCG & Retail
  // JF-07: Human Resources | JF-08: Data Science & Analytics | JF-09: Software Engineering
  // JF-10: Product & UX | JF-11: Investment Banking & PE | JF-12: Management Consulting
  // JF-13: General Management | JF-14: Research & Academia | JF-15: Healthcare & Pharma
  // JF-16: Legal & Compliance | JF-17: Media & Communications | JF-18: Entrepreneurship
  // JF-19: Real Estate | JF-20: Other
  "job_family": "JF-XX",
  "job_family_name": "Name",

  // INDUSTRY — pick exactly ONE from 15:
  // IND-01: Technology & Software | IND-02: Financial Services | IND-03: Consulting & Professional Services
  // IND-04: FMCG & Consumer Goods | IND-05: Manufacturing & Industrial | IND-06: Healthcare & Life Sciences
  // IND-07: Media, Entertainment & Publishing | IND-08: E-commerce & Retail | IND-09: Education & EdTech
  // IND-10: Real Estate & Infrastructure | IND-11: Logistics & Supply Chain | IND-12: Automotive
  // IND-13: Energy & Utilities | IND-14: Government & Public Sector | IND-15: Other
  "job_industry": "IND-XX",
  "job_industry_name": "Name",

  "seniority": "L0|L1|L2|L3|L4|L5",
  "company_type": "MNC|Indian Enterprise|Startup|Government-PSU|Consulting Firm",
  "geography": "Metro-Mumbai|Metro-Delhi-NCR|Metro-Bangalore|Metro-Hyderabad|Metro-Chennai|Metro-Pune|Metro-Kolkata|Metro-Ahmedabad|Tier-2-India|Remote-India|UAE-Dubai|International-Other",
  "standardized_title": "normalized job title",
  "sub_role": "specific area within function",
  "company_name": "company name if found",
  "ctc_min": null,
  "ctc_max": null,
  "experience_min": null,
  "experience_max": null,
  "min_education": "bachelor|master|phd|any",
  "preferred_fields": [],
  "bucket": "Seniority Title | Industry | CompanyType | Geography",
  "skills": [
    {
      "name": "skill name",
      "category": "Technology|Tool|Methodology|Language|Knowledge|Domain|Skill|Competency|Ability|Certification",
      "required": true
    }
  ],
  "jd_quality": "well_structured|adequate|poor",
  "classification_confidence": "high|medium|low"
}

Max 15 skills, ordered by importance. Respond with valid JSON only — no markdown, no explanation.`;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type AnalyzeSource = "manual_single" | "async_batch" | "bulk_upload" | "campus_upload";

export interface AnalyzeJdInput {
  /** Raw JD text (required) */
  text: string;
  /** Optional filename hint (for company extraction from campus uploads) */
  filename?: string;
  /** Existing job_id — if set, classification will be written back */
  job_id?: string;
  /** Batch grouping ID (OpenAI batch_id or campus upload session) */
  batch_id?: string;
  /** Which call path triggered this */
  source: AnalyzeSource;
  /** Supabase auth.uid() of the calling user */
  created_by?: string;
}

export interface ProcessedSkill {
  name: string;
  category: string;
  l2: string;
  l1: string;
  skill_tier: string;
  required: boolean;
  taxonomy_match: { id: string; name: string } | null;
  is_new: boolean;
}

export interface AnalyzeJdResult {
  run_id: string;
  classification: ClassificationResult;
  bucket_mapping: Awaited<ReturnType<typeof resolveBucket>> | null;
  skills: ProcessedSkill[];
  saved: boolean;
  was_partial: boolean;
  status: "succeeded" | "failed" | "partial";
  error?: string;
  // Legacy flat fields for backward compat
  bucket: string | null;
  job_function: string | null;
  job_function_name: string | null;
  job_family: string | null;
  job_family_name: string | null;
  job_industry: string | null;
  job_industry_name: string | null;
  seniority: string | null;
  company_type: string | null;
  geography: string | null;
  sub_role: string | null;
  standardized_title: string | null;
  company_name: string | null;
  experience_min: number | null;
  experience_max: number | null;
  min_education: string | null;
  preferred_fields: string[];
  jd_quality: string | null;
  classification_confidence: number;
  ctc_min: number | null;
  ctc_max: number | null;
  total: number;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** Write/update a row in analyze_jd_runs */
async function upsertRun(
  id: string,
  fields: Partial<{
    source: AnalyzeSource;
    job_id: string | null;
    batch_id: string | null;
    status: string;
    input_chars: number;
    model: string;
    prompt_version: string;
    latency_ms: number;
    skills_extracted: number;
    skills_new: number;
    bucket_match: string | null;
    bucket_confidence: number | null;
    was_partial: boolean;
    error_message: string | null;
    created_by: string | null;
    created_at: string;
    finished_at: string | null;
  }>
): Promise<void> {
  const { error } = await supabase
    .from("analyze_jd_runs")
    .upsert({ id, ...fields }, { onConflict: "id" });
  if (error) {
    // Never let instrumentation failures surface to the caller
    console.error("[analyze-jd] run upsert failed:", error.message, "| run_id:", id, "| fields:", JSON.stringify(fields));
  }
}

/** Determine if a result qualifies as partial enrichment */
function calcWasPartial(
  classification: ClassificationResult,
  skillCount: number
): boolean {
  return (
    !classification.job_function ||
    !classification.job_family ||
    !classification.job_industry ||
    !classification.bucket_label ||
    skillCount < 3
  );
}

/** Process a single skill: taxonomy lookup → upsert_skill RPC → log errors */
async function processSkill(
  skillName: string,
  category: string,
  required: boolean,
  runId: string
): Promise<ProcessedSkill> {
  const l2 = normaliseCategory(category);
  const l1 = L2_TO_L1[l2] ?? "COMPETENCIES";
  const skill_tier = categoryToTier(category);

  // 1. Exact taxonomy lookup
  const { data: match } = await supabase
    .from("taxonomy_skills")
    .select("id, name")
    .ilike("name", skillName)
    .limit(1)
    .maybeSingle();

  if (match) {
    return { name: skillName, category, l2, l1, skill_tier, required, taxonomy_match: { id: match.id, name: match.name }, is_new: false };
  }

  // 2. Auto-create via upsert_skill RPC — with structured error logging
  let taxonomyMatch: { id: string; name: string } | null = null;
  let isNew = false;
  try {
    const { data: newId, error: rpcErr } = await supabase.rpc("upsert_skill", {
      p_name: skillName,
      p_category: category || "skill",
      p_tier: skill_tier,
    });
    if (rpcErr) {
      // Log RPC error to the run row instead of swallowing it
      const errMsg = `upsert_skill failed for "${skillName}": ${rpcErr.message} (code: ${rpcErr.code})`;
      console.error("[analyze-jd]", errMsg, "| run_id:", runId);
      // Append to existing error_message (non-blocking, best-effort)
      const { data: existing } = await supabase
        .from("analyze_jd_runs")
        .select("error_message")
        .eq("id", runId)
        .maybeSingle();
      const prev = existing?.error_message ? `${existing.error_message}\n` : "";
      await supabase
        .from("analyze_jd_runs")
        .update({ error_message: `${prev}${errMsg}` })
        .eq("id", runId);
    } else if (newId) {
      taxonomyMatch = { id: newId, name: skillName };
      isNew = true;
    }
  } catch (e: any) {
    const errMsg = `upsert_skill threw for "${skillName}": ${e?.message || String(e)}`;
    console.error("[analyze-jd]", errMsg, "| run_id:", runId);
    // Best-effort log to run row
    try {
      const { data: existing } = await supabase
        .from("analyze_jd_runs")
        .select("error_message")
        .eq("id", runId)
        .maybeSingle();
      const prev = existing?.error_message ? `${existing.error_message}\n` : "";
      await supabase
        .from("analyze_jd_runs")
        .update({ error_message: `${prev}${errMsg}` })
        .eq("id", runId);
    } catch { /* instrumentation must never throw */ }
  }

  return { name: skillName, category, l2, l1, skill_tier, required, taxonomy_match: taxonomyMatch, is_new: isNew };
}

// ─────────────────────────────────────────────────────────────────────
// Main export: runAnalyzeJd
// ─────────────────────────────────────────────────────────────────────

/**
 * Canonical JD analysis pipeline.
 * Used by all three entry points: manual_single, async_batch, bulk_upload.
 *
 * @param input  see AnalyzeJdInput
 * @returns      AnalyzeJdResult (never throws — errors are captured in status/error fields)
 */
export async function runAnalyzeJd(input: AnalyzeJdInput): Promise<AnalyzeJdResult> {
  const runId = crypto.randomUUID();
  const startMs = Date.now();
  const { text, filename, job_id, batch_id, source, created_by } = input;

  if (!OPENAI_API_KEY) {
    return buildErrorResult(runId, "OPENAI_API_KEY not configured");
  }

  // ── 1. Write queued row ─────────────────────────────────────────
  await upsertRun(runId, {
    source,
    job_id: job_id ?? null,
    batch_id: batch_id ?? null,
    status: "queued",
    input_chars: text.length,
    model: REALTIME_MODEL,
    prompt_version: ANALYZE_JD_PROMPT_VERSION,
    created_by: created_by ?? null,
    created_at: new Date().toISOString(),
  });

  // ── 2. Mark running ────────────────────────────────────────────
  await upsertRun(runId, { status: "running" });

  let parsed: Record<string, any>;
  try {
    // ── 3. Call OpenAI ─────────────────────────────────────────
    const userContent = filename
      ? `Filename: ${filename}\n\nIMPORTANT: If the company name is NOT in the JD text below, extract it from the filename above.\n\nClassify the following job description:\n\n${text.slice(0, 4000)}`
      : `Classify the following job description:\n\n${text.slice(0, 4000)}`;

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        messages: [
          { role: "system", content: JD_CLASSIFICATION_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
      }),
    });

    if (!gptResponse.ok) {
      const errText = await gptResponse.text().catch(() => "unknown");
      throw new Error(`OpenAI API error ${gptResponse.status}: ${errText.slice(0, 200)}`);
    }

    const gptData = await gptResponse.json();
    const content = gptData.choices?.[0]?.message?.content || "{}";
    parsed = JSON.parse(content);
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    const latencyMs = Date.now() - startMs;
    await upsertRun(runId, {
      status: "failed",
      latency_ms: latencyMs,
      error_message: errMsg,
      finished_at: new Date().toISOString(),
    });
    return buildErrorResult(runId, errMsg);
  }

  // ── 4. Process skills ──────────────────────────────────────────
  const rawSkills: any[] = (parsed.skills || []).slice(0, 15);
  const skillErrors: string[] = [];
  const processedSkills: ProcessedSkill[] = [];

  for (const skill of rawSkills) {
    const skillName = (skill.name || "").trim();
    if (!skillName) continue;
    try {
      const ps = await processSkill(skillName, skill.category || "skill", skill.required ?? false, runId);
      processedSkills.push(ps);
    } catch (e: any) {
      skillErrors.push(`skill "${skillName}": ${e?.message}`);
    }
  }

  // ── 5. Build ClassificationResult ─────────────────────────────
  const confidenceScore = confidenceBandToScore((parsed.classification_confidence || "low") as any);
  const bucketLabel = parsed.bucket
    ? parsed.bucket.replace(/\s*\|\s*null\b/g, "").trim()
    : null;

  const classification: ClassificationResult = {
    job_function: parsed.job_function || null,
    job_function_name: parsed.job_function_name || null,
    job_family: parsed.job_family || null,
    job_family_name: parsed.job_family_name || null,
    job_industry: parsed.job_industry || null,
    job_industry_name: parsed.job_industry_name || null,
    seniority: parsed.seniority || null,
    company_type: parsed.company_type || null,
    geography: parsed.geography || null,
    standardized_title: parsed.standardized_title || null,
    sub_role: parsed.sub_role || null,
    company_name: parsed.company_name || null,
    ctc_min: parsed.ctc_min ?? null,
    ctc_max: parsed.ctc_max ?? null,
    experience_min: parsed.experience_min ?? null,
    experience_max: parsed.experience_max ?? null,
    min_education: parsed.min_education || null,
    preferred_fields: parsed.preferred_fields || [],
    bucket_label: bucketLabel,
    skills: processedSkills.map<ClassificationSkill>(s => ({
      name: s.name,
      category: s.category,
      required: s.required,
      taxonomy_skill_id: s.taxonomy_match?.id ?? null,
    })),
    jd_quality: parsed.jd_quality || null,
    classification_confidence: (parsed.classification_confidence || "low") as any,
    classification_confidence_score: confidenceScore,
  };

  // ── 6. Run bucket resolver ─────────────────────────────────────
  let bucketMapping: Awaited<ReturnType<typeof resolveBucket>> | null = null;
  let bucketResolverErr: string | null = null;
  try {
    bucketMapping = await resolveBucket(classification);
  } catch (e: any) {
    bucketResolverErr = `bucket resolver failed: ${e?.message}`;
    console.error("[analyze-jd]", bucketResolverErr, "| run_id:", runId);
  }

  // ── 7. Persist job fields if job_id provided ───────────────────
  let saved = false;
  let saveErr: string | null = null;
  if (job_id) {
    try {
      const updateFields: Record<string, any> = {
        job_function: parsed.job_function || null,
        job_family: parsed.job_family || null,
        job_industry: parsed.job_industry || null,
        bucket: bucketLabel,
        sub_role: parsed.sub_role || null,
        experience_min: parsed.experience_min ?? null,
        experience_max: parsed.experience_max ?? null,
        education_req: parsed.min_education || null,
        jd_quality: parsed.jd_quality || null,
        classification_confidence: confidenceScore,
        analysis_version: "v2",
        analyzed_at: new Date().toISOString(),
        enrichment_status: "complete",
        classification_raw: {
          job_function: classification.job_function,
          job_family: classification.job_family,
          job_industry: classification.job_industry,
          seniority: classification.seniority,
          company_type: classification.company_type,
          geography: classification.geography,
          standardized_title: classification.standardized_title,
          sub_role: classification.sub_role,
          jd_quality: classification.jd_quality,
          classification_confidence: classification.classification_confidence,
        },
      };
      if (parsed.standardized_title) updateFields.standardized_title = parsed.standardized_title;
      if (parsed.seniority) updateFields.seniority_level = parsed.seniority;
      if (parsed.company_type) updateFields.company_type = parsed.company_type;
      if (parsed.geography) updateFields.geography = parsed.geography;

      if (bucketMapping?.action === "auto_assign" && bucketMapping.selected) {
        updateFields.bucket_id = bucketMapping.selected.bucket_id;
        updateFields.bucket_match_confidence = bucketMapping.confidence;
        updateFields.bucket_match_reason = {
          action: bucketMapping.action,
          top_candidates: bucketMapping.top_candidates,
          mismatch_flags: bucketMapping.mismatch_flags,
          reason_summary: bucketMapping.reason_summary,
        };
        updateFields.bucket_status_at_assignment = bucketMapping.selected.status;
        updateFields.bucket_assigned_at = new Date().toISOString();
      } else if (bucketMapping) {
        updateFields.bucket_match_confidence = bucketMapping.confidence;
        updateFields.bucket_match_reason = {
          action: bucketMapping.action,
          top_candidates: bucketMapping.top_candidates,
          mismatch_flags: bucketMapping.mismatch_flags,
          reason_summary: bucketMapping.reason_summary,
        };
      }

      const { error: updErr } = await supabase.from("jobs").update(updateFields).eq("id", job_id);
      if (updErr) {
        // Retry without new bucket/classification columns
        const fallback = { ...updateFields };
        delete fallback.classification_raw;
        delete fallback.bucket_id;
        delete fallback.bucket_match_confidence;
        delete fallback.bucket_match_reason;
        delete fallback.bucket_status_at_assignment;
        delete fallback.bucket_assigned_at;
        delete fallback.standardized_title;
        delete fallback.company_type;
        delete fallback.geography;
        await supabase.from("jobs").update(fallback).eq("id", job_id);
      }

      // Upsert job_skills
      const skillRows = processedSkills
        .filter(s => s.taxonomy_match)
        .map(s => ({
          job_id,
          skill_name: s.name,
          skill_category: s.category,
          confidence_score: confidenceScore,
          extraction_method: "ai_v2_analyzer",
          taxonomy_skill_id: s.taxonomy_match!.id,
          is_required: s.required,
        }));
      if (skillRows.length > 0) {
        await supabase.from("job_skills").upsert(skillRows, { onConflict: "job_id,skill_name" });
      }

      saved = true;
    } catch (e: any) {
      saveErr = `job save failed: ${e?.message}`;
      console.error("[analyze-jd]", saveErr, "| job_id:", job_id, "| run_id:", runId);
    }
  }

  // ── 8. Determine final status + was_partial ───────────────────
  const wasPartial = calcWasPartial(classification, processedSkills.length);
  const latencyMs = Date.now() - startMs;

  // Accumulate non-fatal errors for the run row
  const allErrors = [...skillErrors];
  if (bucketResolverErr) allErrors.push(bucketResolverErr);
  if (saveErr) allErrors.push(saveErr);

  const finalStatus = wasPartial ? "partial" : "succeeded";

  await upsertRun(runId, {
    status: finalStatus,
    latency_ms: latencyMs,
    skills_extracted: processedSkills.length,
    skills_new: processedSkills.filter(s => s.is_new).length,
    bucket_match: bucketMapping?.selected?.name ?? bucketLabel ?? null,
    bucket_confidence: bucketMapping?.confidence ?? null,
    was_partial: wasPartial,
    error_message: allErrors.length > 0 ? allErrors.join("\n") : null,
    finished_at: new Date().toISOString(),
  });

  // ── 9. Return unified result ───────────────────────────────────
  return {
    run_id: runId,
    classification,
    bucket_mapping: bucketMapping,
    skills: processedSkills,
    saved,
    was_partial: wasPartial,
    status: finalStatus,
    error: allErrors.length > 0 ? allErrors.join("; ") : undefined,
    // Legacy flat fields
    bucket: bucketLabel,
    job_function: classification.job_function,
    job_function_name: classification.job_function_name,
    job_family: classification.job_family,
    job_family_name: classification.job_family_name,
    job_industry: classification.job_industry,
    job_industry_name: classification.job_industry_name,
    seniority: classification.seniority,
    company_type: classification.company_type,
    geography: classification.geography,
    sub_role: classification.sub_role,
    standardized_title: classification.standardized_title,
    company_name: classification.company_name,
    experience_min: classification.experience_min,
    experience_max: classification.experience_max,
    min_education: classification.min_education,
    preferred_fields: classification.preferred_fields,
    jd_quality: classification.jd_quality,
    classification_confidence: confidenceScore,
    ctc_min: classification.ctc_min,
    ctc_max: classification.ctc_max,
    total: processedSkills.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper: build a minimal error result without a run row write
// ─────────────────────────────────────────────────────────────────────
function buildErrorResult(runId: string, error: string): AnalyzeJdResult {
  const emptyClassification: ClassificationResult = {
    job_function: null, job_function_name: null,
    job_family: null, job_family_name: null,
    job_industry: null, job_industry_name: null,
    seniority: null, company_type: null, geography: null,
    standardized_title: null, sub_role: null, company_name: null,
    ctc_min: null, ctc_max: null, experience_min: null, experience_max: null,
    min_education: null, preferred_fields: [], bucket_label: null,
    skills: [], jd_quality: null,
    classification_confidence: "low",
    classification_confidence_score: 0,
  };
  return {
    run_id: runId,
    classification: emptyClassification,
    bucket_mapping: null,
    skills: [],
    saved: false,
    was_partial: true,
    status: "failed",
    error,
    bucket: null, job_function: null, job_function_name: null,
    job_family: null, job_family_name: null,
    job_industry: null, job_industry_name: null,
    seniority: null, company_type: null, geography: null,
    sub_role: null, standardized_title: null, company_name: null,
    experience_min: null, experience_max: null, min_education: null,
    preferred_fields: [], jd_quality: null, classification_confidence: 0,
    ctc_min: null, ctc_max: null, total: 0,
  };
}
