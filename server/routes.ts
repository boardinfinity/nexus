import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { supabase } from "./supabase";
import { runLinkedInJobsScraper } from "./providers/apify";
import { searchGoogleJobs } from "./providers/rapidapi";
import { log } from "./index";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ==================== DASHBOARD ====================
  app.get("/api/dashboard/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get dashboard stats";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/dashboard/recent-jobs", async (_req: Request, res: Response) => {
    try {
      const jobs = await storage.getRecentJobs(20);
      res.json(jobs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get recent jobs";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/dashboard/pipeline-activity", async (_req: Request, res: Response) => {
    try {
      const runs = await storage.getPipelineActivity(10);
      res.json(runs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get pipeline activity";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== JOBS ====================
  app.get("/api/jobs/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getJobStats();
      res.json(stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get job stats";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/jobs/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const job = await storage.getJob(id);
      if (!job) return res.status(404).json({ message: "Job not found" });
      const skills = await storage.getJobSkills(id);
      res.json({ ...job, skills });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get job";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/jobs", async (req: Request, res: Response) => {
    try {
      const result = await storage.getJobs({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        search: req.query.search as string,
        source: req.query.source as string,
        enrichment_status: req.query.enrichment_status as string,
        location_country: req.query.location_country as string,
        seniority_level: req.query.seniority_level as string,
        employment_type: req.query.employment_type as string,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get jobs";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== COMPANIES ====================
  app.get("/api/companies/:id", async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(req.params.id as string);
      if (!company) return res.status(404).json({ message: "Company not found" });
      res.json(company);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get company";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/companies", async (req: Request, res: Response) => {
    try {
      const result = await storage.getCompanies({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        search: req.query.search as string,
        industry: req.query.industry as string,
        size_range: req.query.size_range as string,
        headquarters_country: req.query.headquarters_country as string,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get companies";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== PEOPLE ====================
  app.get("/api/people/:id", async (req: Request, res: Response) => {
    try {
      const person = await storage.getPerson(req.params.id as string);
      if (!person) return res.status(404).json({ message: "Person not found" });
      res.json(person);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get person";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/people", async (req: Request, res: Response) => {
    try {
      const result = await storage.getPeople({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        search: req.query.search as string,
        is_recruiter: req.query.is_recruiter === "true" ? true : req.query.is_recruiter === "false" ? false : undefined,
        is_hiring_manager: req.query.is_hiring_manager === "true" ? true : req.query.is_hiring_manager === "false" ? false : undefined,
        seniority: req.query.seniority as string,
        function: req.query.function as string,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get people";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== PIPELINES ====================
  app.get("/api/pipelines/:id", async (req: Request, res: Response) => {
    try {
      const run = await storage.getPipelineRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Pipeline run not found" });
      res.json(run);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get pipeline run";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/pipelines/:id/cancel", async (req: Request, res: Response) => {
    try {
      const run = await storage.updatePipelineRun(req.params.id as string, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
      });
      res.json(run);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel pipeline";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/pipelines", async (req: Request, res: Response) => {
    try {
      const result = await storage.getPipelineRuns({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        pipeline_type: req.query.pipeline_type as string,
        status: req.query.status as string,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get pipeline runs";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/pipelines/run", async (req: Request, res: Response) => {
    try {
      const { pipeline_type, config } = req.body;
      if (!pipeline_type) {
        return res.status(400).json({ message: "pipeline_type is required" });
      }

      const run = await storage.createPipelineRun({
        pipeline_type,
        trigger_type: "manual",
        config: config || {},
        status: "pending",
        total_items: 0,
        processed_items: 0,
        failed_items: 0,
        skipped_items: 0,
        triggered_by: "user",
        started_at: new Date().toISOString(),
      });

      // Start async execution
      executePipeline(run.id, pipeline_type, config || {}).catch((err) => {
        log(`Pipeline execution error: ${err.message}`, "pipeline");
      });

      res.json(run);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start pipeline";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== PIPELINE EXECUTION ====================
  app.post("/api/pipelines/execute/linkedin-jobs", async (req: Request, res: Response) => {
    try {
      const result = await runLinkedInJobsScraper(req.body);
      if (result.success && result.data) {
        await storage.createEnrichmentLog({
          entity_type: "job",
          entity_id: "00000000-0000-0000-0000-000000000000",
          provider: "apify",
          operation: "linkedin_jobs_scrape",
          status: "success",
          credits_used: result.credits_used,
          response_time_ms: result.response_time_ms,
        });
      }
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute LinkedIn jobs scraper";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/pipelines/execute/google-jobs", async (req: Request, res: Response) => {
    try {
      const result = await searchGoogleJobs(req.body);
      if (result.success && result.data) {
        await storage.createEnrichmentLog({
          entity_type: "job",
          entity_id: "00000000-0000-0000-0000-000000000000",
          provider: "rapidapi",
          operation: "google_jobs_search",
          status: "success",
          credits_used: result.credits_used,
          response_time_ms: result.response_time_ms,
        });
      }
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute Google jobs search";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== PROVIDERS ====================
  app.get("/api/providers", async (_req: Request, res: Response) => {
    try {
      const providers = [
        { name: "apify", display_name: "Apify", status: "active", type: "scraping" },
        { name: "rapidapi", display_name: "RapidAPI JSearch", status: "active", type: "search" },
        { name: "proxycurl", display_name: "Proxycurl", status: "inactive", type: "enrichment" },
        { name: "apollo", display_name: "Apollo.io", status: "inactive", type: "enrichment" },
        { name: "openai", display_name: "OpenAI", status: "active", type: "ai" },
      ];
      res.json(providers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get providers";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/providers/credits", async (_req: Request, res: Response) => {
    try {
      const summary = await storage.getCreditSummary();
      res.json(summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get credit summary";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== QUEUE ====================
  app.get("/api/queue/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getQueueStats();
      res.json(stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get queue stats";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/queue/process", async (_req: Request, res: Response) => {
    try {
      const jobs = await storage.dequeueJobs("default", "manual-worker", 10);
      res.json({ dequeued: jobs.length, jobs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to process queue";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== CSV UPLOADS ====================
  app.get("/api/csv-uploads", async (req: Request, res: Response) => {
    try {
      const result = await storage.getCsvUploads({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get CSV uploads";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== ENRICHMENT LOGS ====================
  app.get("/api/enrichment-logs", async (req: Request, res: Response) => {
    try {
      const result = await storage.getEnrichmentLogs({
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        provider: req.query.provider as string,
        status: req.query.status as string,
        entity_type: req.query.entity_type as string,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get enrichment logs";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== TAXONOMY ====================
  app.get("/api/taxonomy/job-roles", async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabase
        .from("job_roles")
        .select("id, name, family, synonyms")
        .order("family")
        .order("name");

      if (error) throw error;

      const grouped: Record<string, typeof data> = {};
      for (const role of data) {
        if (!grouped[role.family]) grouped[role.family] = [];
        grouped[role.family].push(role);
      }

      res.json({ families: grouped, total: data.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get job roles";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== ADMIN ====================
  app.post("/api/admin/apply-migration-027", async (_req: Request, res: Response) => {
    try {
      const { JOB_ROLES } = await import("../scripts/apply-migration-027-data");

      const batchSize = 20;
      let inserted = 0;

      for (let i = 0; i < JOB_ROLES.length; i += batchSize) {
        const batch = JOB_ROLES.slice(i, i + batchSize);
        const { error } = await supabase
          .from("job_roles")
          .upsert(batch, { onConflict: "name", ignoreDuplicates: true });

        if (error) throw error;
        inserted += batch.length;
      }

      const { count } = await supabase
        .from("job_roles")
        .select("*", { count: "exact", head: true });

      res.json({ success: true, inserted, total: count });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply migration 027";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== MASTER DATA MANAGEMENT ====================
  app.get("/api/masters/summary", async (_req: Request, res: Response) => {
    try {
      const [roles, skills, families, industries, functions] = await Promise.all([
        supabase.from("job_roles").select("*", { count: "exact", head: true }),
        supabase.from("taxonomy_skills").select("*", { count: "exact", head: true }),
        supabase.from("job_families").select("*", { count: "exact", head: true }),
        supabase.from("job_industries").select("*", { count: "exact", head: true }),
        supabase.from("job_functions").select("*", { count: "exact", head: true }),
      ]);
      res.json({
        job_roles: roles.count ?? 0,
        skills: skills.count ?? 0,
        job_families: families.count ?? 0,
        job_industries: industries.count ?? 0,
        job_functions: functions.count ?? 0,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get master data summary";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/masters/job-roles", async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabase
        .from("job_roles")
        .select("id, name, family, synonyms, created_at")
        .order("family")
        .order("name");

      if (error) throw error;
      res.json(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get job roles";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/masters/job-roles", async (req: Request, res: Response) => {
    try {
      const { name, family, synonyms } = req.body;
      if (!name || !family) {
        return res.status(400).json({ message: "name and family are required" });
      }
      const { data, error } = await supabase
        .from("job_roles")
        .insert({ name, family, synonyms: synonyms || [] })
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create job role";
      res.status(500).json({ message: msg });
    }
  });

  app.put("/api/masters/job-roles/:id", async (req: Request, res: Response) => {
    try {
      const { name, family, synonyms } = req.body;
      if (!name || !family) {
        return res.status(400).json({ message: "name and family are required" });
      }
      const { data, error } = await supabase
        .from("job_roles")
        .update({ name, family, synonyms: synonyms || [] })
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ message: "Job role not found" });
      res.json(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update job role";
      res.status(500).json({ message: msg });
    }
  });

  app.delete("/api/masters/job-roles/:id", async (req: Request, res: Response) => {
    try {
      // Check if any jobs reference this role
      const { count: jobCount } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("job_role_id", req.params.id);

      if (jobCount && jobCount > 0) {
        return res.status(409).json({
          message: `Cannot delete: ${jobCount} job(s) reference this role`,
          job_count: jobCount,
        });
      }

      const { error } = await supabase
        .from("job_roles")
        .delete()
        .eq("id", req.params.id);

      if (error) throw error;
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete job role";
      res.status(500).json({ message: msg });
    }
  });

  // ==================== PIPELINE STATS ====================
  app.get("/api/pipeline-stats", async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const stats = await storage.getPipelineStats(days);
      res.json(stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get pipeline stats";
      res.status(500).json({ message: msg });
    }
  });

  return httpServer;
}

// Background pipeline execution
async function executePipeline(
  runId: string,
  pipelineType: string,
  config: Record<string, unknown>
) {
  try {
    await storage.updatePipelineRun(runId, { status: "running" });

    let result;
    if (pipelineType === "linkedin_jobs") {
      result = await runLinkedInJobsScraper(config);
    } else if (pipelineType === "google_jobs") {
      result = await searchGoogleJobs(config);
    } else {
      await storage.updatePipelineRun(runId, {
        status: "failed",
        error_message: `Unsupported pipeline type: ${pipelineType}`,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    if (result.success && result.data) {
      let processed = 0;
      let failed = 0;

      for (const item of result.data) {
        try {
          const raw = item as Record<string, unknown>;
          if (pipelineType === "linkedin_jobs") {
            await storage.upsertJob({
              external_id: (raw.jobId || raw.id || raw.url || `linkedin-${Date.now()}-${processed}`) as string,
              source: "linkedin",
              title: (raw.title || raw.jobTitle || "Unknown") as string,
              company_name: (raw.company || raw.companyName || null) as string | null,
              description: (raw.description || null) as string | null,
              location_raw: (raw.location || raw.formattedLocation || null) as string | null,
              location_country: (raw.country || null) as string | null,
              application_url: (raw.applyUrl || raw.link || null) as string | null,
              source_url: (raw.url || raw.jobUrl || null) as string | null,
              posted_at: (raw.datePosted || raw.postedAt || raw.publishedAt || null) as string | null,
              employment_type: mapEmploymentType(raw.contractType as string | undefined),
              seniority_level: mapSeniorityLevel(raw.experienceLevel as string | undefined),
              enrichment_status: "pending",
              job_role_id: (raw.job_role_id || null) as string | null,
              raw_data: raw,
            });
          } else {
            await storage.upsertJob({
              external_id: (raw.job_id || `google-${Date.now()}-${processed}`) as string,
              source: "google_jobs",
              title: (raw.job_title || "Unknown") as string,
              company_name: (raw.employer_name || null) as string | null,
              description: (raw.job_description || null) as string | null,
              location_raw: (raw.job_city ? `${raw.job_city}, ${raw.job_state}, ${raw.job_country}` : null) as string | null,
              location_city: (raw.job_city || null) as string | null,
              location_state: (raw.job_state || null) as string | null,
              location_country: (raw.job_country || null) as string | null,
              application_url: (raw.job_apply_link || null) as string | null,
              source_url: (raw.job_google_link || null) as string | null,
              posted_at: (raw.job_posted_at_datetime_utc || null) as string | null,
              salary_min: raw.job_min_salary ? Number(raw.job_min_salary) : null,
              salary_max: raw.job_max_salary ? Number(raw.job_max_salary) : null,
              salary_currency: (raw.job_salary_currency || null) as string | null,
              enrichment_status: "pending",
              raw_data: raw,
            });
          }
          processed++;
        } catch {
          failed++;
        }

        // Update progress periodically
        if ((processed + failed) % 10 === 0) {
          await storage.updatePipelineRun(runId, {
            total_items: result.data.length,
            processed_items: processed,
            failed_items: failed,
          });
        }
      }

      await storage.updatePipelineRun(runId, {
        status: "completed",
        total_items: result.data.length,
        processed_items: processed,
        failed_items: failed,
        completed_at: new Date().toISOString(),
      });

      // Log the enrichment
      await storage.createEnrichmentLog({
        entity_type: "job",
        entity_id: "00000000-0000-0000-0000-000000000000",
        provider: pipelineType === "linkedin_jobs" ? "apify" : "rapidapi",
        operation: `${pipelineType}_pipeline`,
        status: "success",
        credits_used: result.credits_used,
        response_time_ms: result.response_time_ms,
        pipeline_run_id: runId,
      });
    } else {
      await storage.updatePipelineRun(runId, {
        status: "failed",
        error_message: result.error || "Unknown error",
        completed_at: new Date().toISOString(),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Pipeline execution failed";
    await storage.updatePipelineRun(runId, {
      status: "failed",
      error_message: msg,
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

function mapEmploymentType(raw?: string): "full_time" | "part_time" | "internship" | "contract" | "temporary" | "other" | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temp")) return "temporary";
  return "other";
}

function mapSeniorityLevel(raw?: string): "internship" | "entry_level" | "associate" | "mid_senior" | "director" | "vp" | "c_suite" | "other" | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("intern")) return "internship";
  if (lower.includes("entry") || lower.includes("junior")) return "entry_level";
  if (lower.includes("associate")) return "associate";
  if (lower.includes("mid") || lower.includes("senior")) return "mid_senior";
  if (lower.includes("director")) return "director";
  if (lower.includes("vp") || lower.includes("vice")) return "vp";
  if (lower.includes("chief") || lower.includes("c-")) return "c_suite";
  return "other";
}
