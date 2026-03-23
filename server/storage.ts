import { supabase } from "./supabase";
import type {
  Job, Company, Person, PipelineRun, EnrichmentLog,
  ProviderCredit, JobQueueItem, DashboardStats, JobSkill,
} from "@shared/schema";

export const storage = {
  // Dashboard
  async getDashboardStats(): Promise<DashboardStats> {
    const { data, error } = await supabase.rpc("get_dashboard_stats");
    if (error) throw error;
    return data as DashboardStats;
  },

  async getRecentJobs(limit = 20): Promise<Job[]> {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getPipelineActivity(limit = 10): Promise<PipelineRun[]> {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  // Jobs
  async getJobs(params: {
    page?: number; limit?: number; search?: string;
    source?: string; enrichment_status?: string;
    location_country?: string; seniority_level?: string;
    employment_type?: string;
  }): Promise<{ data: Job[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("jobs").select("*", { count: "exact" });

    if (params.search) {
      query = query.ilike("title", `%${params.search}%`);
    }
    if (params.source) {
      query = query.eq("source", params.source);
    }
    if (params.enrichment_status) {
      query = query.eq("enrichment_status", params.enrichment_status);
    }
    if (params.location_country) {
      query = query.eq("location_country", params.location_country);
    }
    if (params.seniority_level) {
      query = query.eq("seniority_level", params.seniority_level);
    }
    if (params.employment_type) {
      query = query.eq("employment_type", params.employment_type);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  },

  async getJobSkills(jobId: string): Promise<JobSkill[]> {
    const { data, error } = await supabase
      .from("job_skills")
      .select("*")
      .eq("job_id", jobId);
    if (error) throw error;
    return data || [];
  },

  async getJobStats(): Promise<{ by_source: Record<string, number>; by_day: { date: string; count: number }[] }> {
    const { data: sourceData } = await supabase
      .from("jobs")
      .select("source");

    const by_source: Record<string, number> = {};
    (sourceData || []).forEach((j: { source: string }) => {
      by_source[j.source] = (by_source[j.source] || 0) + 1;
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: dayData } = await supabase
      .from("jobs")
      .select("created_at")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    const dayMap: Record<string, number> = {};
    (dayData || []).forEach((j: { created_at: string }) => {
      const date = j.created_at.split("T")[0];
      dayMap[date] = (dayMap[date] || 0) + 1;
    });
    const by_day = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    return { by_source, by_day };
  },

  async upsertJob(job: Partial<Job> & { external_id: string; source: string }): Promise<Job> {
    const { data, error } = await supabase
      .from("jobs")
      .upsert(job, { onConflict: "external_id,source" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Companies
  async getCompanies(params: {
    page?: number; limit?: number; search?: string;
    industry?: string; size_range?: string; headquarters_country?: string;
  }): Promise<{ data: Company[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("companies").select("*", { count: "exact" });

    if (params.search) {
      query = query.ilike("name", `%${params.search}%`);
    }
    if (params.industry) {
      query = query.eq("industry", params.industry);
    }
    if (params.size_range) {
      query = query.eq("size_range", params.size_range);
    }
    if (params.headquarters_country) {
      query = query.eq("headquarters_country", params.headquarters_country);
    }

    query = query.order("updated_at", { ascending: false }).range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async getCompany(id: string): Promise<Company | null> {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  },

  // People
  async getPeople(params: {
    page?: number; limit?: number; search?: string;
    is_recruiter?: boolean; is_hiring_manager?: boolean;
    seniority?: string; function?: string;
  }): Promise<{ data: Person[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("people").select("*, companies:current_company_id(name)", { count: "exact" });

    if (params.search) {
      query = query.ilike("full_name", `%${params.search}%`);
    }
    if (params.is_recruiter !== undefined) {
      query = query.eq("is_recruiter", params.is_recruiter);
    }
    if (params.is_hiring_manager !== undefined) {
      query = query.eq("is_hiring_manager", params.is_hiring_manager);
    }
    if (params.seniority) {
      query = query.eq("seniority", params.seniority);
    }
    if (params.function) {
      query = query.eq("function", params.function);
    }

    query = query.order("updated_at", { ascending: false }).range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async getPerson(id: string): Promise<Person | null> {
    const { data, error } = await supabase
      .from("people")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  },

  // Pipelines
  async getPipelineRuns(params: {
    page?: number; limit?: number; pipeline_type?: string; status?: string;
  }): Promise<{ data: PipelineRun[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("pipeline_runs").select("*", { count: "exact" });

    if (params.pipeline_type) {
      query = query.eq("pipeline_type", params.pipeline_type);
    }
    if (params.status) {
      query = query.eq("status", params.status);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async getPipelineRun(id: string): Promise<PipelineRun | null> {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  },

  async createPipelineRun(run: Partial<PipelineRun>): Promise<PipelineRun> {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .insert(run)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updatePipelineRun(id: string, updates: Partial<PipelineRun>): Promise<PipelineRun> {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Enrichment Logs
  async getEnrichmentLogs(params: {
    page?: number; limit?: number; provider?: string;
    status?: string; entity_type?: string;
  }): Promise<{ data: EnrichmentLog[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("enrichment_logs").select("*", { count: "exact" });

    if (params.provider) {
      query = query.eq("provider", params.provider);
    }
    if (params.status) {
      query = query.eq("status", params.status);
    }
    if (params.entity_type) {
      query = query.eq("entity_type", params.entity_type);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async createEnrichmentLog(log: Partial<EnrichmentLog>): Promise<EnrichmentLog> {
    const { data, error } = await supabase
      .from("enrichment_logs")
      .insert(log)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Providers / Credits
  async getProviderCredits(): Promise<ProviderCredit[]> {
    const { data, error } = await supabase
      .from("provider_credits")
      .select("*")
      .order("provider");
    if (error) throw error;
    return data || [];
  },

  async getCreditSummary(): Promise<unknown> {
    const { data, error } = await supabase.rpc("get_credit_summary");
    if (error) throw error;
    return data;
  },

  async getPipelineStats(days = 30): Promise<unknown> {
    const { data, error } = await supabase.rpc("get_pipeline_stats", { p_days: days });
    if (error) throw error;
    return data;
  },

  // Queue
  async getQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number; dead_letter: number }> {
    const { data, error } = await supabase
      .from("job_queue")
      .select("status");
    if (error) throw error;

    const counts = { pending: 0, processing: 0, completed: 0, failed: 0, dead_letter: 0 };
    (data || []).forEach((item: { status: string }) => {
      const s = item.status as keyof typeof counts;
      if (s in counts) counts[s]++;
    });
    return counts;
  },

  async enqueueJob(item: Partial<JobQueueItem>): Promise<JobQueueItem> {
    const { data, error } = await supabase
      .from("job_queue")
      .insert(item)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async dequeueJobs(queueName: string, workerId: string, batchSize = 1): Promise<JobQueueItem[]> {
    const { data, error } = await supabase.rpc("dequeue_job", {
      p_queue_name: queueName,
      p_worker_id: workerId,
      p_batch_size: batchSize,
    });
    if (error) throw error;
    return data || [];
  },

  async completeJob(jobId: string, success: boolean, errorMsg?: string): Promise<void> {
    const { error } = await supabase.rpc("complete_job", {
      p_job_id: jobId,
      p_success: success,
      p_error: errorMsg || null,
    });
    if (error) throw error;
  },

  // CSV Uploads
  async getCsvUploads(params: { page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from("csv_uploads")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  async updateProviderCredits(provider: string, creditsUsed: number): Promise<void> {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const { error } = await supabase
      .from("provider_credits")
      .update({ credits_used: creditsUsed })
      .eq("provider", provider)
      .eq("month", month);
    if (error) {
      // Attempt increment via raw SQL fallback - just log error
      console.error("Failed to update provider credits:", error);
    }
  },
};
