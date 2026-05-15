/**
 * api/lib/analyze-jd.ts
 * ──────────────────────────────────────────────────────────────
 * Unified JD analysis pipeline — Track A (jdenh001) + Track B (jdenh001)
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
 *
 * Track B additions (v2.2):
 *   - processSkill() now passes p_l1 + p_l2 to upsert_skill RPC (migration 038b)
 *   - Fuzzy-match step runs BEFORE upsert: similarity() via pg_trgm + Levenshtein
 *     check. Near-duplicate (lev ≤ 2 normalised) → append alias, return existing id.
 *   - Fuzzy-merge events are logged to analyze_jd_runs.error_message with "[fuzzy-merge]" prefix.
 *   - ProcessedSkill now includes l1 and l2 in the returned payload.
 *   - JD_CLASSIFICATION_PROMPT updated to v2.2 — category field explicitly named L2.
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

export const ANALYZE_JD_PROMPT_VERSION = "v2.2"; // bumped by Track B
const REALTIME_MODEL = "gpt-4.1-mini";

/**
 * L2 → L1 mapping (deterministic, mirrors l2_to_l1_lookup DB table).
 * Must stay in sync with migration 038's l2_to_l1_lookup seed.
 *
 * L2 values are the exact 10 valid "category" values the LLM returns
 * (see JD_CLASSIFICATION_PROMPT below).  L1 has 4 values only.
 */
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

/** Valid L2 values (10 total — mirrors the LLM prompt enum exactly) */
const VALID_L2 = new Set(Object.keys(L2_TO_L1));

/** Capitalise first letter of category for L2 normalisation */
function normaliseCategory(raw: string): string {
  const s = (raw || "Skill").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────
// Prompt (v2.2) — L2 category field made explicit
// ─────────────────────────────────────────────────────────────────────

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

      // IMPORTANT — "category" is the L2 skill sub-category.
      // You MUST use EXACTLY one of these 10 values (case-sensitive):
      //   Technology   — programming languages, frameworks, platforms (e.g. Python, React, AWS)
      //   Tool         — software tools & applications (e.g. Tableau, Salesforce, Excel)
      //   Methodology  — processes, practices, standards (e.g. Agile, Six Sigma, GAAP)
      //   Language     — human/spoken languages (e.g. English, Hindi, Mandarin)
      //   Knowledge    — bodies of knowledge & theory (e.g. Financial Modelling, Thermodynamics)
      //   Domain       — industry/functional domains (e.g. FMCG, Healthcare, E-commerce)
      //   Skill        — general professional skills (e.g. Communication, Problem Solving)
      //   Competency   — measurable work competencies (e.g. Strategic Thinking, Data Analysis)
      //   Ability      — innate or developed aptitudes (e.g. Attention to Detail, Creativity)
      //   Certification — formal credentials & certifications (e.g. CFA, PMP, AWS Solutions Architect)
      // Do NOT invent new values. If uncertain, default to "Skill".
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
  /** Batch grouping ID (OpenAI batch_id or campus upload session uuid) */
  batch_id?: string;
  /** Which call path triggered this */
  source: AnalyzeSource;
  /** Supabase auth.uid() of the calling user */
  created_by?: string;
}

export interface ProcessedSkill {
  name: string;
  category: string;
  /** L2 sub-category (one of 10 valid values) — set by Track B */
  l2: string;
  /** L1 group (one of 4: TECHNICAL SKILLS / KNOWLEDGE / COMPETENCIES / CREDENTIAL) — set by Track B */
  l1: string;
  skill_tier: string;
  required: boolean;
  taxonomy_match: { id: string; name: string } | null;
  is_new: boolean;
  /** True when a fuzzy-match merged this variant into an existing skill */
  was_fuzzy_merged?: boolean;
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
    console.error("[analyze-jd] run upsert failed:", error.message, "| run_id:", id, "| fields:", JSON.stringify(fields));
  }
}

/** Append a message to analyze_jd_runs.error_message (best-effort, non-blocking) */
async function appendRunMessage(runId: string, msg: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("analyze_jd_runs")
      .select("error_message")
      .eq("id", runId)
      .maybeSingle();
    const prev = existing?.error_message ? `${existing.error_message}\n` : "";
    await supabase
      .from("analyze_jd_runs")
      .update({ error_message: `${prev}${msg}` })
      .eq("id", runId);
  } catch { /* instrumentation must never throw */ }
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

/**
 * Normalise a skill name for fuzzy matching:
 * lowercase → trim → strip punctuation → collapse whitespace
 */
function normaliseFuzzy(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")   // strip punctuation
    .replace(/\s+/g, " ")      // collapse whitespace
    .trim();
}

/**
 * Simple JS Levenshtein distance (used to validate the DB candidate returned
 * by similarity() — avoids a round-trip if the candidate is clearly too far).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy-match a skill name against taxonomy_skills.
 * Uses similarity() from pg_trgm (already installed) as the fast filter,
 * then validates with a JS Levenshtein check.
 *
 * Returns the best matching existing skill row, or null if no close match.
 * Threshold: trigram similarity ≥ 0.7 AND levenshtein ≤ 2 (normalised strings).
 */
async function fuzzyMatchSkill(
  normalisedName: string
): Promise<{ id: string; name: string; aliases: string[] } | null> {
  if (normalisedName.length < 3) return null; // too short to fuzzy-match safely

  const { data: candidates, error } = await supabase.rpc("find_similar_skill", {
    p_name: normalisedName,
    p_threshold: 0.7,
    p_limit: 3,
  });

  if (error || !candidates || candidates.length === 0) return null;

  // JS-side Levenshtein validation (normalised strings, ≤ 2 edits)
  for (const c of candidates) {
    const candidateNorm = normaliseFuzzy(c.name);
    const dist = levenshtein(normalisedName, candidateNorm);
    if (dist <= 2) {
      return { id: c.id, name: c.name, aliases: c.aliases || [] };
    }
  }
  return null;
}

/**
 * Process a single skill: taxonomy lookup → fuzzy match → upsert_skill RPC → log errors.
 * Passes l1 and l2 to upsert_skill when creating net-new skills (migration 038b).
 */
async function processSkill(
  skillName: string,
  category: string,
  required: boolean,
  runId: string
): Promise<ProcessedSkill> {
  // ── Derive L2 and L1 ─────────────────────────────────────────────
  const rawL2 = normaliseCategory(category);
  // Validate L2 against the 10-value enum; default to "Skill" if invalid
  const l2 = VALID_L2.has(rawL2) ? rawL2 : "Skill";
  const l1 = L2_TO_L1[l2]!; // always defined since l2 is now in VALID_L2
  const skill_tier = categoryToTier(category);

  const normName = normaliseFuzzy(skillName);

  // ── 1. Exact taxonomy lookup ──────────────────────────────────────
  const { data: exactMatch } = await supabase
    .from("taxonomy_skills")
    .select("id, name")
    .ilike("name", skillName)
    .limit(1)
    .maybeSingle();

  if (exactMatch) {
    return { name: skillName, category, l2, l1, skill_tier, required, taxonomy_match: { id: exactMatch.id, name: exactMatch.name }, is_new: false };
  }

  // ── 2. Alias exact lookup ────────────────────────────────────────
  const { data: aliasMatch } = await supabase
    .from("taxonomy_skills")
    .select("id, name")
    .contains("aliases", [normName])
    .limit(1)
    .maybeSingle();

  if (aliasMatch) {
    return { name: skillName, category, l2, l1, skill_tier, required, taxonomy_match: { id: aliasMatch.id, name: aliasMatch.name }, is_new: false };
  }

  // ── 3. Fuzzy match (pg_trgm similarity + Levenshtein ≤ 2) ────────
  try {
    const fuzzy = await fuzzyMatchSkill(normName);
    if (fuzzy) {
      // Append this variant as an alias (NOT EXISTS guard is in the SQL function)
      const { error: mergeErr } = await supabase.rpc("append_skill_alias", {
        p_skill_id: fuzzy.id,
        p_alias: normName,
      });
      const mergeNote = `[fuzzy-merge] "${skillName}" (norm: "${normName}") merged into existing skill "${fuzzy.name}" (id: ${fuzzy.id})${mergeErr ? ` — alias append failed: ${mergeErr.message}` : ""}`;
      console.info("[analyze-jd]", mergeNote, "| run_id:", runId);
      await appendRunMessage(runId, mergeNote);
      return {
        name: skillName,
        category,
        l2,
        l1,
        skill_tier,
        required,
        taxonomy_match: { id: fuzzy.id, name: fuzzy.name },
        is_new: false,
        was_fuzzy_merged: true,
      };
    }
  } catch (fuzzyErr: any) {
    // Fuzzy match failure is non-fatal — fall through to upsert
    console.warn("[analyze-jd] fuzzy match error for", skillName, ":", fuzzyErr?.message, "| run_id:", runId);
  }

  // ── 4. Net-new: create via upsert_skill RPC (with l1 + l2) ───────
  let taxonomyMatch: { id: string; name: string } | null = null;
  let isNew = false;
  try {
    const { data: newId, error: rpcErr } = await supabase.rpc("upsert_skill", {
      p_name: skillName,
      p_category: category || "skill",
      p_tier: skill_tier,
      p_l1: l1,
      p_l2: l2,
    });
    if (rpcErr) {
      const errMsg = `upsert_skill failed for "${skillName}": ${rpcErr.message} (code: ${rpcErr.code})`;
      console.error("[analyze-jd]", errMsg, "| run_id:", runId);
      await appendRunMessage(runId, errMsg);
    } else if (newId) {
      taxonomyMatch = { id: newId, name: skillName };
      isNew = true;
    }
  } catch (e: any) {
    const errMsg = `upsert_skill threw for "${skillName}": ${e?.message || String(e)}`;
    console.error("[analyze-jd]", errMsg, "| run_id:", runId);
    await appendRunMessage(runId, errMsg);
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

      // Wire bucket_id for auto_assign, tentative, AND auto_created actions
      const bucketAssignable = bucketMapping?.selected &&
        (bucketMapping.action === "auto_assign" || bucketMapping.action === "tentative" || bucketMapping.action === "auto_created");
      if (bucketAssignable && bucketMapping && bucketMapping.selected) {
        updateFields.bucket_id = bucketMapping.selected.bucket_id;
        updateFields.bucket_match_confidence = bucketMapping.confidence;
        updateFields.bucket_match_reason = {
          action: bucketMapping.action,
          top_candidates: bucketMapping.top_candidates,
          mismatch_flags: bucketMapping.mismatch_flags,
          reason_summary: bucketMapping.reason_summary,
          auto_created_bucket_id: bucketMapping.auto_created_bucket_id ?? null,
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
          auto_created_bucket_id: bucketMapping.auto_created_bucket_id ?? null,
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

      // Upsert job_skills (now includes l1/l2 in skill rows via taxonomy_match)
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

  // Accumulate non-fatal errors for the run row (skill errors + resolver + save)
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

  // ── 9. Return unified result (skills now include l1 + l2) ──────
  return {
    run_id: runId,
    classification,
    bucket_mapping: bucketMapping,
    skills: processedSkills,   // each ProcessedSkill carries l1, l2, was_fuzzy_merged
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
