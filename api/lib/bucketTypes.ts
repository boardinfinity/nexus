/**
 * Shared TypeScript types for JD classification and bucket resolution.
 *
 * Used by:
 *   - api/routes/taxonomy.ts        (single JD analyzer)
 *   - api/lib/batch.ts              (bulk JD batch enrichment)
 *   - api/routes/bucket-test.ts     (admin dry-run)
 *   - api/lib/bucketResolver.ts     (resolver implementation)
 *   - client/src/pages/jd-analyzer  (frontend, via re-import)
 *
 * The shapes here are intentionally permissive (lots of nullable
 * fields). The resolver is responsible for normalizing missing values.
 */

// ─────────────────────────────────────────────────────────────────────
// Classification result (output of the LLM JD classifier)
// ─────────────────────────────────────────────────────────────────────

export type ConfidenceBand = "high" | "medium" | "low";

export interface ClassificationSkill {
  name: string;
  category: string;
  required?: boolean;
  taxonomy_skill_id?: string | null;
}

export interface ClassificationResult {
  // Core classification
  job_function: string | null;          // FN-XXX
  job_function_name: string | null;
  job_family: string | null;            // JF-XX
  job_family_name: string | null;
  job_industry: string | null;          // IND-XX
  job_industry_name: string | null;
  seniority: string | null;             // L0..L5
  company_type: string | null;
  geography: string | null;
  standardized_title: string | null;
  sub_role: string | null;
  company_name: string | null;

  // CTC / experience / education
  ctc_min: number | null;
  ctc_max: number | null;
  experience_min: number | null;
  experience_max: number | null;
  min_education: string | null;
  preferred_fields: string[];

  // Free-text bucket label (legacy compatibility)
  bucket_label: string | null;

  // Skills
  skills: ClassificationSkill[];

  // Quality and confidence
  jd_quality: string | null;
  classification_confidence: ConfidenceBand;
  classification_confidence_score: number; // 0..1, derived from band
}

// ─────────────────────────────────────────────────────────────────────
// Bucket mapping result (output of the bucket resolver)
// ─────────────────────────────────────────────────────────────────────

export type BucketMatchAction =
  | "auto_assign"        // confidence >= 0.50, validated bucket (first-pass)
  | "tentative"          // confidence >= 0.50, candidate bucket (second-pass)
  | "show_candidates"    // multiple candidates close in score, human pick needed
  | "needs_candidate"    // < 0.50 but high JD quality → new candidate auto-created
  | "auto_created"       // new candidate bucket was created from classification fields
  | "unclassified";      // < 0.50 and JD too poor to create a candidate

export interface BucketCandidate {
  bucket_id: string;
  bucket_code: string;
  name: string;
  status: "candidate" | "validated" | "deprecated" | "merged";
  score: number;                       // 0..1
  reasons: BucketMatchReasonEntry[];
  function_id: string | null;
  family_id: string | null;
  industry_id: string | null;
  seniority_level: string | null;
  geography_scope: string | null;
}

export interface BucketMatchReasonEntry {
  signal: BucketSignalKey;
  weight: number;                      // 0..1
  contribution: number;                // signal * weight
  detail?: string;
}

export type BucketSignalKey =
  | "function"
  | "family"
  | "industry"
  | "title_alias"
  | "nature_of_work"
  | "skill_overlap"
  | "company_type"
  | "geography";

export interface BucketResolverResult {
  selected: BucketCandidate | null;
  confidence: number;                  // 0..1
  action: BucketMatchAction;
  top_candidates: BucketCandidate[];   // includes selected when present
  candidate_needed: boolean;
  mismatch_flags: string[];
  reason_summary: string;
  /** Set when action === 'auto_created' — the newly inserted bucket row id */
  auto_created_bucket_id?: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (kept in this file so all consumers can import from one place)
// ─────────────────────────────────────────────────────────────────────

export function confidenceBandToScore(band: ConfidenceBand | string | null): number {
  if (band === "high") return 0.9;
  if (band === "medium") return 0.7;
  if (band === "low") return 0.5;
  return 0.5;
}

export function categoryToTier(category: string): string {
  if (["technology", "tool", "certification", "methodology", "language"].includes(category)) return "hard_skill";
  if (["knowledge", "domain"].includes(category)) return "knowledge";
  return "competency";
}

export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
