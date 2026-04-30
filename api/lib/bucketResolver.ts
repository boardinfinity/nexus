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

const AUTO_THRESHOLD = 0.80;
const TENTATIVE_THRESHOLD = 0.65;
const SHOW_THRESHOLD = 0.50;

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

    const reasons: BucketMatchReasonEntry[] = [];

    // Function / Family / Industry — soft gates with partial credit.
    pushReason(reasons, "function", b.function_id && classification.job_function
      ? (b.function_id === classification.job_function ? 1 : 0)
      : null);
    pushReason(reasons, "family", b.family_id && classification.job_family
      ? (b.family_id === classification.job_family ? 1 : 0)
      : null);
    pushReason(reasons, "industry", b.industry_id && classification.job_industry
      ? (b.industry_id === classification.job_industry ? 1 : 0)
      : null);

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

  // ── 3. Decide action band ─────────────────────────────────────────
  const top1 = top[0];
  const top1Score = top1?.score ?? 0;
  const top1IsValidated = top1?.status === "validated";

  const action = decideAction(top1Score, top1IsValidated, classification.jd_quality);

  const candidate_needed =
    action === "needs_candidate" ||
    (top1Score < TENTATIVE_THRESHOLD && classification.jd_quality === "well_structured");

  const mismatch_flags: string[] = [];
  if (top1 && classification.job_function && top1.function_id && top1.function_id !== classification.job_function) {
    mismatch_flags.push(`function_mismatch:${classification.job_function}!=${top1.function_id}`);
  }
  if (top1 && classification.job_industry && top1.industry_id && top1.industry_id !== classification.job_industry) {
    mismatch_flags.push(`industry_mismatch:${classification.job_industry}!=${top1.industry_id}`);
  }

  const selected = action === "auto_assign" || action === "tentative" ? top1 ?? null : null;

  return {
    selected,
    confidence: top1Score,
    action,
    top_candidates: top,
    candidate_needed,
    mismatch_flags,
    reason_summary: summarize(top1 ?? null, action),
  };
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

function decideAction(
  score: number,
  isValidated: boolean,
  jdQuality: string | null,
): BucketMatchAction {
  if (score >= AUTO_THRESHOLD && isValidated) return "auto_assign";
  if (score >= TENTATIVE_THRESHOLD) return "tentative";
  if (score >= SHOW_THRESHOLD) return "show_candidates";
  if (jdQuality === "well_structured" || jdQuality === "adequate") return "needs_candidate";
  return "unclassified";
}

function summarize(top: BucketCandidate | null, action: BucketMatchAction): string {
  if (!top) {
    if (action === "needs_candidate") return "No close match — JD is high-quality, candidate bucket suggested.";
    return "No bucket candidates found.";
  }
  switch (action) {
    case "auto_assign":
      return `Auto-assigned to validated bucket ${top.bucket_code} (${top.score.toFixed(2)}).`;
    case "tentative":
      return `Tentative match: ${top.bucket_code} (${top.score.toFixed(2)}). Recommend admin review.`;
    case "show_candidates":
      return `Top candidate ${top.bucket_code} below auto-threshold (${top.score.toFixed(2)}).`;
    case "needs_candidate":
      return `Best score ${top.score.toFixed(2)} below show threshold; high-quality JD → candidate creation suggested.`;
    case "unclassified":
      return `No confident match (${top.score.toFixed(2)}).`;
  }
}
