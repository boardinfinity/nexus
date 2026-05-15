/**
 * Bucket resolver — Phase 1.
 *
 * Given a structured ClassificationResult, score it against the
 * `job_buckets` catalog and return the top candidates with reasons.
 *
 * The scoring is deterministic and uses the structured fields (function /
 * family / industry / seniority / geography), title-alias matching, and
 * (when available) skill overlap. Semantic embeddings are explicitly out
 * of scope for this milestone — when we add them, this module is the
 * place to extend.
 *
 * Weights follow the feature definition (section 8.2):
 *   function/family/industry  25%
 *   title + aliases           20%
 *   nature-of-work similarity 20%   (basic word-overlap heuristic for now)
 *   skill child overlap       20%
 *   company / company type    10%
 *   geography overlay fit      5%
 *
 * Confidence bands:
 *   >= 0.80 → auto_assign
 *   0.65-0.79 → tentative
 *   0.50-0.64 → show_candidates
 *   < 0.50    → needs_candidate (high jd_quality) or unclassified
 */

import { supabase } from "./supabase";
import {
  type BucketCandidate,
  type BucketMatchAction,
  type BucketMatchReasonEntry,
  type BucketResolverResult,
  type BucketSignalKey,
  type ClassificationResult,
  normalizeTitle,
} from "./bucketTypes";

const WEIGHTS: Record<BucketSignalKey, number> = {
  function: 0.10,
  family: 0.10,
  industry: 0.05,
  title_alias: 0.20,
  nature_of_work: 0.20,
  skill_overlap: 0.20,
  company_type: 0.10,
  geography: 0.05,
};

// ── 3-tier matching thresholds ────────────────────────────────────────────
// Tier 1: validated bucket   ≥ 0.50 → auto_assign
// Tier 2: candidate bucket   ≥ 0.50 → tentative
// Tier 3: neither qualifies  + well_structured|adequate JD → auto-create candidate
const VALIDATED_THRESHOLD = 0.50;
const CANDIDATE_THRESHOLD = 0.50;

interface BucketRow {
  id: string;
  bucket_code: string;
  name: string;
  description: string | null;
  bucket_scope: string;
  function_id: string | null;
  family_id: string | null;
  industry_id: string | null;
  seniority_level: string | null;
  standardized_title: string | null;
  company_type: string | null;
  geography_scope: string | null;
  nature_of_work: string | null;
  exclusion_rules: string[] | null;
  status: string;
}

interface AliasRow {
  bucket_id: string;
  alias_norm: string;
}

interface SkillMapRow {
  bucket_id: string;
  taxonomy_skill_id: string;
  requirement_type: string;
}

export interface ResolveOptions {
  /** Skip rows with status != 'validated' if false. Default true. */
  includeCandidates?: boolean;
  /** Override DB load for testing. */
  overrideBuckets?: BucketRow[];
  overrideAliases?: AliasRow[];
  overrideSkillMap?: SkillMapRow[];
  /** Limit how many top candidates are returned. Default 5. */
  limit?: number;
}

export async function resolveBucket(
  classification: ClassificationResult,
  opts: ResolveOptions = {},
): Promise<BucketResolverResult> {
  const limit = opts.limit ?? 5;
  const includeCandidates = opts.includeCandidates ?? true;

  // ── 1. Load buckets, aliases, skill map ────────────────────────────
  const { buckets, aliases, skillMap } = opts.overrideBuckets
    ? {
        buckets: opts.overrideBuckets,
        aliases: opts.overrideAliases ?? [],
        skillMap: opts.overrideSkillMap ?? [],
      }
    : await loadCatalog(includeCandidates);

  if (buckets.length === 0) {
    return {
      selected: null,
      confidence: 0,
      action: "unclassified",
      top_candidates: [],
      candidate_needed: classification.jd_quality === "well_structured",
      mismatch_flags: ["no_buckets_loaded"],
      reason_summary: "No buckets in catalog yet — seed required.",
    };
  }

  // Index aliases per bucket
  const aliasesByBucket = new Map<string, string[]>();
  for (const a of aliases) {
    if (!aliasesByBucket.has(a.bucket_id)) aliasesByBucket.set(a.bucket_id, []);
    aliasesByBucket.get(a.bucket_id)!.push(a.alias_norm);
  }

  // Index skill map per bucket
  const skillsByBucket = new Map<string, Set<string>>();
  for (const s of skillMap) {
    if (!skillsByBucket.has(s.bucket_id)) skillsByBucket.set(s.bucket_id, new Set());
    skillsByBucket.get(s.bucket_id)!.add(s.taxonomy_skill_id);
  }

  // Pre-compute classification-side artifacts
  const titleNorm = normalizeTitle(classification.standardized_title);
  const natureWords = tokenize(classification.sub_role)
    .concat(tokenize(classification.standardized_title));
  const classificationSkillIds = new Set(
    (classification.skills || [])
      .map(s => s.taxonomy_skill_id)
      .filter((x): x is string => Boolean(x)),
  );

  // ── 2. Score every bucket ──────────────────────────────────────────
  const scored: BucketCandidate[] = [];
  for (const b of buckets) {
    if (!includeCandidates && b.status !== "validated") continue;
    if (matchesExclusion(b, classification)) continue;

    // Hard-filter: if the bucket has a function/family/industry set AND the
    // classification has those fields set, they MUST match. A mismatch means
    // this bucket is for a completely different domain — don't score it at all.
    // This prevents a 0-contribution signal from dragging down the normalized
    // score and blocking the Tier-3 auto-create path.
    if (b.function_id && classification.job_function &&
        b.function_id !== classification.job_function) continue;
    if (b.family_id && classification.job_family &&
        b.family_id !== classification.job_family) continue;
    if (b.industry_id && classification.job_industry &&
        b.industry_id !== classification.job_industry) continue;

    const reasons: BucketMatchReasonEntry[] = [];

    // Function / Family / Industry — positive signal only (mismatches already excluded above).
    pushReason(reasons, "function",
      b.function_id && classification.job_function ? 1 : null);
    pushReason(reasons, "family",
      b.family_id && classification.job_family ? 1 : null);
    pushReason(reasons, "industry",
      b.industry_id && classification.job_industry ? 1 : null);

    // Title + aliases
    const aliasList = aliasesByBucket.get(b.id) || [];
    const standardizedNorm = normalizeTitle(b.standardized_title);
    const titleScore = scoreTitle(titleNorm, [standardizedNorm, ...aliasList]);
    pushReason(reasons, "title_alias", titleScore);

    // Nature-of-work word overlap
    const natureScore = scoreWordOverlap(natureWords, tokenize(b.nature_of_work));
    pushReason(reasons, "nature_of_work", natureScore);

    // Skill overlap
    const bucketSkillSet = skillsByBucket.get(b.id);
    const skillScore = bucketSkillSet && bucketSkillSet.size > 0 && classificationSkillIds.size > 0
      ? jaccard(bucketSkillSet, classificationSkillIds)
      : null;
    pushReason(reasons, "skill_overlap", skillScore);

    // Company-type match
    pushReason(reasons, "company_type", b.company_type && classification.company_type
      ? (b.company_type.toLowerCase() === classification.company_type.toLowerCase() ? 1 : 0)
      : null);

    // Geography match
    pushReason(reasons, "geography", b.geography_scope && classification.geography
      ? (geographyMatch(b.geography_scope, classification.geography) ? 1 : 0)
      : null);

    // Aggregate
    const { score, normWeight } = aggregate(reasons);
    if (normWeight === 0) continue; // no signals had data; skip

    scored.push({
      bucket_id: b.id,
      bucket_code: b.bucket_code,
      name: b.name,
      status: b.status as BucketCandidate["status"],
      score,
      reasons,
      function_id: b.function_id,
      family_id: b.family_id,
      industry_id: b.industry_id,
      seniority_level: b.seniority_level,
      geography_scope: b.geography_scope,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // ── 3. Three-tier matching ─────────────────────────────────────────
  // Tier 1: best score ≥ 0.50 against a VALIDATED bucket → auto_assign
  // Tier 2: best score ≥ 0.50 against a CANDIDATE bucket → tentative
  // Tier 3: nothing qualifies → auto-create a new candidate bucket

  const topValidated = top.find(b => b.status === "validated" && b.score >= VALIDATED_THRESHOLD) ?? null;
  const topCandidate = !topValidated
    ? (top.find(b => b.status === "candidate" && b.score >= CANDIDATE_THRESHOLD) ?? null)
    : null;

  const top1 = topValidated ?? topCandidate ?? top[0] ?? null;
  const top1Score = top1?.score ?? 0;

  const mismatch_flags: string[] = [];
  if (top1 && classification.job_function && top1.function_id && top1.function_id !== classification.job_function) {
    mismatch_flags.push(`function_mismatch:${classification.job_function}!=${top1.function_id}`);
  }
  if (top1 && classification.job_industry && top1.industry_id && top1.industry_id !== classification.job_industry) {
    mismatch_flags.push(`industry_mismatch:${classification.job_industry}!=${top1.industry_id}`);
  }

  // Tier 1 hit
  if (topValidated) {
    return {
      selected: topValidated,
      confidence: topValidated.score,
      action: "auto_assign",
      top_candidates: top,
      candidate_needed: false,
      mismatch_flags,
      reason_summary: `Auto-assigned to validated bucket ${topValidated.bucket_code} (${(topValidated.score * 100).toFixed(0)}% match).`,
    };
  }

  // Tier 2 hit
  if (topCandidate) {
    return {
      selected: topCandidate,
      confidence: topCandidate.score,
      action: "tentative",
      top_candidates: top,
      candidate_needed: false,
      mismatch_flags,
      reason_summary: `Tentative match to candidate bucket ${topCandidate.bucket_code} (${(topCandidate.score * 100).toFixed(0)}% match). Pending admin validation.`,
    };
  }

  // Tier 3: neither qualifies — auto-create a candidate if JD is good enough
  const jdGoodEnough = classification.jd_quality === "well_structured" || classification.jd_quality === "adequate";
  const hasRequiredFields = !!(classification.job_function && classification.job_family && classification.job_industry);

  if (jdGoodEnough && hasRequiredFields) {
    let newBucketId: string | null = null;
    let newBucket: BucketCandidate | null = null;
    try {
      const created = await createCandidateBucket(classification);
      if (created) {
        newBucketId = created.id;
        newBucket = {
          bucket_id: created.id,
          bucket_code: created.bucket_code,
          name: created.name,
          status: "candidate",
          score: 0,
          reasons: [],
          function_id: classification.job_function,
          family_id: classification.job_family,
          industry_id: classification.job_industry,
          seniority_level: classification.seniority,
          geography_scope: classification.geography,
        };
      }
    } catch (e: any) {
      console.error("[bucketResolver] auto-create failed:", e?.message);
    }

    return {
      selected: newBucket,
      confidence: 0,
      action: "auto_created",
      top_candidates: top,
      candidate_needed: true,
      mismatch_flags,
      auto_created_bucket_id: newBucketId,
      reason_summary: newBucket
        ? `No existing bucket matched (best: ${(top1Score * 100).toFixed(0)}%). New candidate bucket "${newBucket.name}" auto-created for admin review.`
        : `No existing bucket matched. Candidate creation failed — needs manual bucketing.`,
    };
  }

  // Truly unclassified (jd_quality poor, or missing function/family/industry)
  const missingFields: string[] = [];
  if (!classification.job_function) missingFields.push("function");
  if (!classification.job_family) missingFields.push("family");
  if (!classification.job_industry) missingFields.push("industry");
  const unclassifiedReason = missingFields.length > 0
    ? `Cannot create candidate — missing classification fields: ${missingFields.join(", ")}.`
    : `No compatible bucket found (best: ${(top1Score * 100).toFixed(0)}%). JD quality (${classification.jd_quality}) too low for auto-creation.`;

  return {
    selected: null,
    confidence: top1Score,
    action: "unclassified",
    top_candidates: top,
    candidate_needed: false,
    mismatch_flags,
    reason_summary: unclassifiedReason,
  };
}

// ─────────────────────────────────────────────────────────────────────
// createCandidateBucket — auto-generates a new candidate bucket row
// from the LLM's classification fields when no existing bucket qualifies.
// Structure: code, name, scope, function, family, industry, geography, company_type.
// ─────────────────────────────────────────────────────────────────────

async function createCandidateBucket(
  c: ClassificationResult
): Promise<{ id: string; bucket_code: string; name: string } | null> {
  // Build a deterministic bucket_code from classification fields
  // Format: AUTO-{FN}-{SENIORITY}-{IND_SHORT}-{GEO_SHORT}
  const fnShort = (c.job_function || "GEN").replace("FN-", "");
  const senShort = (c.seniority || "LX").replace("L", "L");
  const indShort = (c.job_industry || "IND-15").replace("IND-", "I").padEnd(3, "X");
  const geoShort = geoToShort(c.geography);
  const compShort = companyTypeToShort(c.company_type);
  const bucket_code = `AUTO-${fnShort}-${senShort}-${indShort}-${geoShort}-${compShort}`.toUpperCase().slice(0, 60);

  // Check if this exact code already exists (idempotent)
  const { data: existing } = await supabase
    .from("job_buckets")
    .select("id, bucket_code, name")
    .eq("bucket_code", bucket_code)
    .maybeSingle();
  if (existing) return existing;

  // Build human-readable name from classification names
  const fnName = c.job_function_name || fnShort;
  const indName = c.job_industry_name || indShort;
  const senLabel = seniorityLabel(c.seniority);
  const geoLabel = c.geography || "India";
  const compLabel = c.company_type || "";
  const name = [senLabel, fnName, "—", indName, compLabel ? `(${compLabel})` : "", geoLabel]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 120);

  // Validate FK references exist before inserting — null out any that don't
  // to avoid FK constraint failures from prompt/DB drift.
  const VALID_FUNCTIONS = new Set(["FN-ACC","FN-ADM","FN-ART","FN-BDV","FN-CON","FN-CSU","FN-DAT","FN-EDU","FN-ENG","FN-ENT","FN-FIN","FN-GEN","FN-HLT","FN-HRM","FN-ITS","FN-LGL","FN-MED","FN-MKT","FN-OPS","FN-PGM","FN-PRD","FN-PUR","FN-QAL","FN-REL","FN-RES","FN-SAL"]);
  const VALID_FAMILIES = new Set(["JF-01","JF-02","JF-03","JF-04","JF-05","JF-06","JF-07","JF-08","JF-09","JF-10","JF-11","JF-12","JF-13","JF-14","JF-15","JF-16","JF-17","JF-18","JF-19","JF-20"]);
  const VALID_INDUSTRIES = new Set(["IND-01","IND-02","IND-03","IND-04","IND-05","IND-06","IND-07","IND-08","IND-09","IND-10","IND-11","IND-12","IND-13","IND-14","IND-15"]);

  const safe_function_id = c.job_function && VALID_FUNCTIONS.has(c.job_function) ? c.job_function : null;
  const safe_family_id   = c.job_family   && VALID_FAMILIES.has(c.job_family)   ? c.job_family   : null;
  const safe_industry_id = c.job_industry && VALID_INDUSTRIES.has(c.job_industry) ? c.job_industry : null;

  if (!safe_function_id) console.warn(`[bucketResolver] Unknown function_id: ${c.job_function} — inserting NULL`);
  if (!safe_family_id)   console.warn(`[bucketResolver] Unknown family_id: ${c.job_family} — inserting NULL`);
  if (!safe_industry_id) console.warn(`[bucketResolver] Unknown industry_id: ${c.job_industry} — inserting NULL`);

  const row = {
    bucket_code,
    name,
    description: `Auto-created candidate bucket from JD analysis. Function: ${fnName}, Industry: ${indName}, Seniority: ${c.seniority || "unknown"}, Geography: ${geoLabel}. Requires admin validation.`,
    bucket_scope: "candidate",
    function_id: safe_function_id,
    family_id: safe_family_id,
    industry_id: safe_industry_id,
    seniority_level: c.seniority,
    company_type: c.company_type,
    geography_scope: c.geography,
    standardized_title: c.standardized_title,
    nature_of_work: c.sub_role,
    status: "candidate",
    source: "auto_jd_analysis",
    first_seen_at: new Date().toISOString(),
    mention_count: 1,
    evidence_count: 1,
  };

  const { data: inserted, error } = await supabase
    .from("job_buckets")
    .insert(row)
    .select("id, bucket_code, name")
    .single();

  if (error) {
    console.error("[bucketResolver] insert new bucket failed:", error.message);
    return null;
  }
  console.log(`[bucketResolver] Auto-created candidate bucket: ${inserted.bucket_code} — "${inserted.name}"`);
  return inserted;
}

function geoToShort(geo: string | null): string {
  if (!geo) return "IN";
  const map: Record<string, string> = {
    "Metro-Mumbai": "MUM", "Metro-Delhi-NCR": "DEL", "Metro-Bangalore": "BLR",
    "Metro-Hyderabad": "HYD", "Metro-Chennai": "CHN", "Metro-Pune": "PNE",
    "Metro-Kolkata": "KOL", "Metro-Ahmedabad": "AMD", "Tier-2-India": "T2",
    "Remote-India": "REM", "UAE-Dubai": "UAE", "International-Other": "INT",
  };
  return map[geo] || "IN";
}

function companyTypeToShort(ct: string | null): string {
  if (!ct) return "GEN";
  const map: Record<string, string> = {
    "MNC": "MNC", "Indian Enterprise": "IE", "Startup": "STP",
    "Government-PSU": "GOV", "Consulting Firm": "CON",
  };
  return map[ct] || "GEN";
}

function seniorityLabel(s: string | null): string {
  const map: Record<string, string> = {
    "L0": "Fresher", "L1": "Junior", "L2": "Associate",
    "L3": "Mid-Level", "L4": "Senior", "L5": "Lead/Director",
  };
  return s ? (map[s] || s) : "";
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function loadCatalog(includeCandidates: boolean): Promise<{
  buckets: BucketRow[];
  aliases: AliasRow[];
  skillMap: SkillMapRow[];
}> {
  const bucketQuery = supabase
    .from("job_buckets")
    .select("id, bucket_code, name, description, bucket_scope, function_id, family_id, industry_id, seniority_level, standardized_title, company_type, geography_scope, nature_of_work, exclusion_rules, status")
    .neq("status", "merged")
    .neq("status", "deprecated");
  const { data: bucketsRaw } = includeCandidates
    ? await bucketQuery
    : await bucketQuery.eq("status", "validated");

  const buckets = (bucketsRaw || []) as BucketRow[];

  if (buckets.length === 0) {
    return { buckets, aliases: [], skillMap: [] };
  }

  const ids = buckets.map(b => b.id);

  const [{ data: aliasesRaw }, { data: skillMapRaw }] = await Promise.all([
    supabase.from("job_bucket_aliases").select("bucket_id, alias_norm").in("bucket_id", ids),
    supabase.from("job_bucket_skill_map").select("bucket_id, taxonomy_skill_id, requirement_type").in("bucket_id", ids),
  ]);

  return {
    buckets,
    aliases: (aliasesRaw || []) as AliasRow[],
    skillMap: (skillMapRaw || []) as SkillMapRow[],
  };
}

function pushReason(
  arr: BucketMatchReasonEntry[],
  signal: BucketSignalKey,
  rawScore: number | null,
) {
  if (rawScore === null) return;
  const weight = WEIGHTS[signal];
  arr.push({
    signal,
    weight,
    contribution: rawScore * weight,
  });
}

function aggregate(reasons: BucketMatchReasonEntry[]): { score: number; normWeight: number } {
  if (reasons.length === 0) return { score: 0, normWeight: 0 };
  const totalContribution = reasons.reduce((acc, r) => acc + r.contribution, 0);
  const totalWeight = reasons.reduce((acc, r) => acc + r.weight, 0);
  if (totalWeight === 0) return { score: 0, normWeight: 0 };
  // Normalize by the weight of signals we actually had data for so that
  // a JD missing geography/skills doesn't get a low ceiling.
  return { score: totalContribution / totalWeight, normWeight: totalWeight };
}

function scoreTitle(titleNorm: string, candidates: string[]): number | null {
  const filtered = candidates.filter(c => c && c.length > 0);
  if (!titleNorm || filtered.length === 0) return null;

  let best = 0;
  for (const c of filtered) {
    if (!c) continue;
    if (c === titleNorm) return 1;
    if (titleNorm.includes(c) || c.includes(titleNorm)) {
      best = Math.max(best, 0.85);
      continue;
    }
    const overlap = scoreWordOverlap(titleNorm.split(" "), c.split(" "));
    if (overlap !== null) best = Math.max(best, overlap);
  }
  return best;
}

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "are", "was",
  "you", "your", "our", "its", "but", "not", "any", "all", "etc", "via",
  "team", "role", "work", "job", "will", "have", "has", "their", "such",
]);

function scoreWordOverlap(a: string[], b: string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function matchesExclusion(b: BucketRow, c: ClassificationResult): boolean {
  const rules = b.exclusion_rules || [];
  if (rules.length === 0) return false;
  const haystack = [c.standardized_title, c.sub_role, c.job_function_name, c.job_family_name, c.job_industry_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return rules.some(r => r && haystack.includes(r.toLowerCase()));
}

function geographyMatch(scope: string, geo: string): boolean {
  if (!scope || !geo) return false;
  const s = scope.toLowerCase();
  const g = geo.toLowerCase();
  if (s === g) return true;
  if (s === "global") return true;
  if (s === "india" && g.startsWith("metro-")) return true;
  if (s === "india" && (g === "tier-2-india" || g === "remote-india")) return true;
  if (s === "uae" && g === "uae-dubai") return true;
  return false;
}

// decideAction + summarize replaced by inline 3-tier logic above

