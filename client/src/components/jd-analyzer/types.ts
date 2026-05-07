// Shared types for the JD Analyzer UI sub-components.
// Track C — Frontend transparency. Mirrors the AnalyzeResult contract from
// /api/analyze-jd, with optional l1/l2 fields that Track B will start populating.

export interface AnalyzeSkill {
  name: string;
  category: string; // legacy lowercase (e.g. "technology", "skill", "knowledge", "competency", "certification")
  skill_tier: string;
  required: boolean;
  taxonomy_match: { id: string; name: string } | null;
  is_new: boolean;
  // Track B will populate these — Track C reads them defensively.
  l1?: string | null; // "TECHNICAL SKILLS" | "KNOWLEDGE" | "COMPETENCIES" | "CREDENTIAL"
  l2?: string | null; // "Tool" | "Methodology" | "Domain" | "Skill" | "Certification" | etc.
}

export interface BucketCandidate {
  bucket_id: string;
  bucket_code: string;
  name: string;
  status: "candidate" | "validated" | "deprecated" | "merged";
  score: number;
  reasons: Array<{ signal: string; weight: number; contribution: number; detail?: string }>;
  function_id: string | null;
  family_id: string | null;
  industry_id: string | null;
  seniority_level: string | null;
  geography_scope: string | null;
}

export interface BucketMapping {
  selected: BucketCandidate | null;
  confidence: number;
  action: "auto_assign" | "tentative" | "show_candidates" | "needs_candidate" | "unclassified";
  top_candidates: BucketCandidate[];
  candidate_needed: boolean;
  mismatch_flags: string[];
  reason_summary: string;
}

export interface AnalyzeResult {
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
  skills: AnalyzeSkill[];
  total: number;
  saved: boolean;
  classification?: any;
  bucket_mapping?: BucketMapping | null;

  // Optional metadata that Track A may add to the response. Track C renders if present.
  filename?: string | null;
  model?: string | null;
  latency_ms?: number | null;
}

// L1 colour mapping. Order matters for the legend.
export const L1_COLORS: Record<string, string> = {
  "TECHNICAL SKILLS": "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800",
  "KNOWLEDGE":        "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800",
  "COMPETENCIES":     "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800",
  "CREDENTIAL":       "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
};

// Deterministic L2 → L1 lookup mirroring the migration-037 `l2_to_l1` table.
// Used as a fallback when Track B hasn't populated `l1` on a skill yet.
export const L2_TO_L1: Record<string, string> = {
  // TECHNICAL SKILLS
  Technology:    "TECHNICAL SKILLS",
  Tool:          "TECHNICAL SKILLS",
  Methodology:   "TECHNICAL SKILLS",
  Language:      "TECHNICAL SKILLS",
  // KNOWLEDGE
  Knowledge:     "KNOWLEDGE",
  Domain:        "KNOWLEDGE",
  // COMPETENCIES
  Skill:         "COMPETENCIES",
  Competency:    "COMPETENCIES",
  Ability:       "COMPETENCIES",
  // CREDENTIAL
  Certification: "CREDENTIAL",
};

// Normalize legacy lowercase `category` → L2 + L1 when explicit fields are missing.
const LEGACY_CATEGORY_TO_L2: Record<string, string> = {
  technology: "Technology",
  tool: "Tool",
  methodology: "Methodology",
  language: "Language",
  knowledge: "Knowledge",
  domain: "Domain",
  skill: "Skill",
  competency: "Competency",
  ability: "Ability",
  certification: "Certification",
};

export function deriveL1L2(skill: AnalyzeSkill): { l1: string; l2: string } {
  const l2 = skill.l2 || LEGACY_CATEGORY_TO_L2[(skill.category || "").toLowerCase()] || "Skill";
  const l1 = skill.l1 || L2_TO_L1[l2] || "COMPETENCIES";
  return { l1, l2 };
}

export function l1Color(l1: string): string {
  return L1_COLORS[l1] || "bg-slate-100 text-slate-800 border-slate-300";
}
