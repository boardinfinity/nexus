import { z } from "zod";

// Enums matching database
export const jobSourceEnum = ["linkedin", "google_jobs", "indeed", "naukri", "other"] as const;
export const employmentTypeEnum = ["full_time", "part_time", "internship", "contract", "temporary", "volunteer", "other"] as const;
export const seniorityLevelEnum = ["internship", "entry_level", "associate", "mid_senior", "director", "vp", "c_suite", "other"] as const;
export const enrichmentStatusEnum = ["pending", "partial", "complete", "failed"] as const;
export const pipelineTypeEnum = ["linkedin_jobs", "google_jobs", "jd_enrichment", "company_enrichment", "people_enrichment", "alumni", "hiring_manager"] as const;
export const triggerTypeEnum = ["manual", "scheduled", "api"] as const;
export const pipelineStatusEnum = ["pending", "running", "completed", "failed", "cancelled"] as const;
export const enrichmentLogStatusEnum = ["success", "failed", "rate_limited", "no_data"] as const;
export const personSeniorityEnum = ["intern", "entry", "associate", "mid_senior", "director", "vp", "c_suite", "unknown"] as const;
export const personFunctionEnum = ["engineering", "sales", "marketing", "hr", "finance", "operations", "product", "design", "data", "legal", "consulting", "education", "healthcare", "other"] as const;
export const companyTypeEnum = ["public", "private", "nonprofit", "government", "educational", "other"] as const;
export const companySizeEnum = ["1_10", "11_50", "51_200", "201_500", "501_1000", "1001_5000", "5001_10000", "10000_plus"] as const;
export const queueStatusEnum = ["pending", "processing", "completed", "failed", "dead_letter"] as const;

// Types
export interface Company {
  id: string;
  external_ids: Record<string, unknown>;
  name: string;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  logo_url: string | null;
  industry: string | null;
  sub_industry: string | null;
  company_type: typeof companyTypeEnum[number] | null;
  founded_year: number | null;
  size_range: typeof companySizeEnum[number] | null;
  employee_count: number | null;
  follower_count: number | null;
  annual_revenue_range: string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  headquarters_country: string | null;
  description: string | null;
  specialities: string[];
  total_funding_range: string | null;
  enrichment_sources: Record<string, unknown>;
  enrichment_status: typeof enrichmentStatusEnum[number];
  enrichment_score: number;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  external_ids: Record<string, unknown>;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_company_id: string | null;
  seniority: typeof personSeniorityEnum[number];
  function: typeof personFunctionEnum[number];
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  bio: string | null;
  languages: string[];
  skills: string[];
  experience: unknown[];
  education: unknown[];
  network_size: number | null;
  audience_size: number | null;
  is_hiring_manager: boolean;
  is_recruiter: boolean;
  enrichment_sources: Record<string, unknown>;
  enrichment_status: typeof enrichmentStatusEnum[number];
  enrichment_score: number;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  external_id: string;
  source: typeof jobSourceEnum[number];
  title: string;
  description: string | null;
  company_id: string | null;
  company_name: string | null;
  location_raw: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  employment_type: typeof employmentTypeEnum[number] | null;
  seniority_level: typeof seniorityLevelEnum[number] | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_unit: string | null;
  posted_at: string | null;
  closed_at: string | null;
  application_url: string | null;
  source_url: string | null;
  recruiter_id: string | null;
  recruiter_name: string | null;
  recruiter_url: string | null;
  functions: string[];
  enrichment_status: typeof enrichmentStatusEnum[number];
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface Alumni {
  id: string;
  person_id: string;
  university_name: string;
  university_id: string | null;
  degree: string | null;
  field_of_study: string | null;
  graduation_year: number | null;
  start_year: number | null;
  current_status: string;
  created_at: string;
  updated_at: string;
}

export interface JobSkill {
  id: string;
  job_id: string;
  skill_name: string;
  skill_category: string | null;
  confidence_score: number | null;
  extraction_method: "ai" | "keyword" | "manual";
  created_at: string;
}

export interface PipelineRun {
  id: string;
  pipeline_type: typeof pipelineTypeEnum[number];
  trigger_type: typeof triggerTypeEnum[number];
  config: Record<string, unknown>;
  status: typeof pipelineStatusEnum[number];
  total_items: number;
  processed_items: number;
  failed_items: number;
  skipped_items: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  triggered_by: string | null;
  created_at: string;
}

export interface EnrichmentLog {
  id: string;
  entity_type: string;
  entity_id: string;
  provider: string;
  operation: string;
  status: typeof enrichmentLogStatusEnum[number];
  credits_used: number;
  response_time_ms: number | null;
  error_message: string | null;
  raw_response: unknown;
  pipeline_run_id: string | null;
  created_at: string;
}

export interface ProviderCredit {
  id: string;
  provider: string;
  month: string;
  credits_allocated: number;
  credits_used: number;
  cost_per_credit: number;
  total_cost: number;
  updated_at: string;
}

export interface JobQueueItem {
  id: string;
  queue_name: string;
  payload: Record<string, unknown>;
  status: typeof queueStatusEnum[number];
  priority: number;
  max_retries: number;
  retry_count: number;
  error_message: string | null;
  locked_at: string | null;
  locked_by: string | null;
  scheduled_for: string;
  completed_at: string | null;
  pipeline_run_id: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_jobs: number;
  total_companies: number;
  total_people: number;
  total_alumni: number;
  total_skills: number;
  jobs_today: number;
  jobs_this_week: number;
  jobs_this_month: number;
  enrichment_complete_pct: number | null;
  active_pipelines: number;
  pending_queue: number;
  failed_queue: number;
}

// Zod schemas for pipeline run creation
export const runPipelineSchema = z.object({
  pipeline_type: z.enum(pipelineTypeEnum),
  config: z.record(z.unknown()),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>;
