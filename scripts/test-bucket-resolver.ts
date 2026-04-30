/**
 * Smoke-test the bucket resolver against in-memory fixtures.
 *
 * This intentionally does NOT need SUPABASE_* env vars — it uses the
 * resolver's overrideBuckets/overrideAliases hook so it runs purely
 * locally. Run with:
 *
 *   npx tsx scripts/test-bucket-resolver.ts
 *
 * Used as the dry-run verification in the milestone PR.
 */

import { resolveBucket } from "../api/lib/bucketResolver";
import type { ClassificationResult } from "../api/lib/bucketTypes";

const FIXTURE_BUCKETS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    bucket_code: "MBA-T2-IN-FMCG-FIELD-SALES",
    name: "FMCG Territory & Distribution Sales",
    description: null,
    bucket_scope: "mba",
    function_id: "FN-SAL",
    family_id: "JF-04",
    industry_id: "IND-04",
    seniority_level: "L1",
    standardized_title: "Area Sales Executive",
    company_type: "Indian Enterprise",
    geography_scope: "India",
    nature_of_work: "beat route management distributor retailer relationship volume offtake targets new outlet addition sspd",
    exclusion_rules: ["digital marketing", "brand management"],
    status: "validated",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    bucket_code: "MBA-T1-IN-MGT-CONSULTING-MBB-BIG4",
    name: "Management Consulting — MBB / Big 4 Strategy",
    description: null,
    bucket_scope: "mba",
    function_id: "FN-CON",
    family_id: "JF-01",
    industry_id: "IND-05",
    seniority_level: "L2",
    standardized_title: "Associate Consultant",
    company_type: "Consulting Firm",
    geography_scope: "India",
    nature_of_work: "strategy consulting m&a growth transformation case-led problem solving client engagement",
    exclusion_rules: [],
    status: "validated",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    bucket_code: "MBA-GCC-UAE-KEY-ACCOUNT-BD",
    name: "UAE / GCC Key Account & Business Development",
    description: null,
    bucket_scope: "mba",
    function_id: "FN-BDV",
    family_id: "JF-04",
    industry_id: "IND-15",
    seniority_level: "L2",
    standardized_title: "Key Account Executive",
    company_type: "MNC",
    geography_scope: "UAE",
    nature_of_work: "key account development gcc markets client relationship management deal closures account growth",
    exclusion_rules: [],
    status: "candidate",
  },
];

const FIXTURE_ALIASES = [
  { bucket_id: "00000000-0000-0000-0000-000000000001", alias_norm: "sales trainee" },
  { bucket_id: "00000000-0000-0000-0000-000000000001", alias_norm: "territory sales incharge" },
  { bucket_id: "00000000-0000-0000-0000-000000000001", alias_norm: "tsi" },
  { bucket_id: "00000000-0000-0000-0000-000000000001", alias_norm: "area sales executive" },
  { bucket_id: "00000000-0000-0000-0000-000000000002", alias_norm: "associate consultant" },
  { bucket_id: "00000000-0000-0000-0000-000000000002", alias_norm: "business analyst consulting" },
  { bucket_id: "00000000-0000-0000-0000-000000000003", alias_norm: "key account executive" },
  { bucket_id: "00000000-0000-0000-0000-000000000003", alias_norm: "business development executive uae" },
];

const FIXTURE_SKILL_MAP = [] as Array<{ bucket_id: string; taxonomy_skill_id: string; requirement_type: string }>;

function buildClassification(overrides: Partial<ClassificationResult>): ClassificationResult {
  return {
    job_function: null,
    job_function_name: null,
    job_family: null,
    job_family_name: null,
    job_industry: null,
    job_industry_name: null,
    seniority: null,
    company_type: null,
    geography: null,
    standardized_title: null,
    sub_role: null,
    company_name: null,
    ctc_min: null,
    ctc_max: null,
    experience_min: null,
    experience_max: null,
    min_education: null,
    preferred_fields: [],
    bucket_label: null,
    skills: [],
    jd_quality: "well_structured",
    classification_confidence: "high",
    classification_confidence_score: 0.9,
    ...overrides,
  };
}

const cases: Array<{ name: string; classification: ClassificationResult; expectedTopCode?: string; expectedAction?: string }> = [
  {
    name: "Tier-2 FMCG TSI — should auto-assign to MBA-T2-IN-FMCG-FIELD-SALES",
    classification: buildClassification({
      job_function: "FN-SAL",
      job_family: "JF-04",
      job_industry: "IND-04",
      seniority: "L1",
      company_type: "Indian Enterprise",
      geography: "Tier-2-India",
      standardized_title: "Territory Sales Incharge",
      sub_role: "Distributor Management",
    }),
    expectedTopCode: "MBA-T2-IN-FMCG-FIELD-SALES",
  },
  {
    name: "Big 4 strategy associate — should match consulting bucket",
    classification: buildClassification({
      job_function: "FN-CON",
      job_family: "JF-01",
      job_industry: "IND-05",
      seniority: "L2",
      company_type: "Consulting Firm",
      geography: "Metro-Mumbai",
      standardized_title: "Associate Consultant",
      sub_role: "Strategy Consulting",
    }),
    expectedTopCode: "MBA-T1-IN-MGT-CONSULTING-MBB-BIG4",
  },
  {
    name: "Dubai BDE — should match UAE candidate bucket but not auto-assign",
    classification: buildClassification({
      job_function: "FN-BDV",
      job_family: "JF-04",
      job_industry: "IND-15",
      seniority: "L2",
      company_type: "MNC",
      geography: "UAE-Dubai",
      standardized_title: "Business Development Executive UAE",
      sub_role: "Key Account Management",
    }),
    expectedTopCode: "MBA-GCC-UAE-KEY-ACCOUNT-BD",
    expectedAction: "tentative",
  },
  {
    name: "Pure software role — should not match any seeded bucket strongly",
    classification: buildClassification({
      job_function: "FN-ENG",
      job_family: "JF-09",
      job_industry: "IND-01",
      seniority: "L2",
      company_type: "Startup",
      geography: "Metro-Bangalore",
      standardized_title: "Senior Backend Engineer",
      sub_role: "Distributed Systems",
    }),
  },
];

async function main() {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const result = await resolveBucket(c.classification, {
      overrideBuckets: FIXTURE_BUCKETS,
      overrideAliases: FIXTURE_ALIASES,
      overrideSkillMap: FIXTURE_SKILL_MAP,
    });
    const top = result.top_candidates[0];
    let ok = true;
    if (c.expectedTopCode) {
      if (top?.bucket_code !== c.expectedTopCode) ok = false;
    }
    if (c.expectedAction) {
      if (result.action !== c.expectedAction) ok = false;
    }
    if (ok) pass++;
    else fail++;
    console.log(`\n[${ok ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`  action=${result.action} confidence=${result.confidence.toFixed(3)}`);
    console.log(`  top=${top?.bucket_code ?? "(none)"} score=${top?.score.toFixed(3) ?? "-"}`);
    if (!ok) {
      console.log(`  expected_top=${c.expectedTopCode ?? "-"} expected_action=${c.expectedAction ?? "-"}`);
    }
    if (result.mismatch_flags.length) console.log(`  mismatch_flags=${result.mismatch_flags.join(",")}`);
    console.log(`  reason=${result.reason_summary}`);
  }
  console.log(`\nResults: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
