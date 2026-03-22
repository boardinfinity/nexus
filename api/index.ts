import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { CronExpressionParser } from "cron-parser";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const APIFY_API_KEY = process.env.APIFY_API_KEY || "";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "nexus-survey-secret-change-me";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

// Supabase client using anon key (for auth verification)
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

async function verifyAuth(req: VercelRequest): Promise<{ authenticated: boolean; email?: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { authenticated: false };
  }
  const token = authHeader.substring(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authenticated: false };
    // Only allow @boardinfinity.com emails
    if (!user.email?.endsWith("@boardinfinity.com")) {
      return { authenticated: false };
    }
    return { authenticated: true, email: user.email };
  } catch {
    return { authenticated: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Vercel passes catch-all path segments as query param 'path'
  // e.g. /api/dashboard/stats becomes /api/index.ts?path=dashboard/stats
  const pathParam = req.query?.path;
  const pathFromQuery = Array.isArray(pathParam) ? pathParam.join("/") : pathParam;
  const path = pathFromQuery ? `/${pathFromQuery}` : (req.url?.replace(/^\/api\/index\.ts/, "").replace(/^\/api/, "").split("?")[0] || "/");

  // ==================== SURVEY ROUTES (public / survey-JWT auth, before main auth) ====================
  if (path.startsWith("/survey/")) {
    try {
      return await handleSurveyRoutes(path, req, res);
    } catch (err: any) {
      console.error("Survey API Error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  // ==================== SCHEDULER TICK (cron-secret auth, before main auth) ====================
  if (path === "/scheduler/tick" && req.method === "POST") {
    try {
      // Verify CRON_SECRET via Authorization header or Vercel cron header
      const authHeader = req.headers.authorization;
      const vercelCronHeader = req.headers["x-vercel-cron"];
      const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

      if (!CRON_SECRET) {
        return res.status(500).json({ error: "CRON_SECRET not configured" });
      }
      if (bearerToken !== CRON_SECRET && vercelCronHeader !== CRON_SECRET) {
        return res.status(401).json({ error: "Invalid cron secret" });
      }

      // Find all active schedules that are due
      const { data: dueSchedules, error: fetchErr } = await supabase
        .from("pipeline_schedules")
        .select("*")
        .eq("is_active", true)
        .lte("next_run_at", new Date().toISOString())
        .order("next_run_at", { ascending: true });

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      let triggered = 0;
      let paused = 0;
      let skipped = 0;

      for (const schedule of dueSchedules || []) {
        try {
          // Check max_runs guard
          if (schedule.max_runs && schedule.total_runs >= schedule.max_runs) {
            await supabase.from("pipeline_schedules").update({ is_active: false }).eq("id", schedule.id);
            paused++;
            continue;
          }

          // Create pipeline run record (reuse same logic as POST /api/pipelines/run)
          let providerRunId: string | null = null;
          let providerDatasetId: string | null = null;

          if (schedule.pipeline_type === "linkedin_jobs" && APIFY_API_KEY) {
            const timePostedMap: Record<string, string> = {
              "past_24h": "r86400", "24hr": "r86400",
              "past_week": "r604800", "past week": "r604800",
              "past_month": "r2592000", "past month": "r2592000",
            };
            const cfg = schedule.config as any;
            const actorInput: Record<string, any> = {
              keywords: cfg?.search_keywords || cfg?.keywords || "software engineer",
              location: cfg?.location || "India",
              maxPages: Math.ceil((parseInt(cfg?.limit) || 100) / 10),
            };
            if (cfg?.date_posted && timePostedMap[cfg.date_posted]) {
              actorInput.timePosted = timePostedMap[cfg.date_posted];
            }
            const startRes = await fetch(
              `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs?token=${APIFY_API_KEY}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
            );
            if (startRes.ok) {
              const apifyData = await startRes.json();
              providerRunId = apifyData.data?.id;
              providerDatasetId = apifyData.data?.defaultDatasetId;
            }
          }

          if (schedule.pipeline_type === "alumni" && APIFY_API_KEY) {
            const cfg = schedule.config as any;
            const actorInput: Record<string, any> = {
              schoolUrls: (cfg?.university_slug || "iit-bombay").split(",").map((s: string) => s.trim()),
              profileScraperMode: "Full",
              startPage: 1,
              takePages: parseInt(cfg?.pages) || 5,
            };
            if (cfg?.keywords) actorInput.searchQuery = cfg.keywords;
            if (cfg?.location) actorInput.locations = [cfg.location];
            if (cfg?.job_title) actorInput.currentJobTitles = [cfg.job_title];
            const startRes = await fetch(
              `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/runs?token=${APIFY_API_KEY}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
            );
            if (startRes.ok) {
              const apifyData = await startRes.json();
              providerRunId = apifyData.data?.id;
              providerDatasetId = apifyData.data?.defaultDatasetId;
            }
          }

          const { data: run, error: runErr } = await supabase
            .from("pipeline_runs")
            .insert({
              pipeline_type: schedule.pipeline_type,
              trigger_type: "scheduled",
              config: { ...(schedule.config as any || {}), _provider_run_id: providerRunId, _provider_dataset_id: providerDatasetId },
              status: "running",
              started_at: new Date().toISOString(),
              triggered_by: `schedule:${schedule.id}`,
              schedule_id: schedule.id,
            })
            .select()
            .single();

          if (runErr) {
            console.error(`Scheduler: failed to create run for schedule ${schedule.id}:`, runErr.message);
            skipped++;
            continue;
          }

          // Execute synchronous pipelines
          const syncTypes = ["google_jobs", "company_enrichment", "jd_enrichment", "people_enrichment"];
          if (syncTypes.includes(schedule.pipeline_type)) {
            await executePipeline(run.id, schedule.pipeline_type, schedule.config as any || {}).catch(console.error);
          }

          // Update schedule
          const nextRunAt = calculateNextRun(schedule.frequency, schedule.cron_expression);
          const { data: updatedRun } = await supabase.from("pipeline_runs").select("status").eq("id", run.id).single();

          await supabase.from("pipeline_schedules").update({
            last_run_at: new Date().toISOString(),
            last_run_status: updatedRun?.status || "running",
            total_runs: (schedule.total_runs || 0) + 1,
            next_run_at: nextRunAt,
            updated_at: new Date().toISOString(),
          }).eq("id", schedule.id);

          triggered++;
        } catch (schedErr: any) {
          console.error(`Scheduler: error processing schedule ${schedule.id}:`, schedErr.message);
          skipped++;
        }
      }

      return res.json({ triggered, paused, skipped });
    } catch (err: any) {
      console.error("Scheduler Tick Error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  // Authenticate all requests
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return res.status(401).json({ error: "Unauthorized. Please sign in with a @boardinfinity.com email." });
  }

  try {
    // ==================== DASHBOARD ====================
    if (path === "/dashboard/stats" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_dashboard_stats");
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || {
        total_jobs: 0, total_companies: 0, total_people: 0, total_alumni: 0,
        total_skills: 0, jobs_today: 0, jobs_this_week: 0, jobs_this_month: 0,
        enrichment_complete_pct: 0, active_pipelines: 0, pending_queue: 0, failed_queue: 0
      });
    }

    if (path === "/dashboard/recent-jobs" && req.method === "GET") {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, company_name, location_raw, source, seniority_level, posted_at, enrichment_status, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/dashboard/pipeline-activity" && req.method === "GET") {
      const { data, error } = await supabase
        .from("pipeline_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // ==================== JOBS ====================
    if (path.match(/^\/jobs\/?$/) && req.method === "GET") {
      const { search, source, enrichment_status, seniority_level, employment_type, location_country, page = "1", limit = "50" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("jobs")
        .select("id, external_id, title, company_name, location_raw, location_city, location_country, source, seniority_level, employment_type, salary_min, salary_max, salary_currency, posted_at, enrichment_status, created_at", { count: "exact" });

      if (search) query = query.ilike("title", `%${search}%`);
      if (source) query = query.eq("source", source);
      if (enrichment_status) query = query.eq("enrichment_status", enrichment_status);
      if (seniority_level) query = query.eq("seniority_level", seniority_level);
      if (employment_type) query = query.eq("employment_type", employment_type);
      if (location_country) query = query.ilike("location_country", `%${location_country}%`);

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    if (path.match(/^\/jobs\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/").pop();
      const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
      if (error) return res.status(404).json({ error: "Job not found" });

      // Get skills for this job
      const { data: skills } = await supabase.from("job_skills").select("*").eq("job_id", id);
      return res.json({ ...data, skills: skills || [] });
    }

    // ==================== COMPANIES ====================
    if (path.match(/^\/companies\/?$/) && req.method === "GET") {
      const { search, industry, size_range, headquarters_country, page = "1", limit = "50" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("companies")
        .select("id, name, domain, website, linkedin_url, logo_url, industry, company_type, size_range, employee_count, headquarters_city, headquarters_country, enrichment_status, enrichment_score, created_at, updated_at", { count: "exact" });

      if (search) query = query.ilike("name", `%${search}%`);
      if (industry) query = query.eq("industry", industry);
      if (size_range) query = query.eq("size_range", size_range);
      if (headquarters_country) query = query.ilike("headquarters_country", `%${headquarters_country}%`);

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    if (path.match(/^\/companies\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/").pop();
      const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
      if (error) return res.status(404).json({ error: "Company not found" });
      return res.json(data);
    }

    // ==================== PEOPLE ====================
    if (path.match(/^\/people\/?$/) && req.method === "GET") {
      const { search, seniority, function: fn, is_recruiter, is_hiring_manager, page = "1", limit = "50" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("people")
        .select("id, full_name, first_name, last_name, email, linkedin_url, current_title, seniority, function, location_city, location_country, is_hiring_manager, is_recruiter, enrichment_status, enrichment_score, created_at", { count: "exact" });

      if (search) query = query.ilike("full_name", `%${search}%`);
      if (seniority) query = query.eq("seniority", seniority);
      if (fn) query = query.eq("function", fn);
      if (is_recruiter === "true") query = query.eq("is_recruiter", true);
      if (is_hiring_manager === "true") query = query.eq("is_hiring_manager", true);

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    if (path.match(/^\/people\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/").pop();
      const { data, error } = await supabase.from("people").select("*").eq("id", id).single();
      if (error) return res.status(404).json({ error: "Person not found" });
      return res.json(data);
    }

    // ==================== PIPELINES ====================
    if (path.match(/^\/pipelines\/?$/) && req.method === "GET") {
      const { page = "1", limit = "20" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { data, error, count } = await supabase
        .from("pipeline_runs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0 });
    }

    if (path.match(/^\/pipelines\/run$/) && req.method === "POST") {
      const { pipeline_type, config } = req.body || {};
      if (!pipeline_type) return res.status(400).json({ error: "pipeline_type is required" });

      // For LinkedIn/Google jobs: start the external provider run and store run ID
      // Processing happens via the /poll endpoint (separate request)
      let providerRunId: string | null = null;
      let providerDatasetId: string | null = null;

      if (pipeline_type === "linkedin_jobs") {
        if (!APIFY_API_KEY) return res.status(400).json({ error: "Apify API key not configured" });
        const timePostedMap: Record<string, string> = {
          "past_24h": "r86400", "24hr": "r86400",
          "past_week": "r604800", "past week": "r604800",
          "past_month": "r2592000", "past month": "r2592000",
        };
        const actorInput: Record<string, any> = {
          keywords: config?.search_keywords || config?.keywords || "software engineer",
          location: config?.location || "India",
          maxPages: Math.ceil((parseInt(config?.limit) || 100) / 10),
        };
        if (config?.date_posted && timePostedMap[config.date_posted]) {
          actorInput.timePosted = timePostedMap[config.date_posted];
        }
        const startRes = await fetch(
          `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs?token=${APIFY_API_KEY}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
        );
        if (!startRes.ok) {
          const errText = await startRes.text();
          return res.status(500).json({ error: `Apify start failed: ${errText}` });
        }
        const apifyData = await startRes.json();
        providerRunId = apifyData.data?.id;
        providerDatasetId = apifyData.data?.defaultDatasetId;
      }

      // Alumni pipeline: Apify LinkedIn profile search by university
      if (pipeline_type === "alumni") {
        if (!APIFY_API_KEY) return res.status(400).json({ error: "Apify API key not configured" });
        const actorInput: Record<string, any> = {
          schoolUrls: (config?.university_slug || "iit-bombay").split(",").map((s: string) => s.trim()),
          profileScraperMode: "Full",
          startPage: 1,
          takePages: parseInt(config?.pages) || 5,
        };
        if (config?.keywords) actorInput.searchQuery = config.keywords;
        if (config?.location) actorInput.locations = [config.location];
        if (config?.job_title) actorInput.currentJobTitles = [config.job_title];

        const startRes = await fetch(
          `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/runs?token=${APIFY_API_KEY}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
        );
        if (!startRes.ok) {
          const errText = await startRes.text();
          return res.status(500).json({ error: `Apify alumni start failed: ${errText}` });
        }
        const apifyData = await startRes.json();
        providerRunId = apifyData.data?.id;
        providerDatasetId = apifyData.data?.defaultDatasetId;
      }

      // Create pipeline run with provider tracking info
      const { data: run, error } = await supabase
        .from("pipeline_runs")
        .insert({
          pipeline_type,
          trigger_type: "manual",
          config: { ...(config || {}), _provider_run_id: providerRunId, _provider_dataset_id: providerDatasetId },
          status: "running",
          started_at: new Date().toISOString(),
          triggered_by: "dashboard",
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // For non-external pipelines (company_enrichment, jd_enrichment, people_search, people_enrich), execute synchronously
      if (pipeline_type === "company_enrichment" || pipeline_type === "jd_enrichment" || pipeline_type === "people_enrichment") {
        await executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
      }

      // For Google Jobs, execute synchronously (fast RapidAPI call)
      if (pipeline_type === "google_jobs") {
        await executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
      }

      return res.json(run);
    }

    // Poll pipeline status and process results when ready
    if (path.match(/^\/pipelines\/[^/]+\/poll$/) && req.method === "POST") {
      const id = path.split("/")[2];
      const { data: run, error } = await supabase.from("pipeline_runs").select("*").eq("id", id).single();
      if (error || !run) return res.status(404).json({ error: "Pipeline run not found" });
      if (run.status !== "running") return res.json(run); // Already completed/failed

      const providerRunId = run.config?._provider_run_id;
      const providerDatasetId = run.config?._provider_dataset_id;

      // Determine which Apify actor to poll based on pipeline type
      const actorMap: Record<string, string> = {
        linkedin_jobs: "practicaltools~linkedin-jobs",
        alumni: "harvestapi~linkedin-profile-search",
      };
      const actorSlug = actorMap[run.pipeline_type];

      if (actorSlug && providerRunId) {
        // Check Apify run status
        const pollRes = await fetch(
          `https://api.apify.com/v2/acts/${actorSlug}/runs/${providerRunId}?token=${APIFY_API_KEY}`
        );
        const pollData = await pollRes.json();
        const apifyStatus = pollData.data?.status;

        if (apifyStatus === "RUNNING" || apifyStatus === "READY") {
          return res.json({ ...run, _apify_status: apifyStatus });
        }

        if (apifyStatus !== "SUCCEEDED") {
          await supabase.from("pipeline_runs").update({
            status: "failed",
            error_message: `Apify run status: ${apifyStatus}`,
            completed_at: new Date().toISOString(),
          }).eq("id", id);
          return res.json({ ...run, status: "failed", error_message: `Apify run status: ${apifyStatus}` });
        }

        // Apify SUCCEEDED — fetch and process results
        const dsId = providerDatasetId || pollData.data?.defaultDatasetId;
        if (run.pipeline_type === "linkedin_jobs") {
          await processLinkedInResults(id, dsId, run.config);
        } else if (run.pipeline_type === "alumni") {
          await processAlumniResults(id, dsId, run.config);
        }
        const { data: updated } = await supabase.from("pipeline_runs").select("*").eq("id", id).single();
        return res.json(updated);
      }

      return res.json(run);
    }

    if (path.match(/^\/pipelines\/[^/]+$/) && !path.includes("run") && !path.includes("execute") && !path.includes("cancel") && req.method === "GET") {
      const id = path.split("/").pop();
      const { data, error } = await supabase.from("pipeline_runs").select("*").eq("id", id).single();
      if (error) return res.status(404).json({ error: "Pipeline run not found" });
      return res.json(data);
    }

    if (path.match(/^\/pipelines\/[^/]+\/cancel$/) && req.method === "POST") {
      const id = path.split("/")[2];
      const { error } = await supabase
        .from("pipeline_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    // ==================== PROVIDERS ====================
    if (path === "/providers/credits" && req.method === "GET") {
      const { data, error } = await supabase
        .from("provider_credits")
        .select("*")
        .order("provider");
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // ==================== MONITORING ====================
    if (path === "/monitoring/queue-stats" && req.method === "GET") {
      const { data: pending } = await supabase.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
      const { data: processing } = await supabase.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing");
      const { data: deadLetter } = await supabase.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "dead_letter");

      // Use count from headers - simplified approach
      const { count: pendingCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "pending");
      const { count: processingCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "processing");
      const { count: deadLetterCount } = await supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "dead_letter");

      return res.json({
        pending: pendingCount || 0,
        processing: processingCount || 0,
        dead_letter: deadLetterCount || 0,
      });
    }

    if (path === "/monitoring/enrichment-logs" && req.method === "GET") {
      const { provider, status, entity_type, limit = "50" } = req.query as Record<string, string>;
      let query = supabase
        .from("enrichment_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(parseInt(limit));

      if (provider) query = query.eq("provider", provider);
      if (status) query = query.eq("status", status);
      if (entity_type) query = query.eq("entity_type", entity_type);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/monitoring/pipeline-stats" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_pipeline_stats", { p_days: 30 });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // ==================== SETTINGS ====================
    if (path === "/settings/providers" && req.method === "GET") {
      return res.json({
        apify: { configured: !!APIFY_API_KEY, key_preview: APIFY_API_KEY ? `...${APIFY_API_KEY.slice(-6)}` : null },
        rapidapi: { configured: !!RAPIDAPI_KEY, key_preview: RAPIDAPI_KEY ? `...${RAPIDAPI_KEY.slice(-6)}` : null },
        apollo: { configured: false, key_preview: null },
        proxycurl: { configured: false, key_preview: null },
        hunter: { configured: false, key_preview: null },
        openai: { configured: !!OPENAI_API_KEY, key_preview: OPENAI_API_KEY ? `...${OPENAI_API_KEY.slice(-6)}` : null },
      });
    }

    // ==================== ALUMNI ====================
    if (path.match(/^\/alumni\/?$/) && req.method === "GET") {
      const { search, university_name, graduation_year, page = "1", limit = "50" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("alumni")
        .select(`
          id, university_name, university_id, degree, field_of_study, graduation_year, start_year, current_status, created_at,
          person:people!alumni_person_id_fkey(id, full_name, first_name, last_name, email, linkedin_url, current_title, location_city, location_country)
        `, { count: "exact" });

      if (university_name) query = query.ilike("university_name", `%${university_name}%`);
      if (graduation_year) query = query.eq("graduation_year", parseInt(graduation_year));

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    // ==================== TAXONOMY ====================
    if (path === "/taxonomy" && req.method === "GET") {
      const { category, source, search, page = "1", limit = "50" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("taxonomy_skills")
        .select("*", { count: "exact" });

      if (category) query = query.eq("category", category);
      if (source) query = query.eq("source", source);
      if (search) query = query.ilike("name", `%${search}%`);

      const { data, error, count } = await query
        .order("name")
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    if (path === "/taxonomy/stats" && req.method === "GET") {
      // Category counts
      const { data: catData, error: catErr } = await supabase
        .from("taxonomy_skills")
        .select("category");
      if (catErr) return res.status(500).json({ error: catErr.message });

      const categoryCounts: Record<string, number> = {};
      for (const row of catData || []) {
        categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
      }

      // Hot technology count
      const { count: hotCount } = await supabase
        .from("taxonomy_skills")
        .select("id", { count: "exact", head: true })
        .eq("is_hot_technology", true);

      // Top skills by job count
      const { data: topSkills, error: topErr } = await supabase
        .from("job_skills")
        .select("skill_name, taxonomy_skill_id");
      if (topErr) return res.status(500).json({ error: topErr.message });

      const skillCounts: Record<string, number> = {};
      for (const row of topSkills || []) {
        skillCounts[row.skill_name] = (skillCounts[row.skill_name] || 0) + 1;
      }
      const topSkillsList = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, job_count: count }));

      return res.json({
        total: (catData || []).length,
        by_category: categoryCounts,
        hot_technologies: hotCount || 0,
        top_skills: topSkillsList,
      });
    }

    if (path.match(/^\/taxonomy\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("taxonomy_skills")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return res.status(404).json({ error: "Taxonomy skill not found" });

      // Get job count for this skill
      const { count: jobCount } = await supabase
        .from("job_skills")
        .select("id", { count: "exact", head: true })
        .eq("taxonomy_skill_id", id);

      return res.json({ ...data, job_count: jobCount || 0 });
    }

    if (path === "/analyze-jd" && req.method === "POST") {
      const { text, job_id } = req.body || {};
      let jdText = text;

      if (!jdText && job_id) {
        const { data: job } = await supabase
          .from("jobs")
          .select("description, title, company_name, location_raw, employment_type, seniority_level, functions, raw_data")
          .eq("id", job_id)
          .single();
        
        if (job?.description) {
          jdText = job.description;
        } else if (job) {
          // Build a synthetic JD from available metadata + raw_data
          const parts: string[] = [];
          if (job.title) parts.push(`Job Title: ${job.title}`);
          if (job.company_name) parts.push(`Company: ${job.company_name}`);
          if (job.location_raw) parts.push(`Location: ${job.location_raw}`);
          if (job.employment_type) parts.push(`Employment Type: ${job.employment_type}`);
          if (job.seniority_level) parts.push(`Seniority: ${job.seniority_level}`);
          if (job.functions?.length) parts.push(`Functions: ${job.functions.join(", ")}`);
          // Check raw_data for any description-like fields
          const rd = job.raw_data as Record<string, any> | null;
          if (rd?.description) parts.push(`Description: ${rd.description}`);
          if (rd?.descriptionHtml) {
            // Strip HTML tags for plain text
            const plain = rd.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (plain.length > 50) parts.push(`Description: ${plain}`);
          }
          if (rd?.requirements) parts.push(`Requirements: ${rd.requirements}`);
          if (rd?.qualifications) parts.push(`Qualifications: ${rd.qualifications}`);
          
          if (parts.length > 2) {
            jdText = parts.join("\n");
          }
        }
      }

      if (!jdText) {
        return res.status(400).json({ error: job_id ? "This job has no description data. Please paste the JD text manually instead." : "Provide 'text' or 'job_id'" });
      }

      if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
      }

      try {
        const extracted = await extractSkillsWithAI(jdText);

        // Try to match against taxonomy
        const matched = [];
        for (const skill of extracted) {
          const { data: match } = await supabase
            .from("taxonomy_skills")
            .select("id, name, category, subcategory")
            .ilike("name", `%${skill.name}%`)
            .limit(1)
            .single();

          matched.push({
            ...skill,
            taxonomy_match: match || null,
          });
        }

        return res.json({ skills: matched, total: matched.length });
      } catch (err: any) {
        return res.status(500).json({ error: err.message || "AI extraction failed" });
      }
    }

    // ==================== DB MIGRATION ====================
    if (path === "/migrate/csv-upload" && req.method === "POST") {
      const statements = [
        `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
        `CREATE TABLE IF NOT EXISTS csv_uploads (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          filename TEXT NOT NULL,
          source_type TEXT NOT NULL,
          total_rows INTEGER NOT NULL,
          processed_rows INTEGER DEFAULT 0,
          skipped_rows INTEGER DEFAULT 0,
          failed_rows INTEGER DEFAULT 0,
          error_log JSONB DEFAULT '[]',
          status TEXT DEFAULT 'processing',
          uploaded_by TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          completed_at TIMESTAMPTZ
        )`,
        `CREATE INDEX IF NOT EXISTS idx_csv_uploads_status ON csv_uploads (status, created_at DESC)`,
        `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_normalized TEXT`,
        `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_name_normalized TEXT`,
        `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_unit TEXT`,
      ];
      const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
      for (const sql of statements) {
        const { error } = await supabase.rpc("exec_sql", { query: sql }).maybeSingle();
        if (error) {
          // Try direct query as fallback
          const { error: directError } = await supabase.from("csv_uploads").select("id").limit(0);
          results.push({ sql: sql.slice(0, 80), ok: !directError, error: error.message });
        } else {
          results.push({ sql: sql.slice(0, 80), ok: true });
        }
      }
      return res.json({ message: "Migration attempted", results });
    }

    // ==================== CSV UPLOAD ====================
    if (path === "/upload/start" && req.method === "POST") {
      const { filename, source_type, total_rows } = req.body || {};
      if (!filename || !source_type || !total_rows) {
        return res.status(400).json({ error: "filename, source_type, and total_rows are required" });
      }
      if (!["clay_linkedin", "google_jobs", "custom"].includes(source_type)) {
        return res.status(400).json({ error: "source_type must be one of: clay_linkedin, google_jobs, custom" });
      }

      const { data, error } = await supabase
        .from("csv_uploads")
        .insert({
          filename,
          source_type,
          total_rows: parseInt(total_rows),
          status: "processing",
          uploaded_by: auth.email || null,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ upload_id: data.id, status: "processing" });
    }

    if (path === "/upload/batch" && req.method === "POST") {
      const { upload_id, source_type, rows } = req.body || {};
      if (!upload_id || !source_type || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "upload_id, source_type, and rows[] are required" });
      }

      const batchResult = await processUploadBatch(rows, source_type, upload_id);

      // Check if upload is complete and finalize
      await finalizeUpload(upload_id);

      return res.json({ batch_result: batchResult });
    }

    if (path.match(/^\/upload\/template\/(clay_linkedin|google_jobs|custom)$/) && req.method === "GET") {
      const source = path.split("/").pop()!;
      const templates: Record<string, string> = {
        clay_linkedin: "Job Title,Job Id,Job Post - LinkedIn,Company Name,Company URL,Company LinkedIn Page,Location,Posted On,Seniority",
        google_jobs: "job_title,job_id,employer_name,employer_website,employer_logo,job_description,job_employment_type,job_apply_link,job_location,job_city,job_state,job_country,job_posted_at_datetime_utc,job_min_salary,job_max_salary,job_salary_period,job_google_link,job_onet_soc,search_query",
        custom: "title,external_id,company_name,location,posted_at,source_url,description,employment_type,seniority_level",
      };
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="template_${source}.csv"`);
      return res.send(templates[source] + "\n");
    }

    if (path.match(/^\/upload\/[0-9a-f-]+$/) && req.method === "GET") {
      const id = path.split("/").pop();
      const { data, error } = await supabase
        .from("csv_uploads")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return res.status(404).json({ error: "Upload not found" });
      return res.json(data);
    }

    if (path.match(/^\/jobs\/[^/]+\/skills$/) && req.method === "GET") {
      const jobId = path.split("/")[2];
      const { data, error } = await supabase
        .from("job_skills")
        .select("*, taxonomy_skill:taxonomy_skills(id, name, category, subcategory)")
        .eq("job_id", jobId)
        .order("confidence_score", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // ==================== SCHEDULES ====================
    const VALID_PIPELINE_TYPES = ["linkedin_jobs", "google_jobs", "alumni", "company_enrichment", "jd_enrichment", "people_enrichment"];
    const VALID_FREQUENCIES = ["hourly", "every_6h", "daily", "weekly", "custom"];

    if (path.match(/^\/schedules\/?$/) && req.method === "GET") {
      const { data, error } = await supabase
        .from("pipeline_schedules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path.match(/^\/schedules\/?$/) && req.method === "POST") {
      const { name, pipeline_type, config, frequency, cron_expression, max_runs, credit_limit } = req.body || {};
      if (!name) return res.status(400).json({ error: "name is required" });
      if (!pipeline_type || !VALID_PIPELINE_TYPES.includes(pipeline_type)) {
        return res.status(400).json({ error: `pipeline_type must be one of: ${VALID_PIPELINE_TYPES.join(", ")}` });
      }
      if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}` });
      }
      if (frequency === "custom" && cron_expression) {
        try { CronExpressionParser.parse(cron_expression); } catch {
          return res.status(400).json({ error: "Invalid cron expression" });
        }
      }
      const nextRunAt = calculateNextRun(frequency, cron_expression);
      const { data, error } = await supabase
        .from("pipeline_schedules")
        .insert({
          name,
          pipeline_type,
          config: config || {},
          frequency,
          cron_expression: frequency === "custom" ? cron_expression : null,
          max_runs: max_runs || null,
          credit_limit: credit_limit || null,
          next_run_at: nextRunAt,
          created_by: auth.email,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    if (path.match(/^\/schedules\/[^/]+$/) && req.method === "PUT") {
      const id = path.split("/").pop();
      const { name, config, frequency, cron_expression, max_runs, credit_limit } = req.body || {};
      if (frequency && !VALID_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}` });
      }
      if (frequency === "custom" && cron_expression) {
        try { CronExpressionParser.parse(cron_expression); } catch {
          return res.status(400).json({ error: "Invalid cron expression" });
        }
      }
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) updates.name = name;
      if (config !== undefined) updates.config = config;
      if (frequency !== undefined) updates.frequency = frequency;
      if (frequency !== undefined || cron_expression !== undefined) {
        updates.cron_expression = (frequency || "custom") === "custom" ? cron_expression : null;
        updates.next_run_at = calculateNextRun(frequency || "daily", cron_expression);
      }
      if (max_runs !== undefined) updates.max_runs = max_runs;
      if (credit_limit !== undefined) updates.credit_limit = credit_limit;

      const { data, error } = await supabase
        .from("pipeline_schedules")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (path.match(/^\/schedules\/[^/]+\/pause$/) && req.method === "POST") {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("pipeline_schedules")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (path.match(/^\/schedules\/[^/]+\/resume$/) && req.method === "POST") {
      const id = path.split("/")[2];
      // Get schedule to recalculate next_run_at
      const { data: schedule } = await supabase.from("pipeline_schedules").select("*").eq("id", id).single();
      if (!schedule) return res.status(404).json({ error: "Schedule not found" });
      const nextRunAt = calculateNextRun(schedule.frequency, schedule.cron_expression);
      const { data, error } = await supabase
        .from("pipeline_schedules")
        .update({ is_active: true, next_run_at: nextRunAt, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (path.match(/^\/schedules\/[^/]+$/) && req.method === "DELETE") {
      const id = path.split("/").pop();
      // Unlink pipeline_runs from this schedule
      await supabase.from("pipeline_runs").update({ schedule_id: null }).eq("schedule_id", id);
      const { error } = await supabase.from("pipeline_schedules").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    if (path.match(/^\/schedules\/[^/]+\/runs$/) && req.method === "GET") {
      const id = path.split("/")[2];
      const limit = req.query?.limit || "20";
      const offset = req.query?.offset || "0";
      const { data, error, count } = await supabase
        .from("pipeline_runs")
        .select("*", { count: "exact" })
        .eq("schedule_id", id)
        .order("created_at", { ascending: false })
        .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [], total: count || 0 });
    }

    // ==================== ANALYTICS ====================

    if (path === "/analytics/overview" && req.method === "GET") {
      const { date_from, date_to, source, country, status } = req.query as Record<string, string>;

      let jobsQuery = supabase.from("jobs").select("*", { count: "exact", head: true });
      let jobsWithDescQuery = supabase.from("jobs").select("*", { count: "exact", head: true }).not("description", "is", null);
      let jobsAnalyzedQuery = supabase.from("jobs").select("*", { count: "exact", head: true }).eq("enrichment_status", "complete");
      let companiesQuery = supabase.from("companies").select("*", { count: "exact", head: true });
      let peopleQuery = supabase.from("people").select("*", { count: "exact", head: true });
      let alumniQuery = supabase.from("alumni").select("*", { count: "exact", head: true });
      let skillsQuery = supabase.from("job_skills").select("skill_name");
      let jobsPeriodQuery = supabase.from("jobs").select("*", { count: "exact", head: true });

      // Apply filters to all job-related queries
      const applyJobFilters = (q: any) => {
        if (source) q = q.eq("source", source);
        if (country) q = q.eq("location_country", country);
        if (status) q = q.eq("enrichment_status", status);
        if (date_from) q = q.gte("created_at", date_from);
        if (date_to) q = q.lte("created_at", date_to);
        return q;
      };

      jobsQuery = applyJobFilters(jobsQuery);
      jobsWithDescQuery = applyJobFilters(jobsWithDescQuery);
      jobsAnalyzedQuery = applyJobFilters(jobsAnalyzedQuery);
      jobsPeriodQuery = applyJobFilters(jobsPeriodQuery);

      const [
        totalJobsRes,
        jobsWithDescRes,
        jobsAnalyzedRes,
        companiesRes,
        peopleRes,
        alumniRes,
        skillsRes,
        jobsPeriodRes,
      ] = await Promise.all([
        jobsQuery,
        jobsWithDescQuery,
        jobsAnalyzedQuery,
        companiesQuery,
        peopleQuery,
        alumniQuery,
        skillsQuery,
        jobsPeriodQuery,
      ]);

      const totalJobs = totalJobsRes.count || 0;
      const jobsWithDesc = jobsWithDescRes.count || 0;
      const jobsAnalyzed = jobsAnalyzedRes.count || 0;
      const uniqueSkills = new Set((skillsRes.data || []).map((s: any) => s.skill_name)).size;

      return res.json({
        total_jobs: totalJobs,
        jobs_with_descriptions: jobsWithDesc,
        jobs_analyzed: jobsAnalyzed,
        jd_coverage_pct: totalJobs > 0 ? Math.round((jobsWithDesc / totalJobs) * 1000) / 10 : 0,
        skills_extracted: uniqueSkills,
        total_companies: companiesRes.count || 0,
        total_people: peopleRes.count || 0,
        total_alumni: alumniRes.count || 0,
        jobs_period: jobsPeriodRes.count || 0,
        enrichment_complete_pct: totalJobs > 0 ? Math.round((jobsAnalyzed / totalJobs) * 1000) / 10 : 0,
        training_data_ready: jobsAnalyzed,
      });
    }

    if (path === "/analytics/jobs-by-source" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      let query = supabase.from("jobs").select("source");
      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (status) query = query.eq("enrichment_status", status);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const src = row.source || "unknown";
        counts[src] = (counts[src] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);

      return res.json(result);
    }

    if (path === "/analytics/jobs-by-region" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      let query = supabase.from("jobs").select("location_country").not("location_country", "is", null);
      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (status) query = query.eq("enrichment_status", status);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const country = row.location_country || "Unknown";
        counts[country] = (counts[country] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return res.json(result);
    }

    if (path === "/analytics/jobs-by-role" && req.method === "GET") {
      const { data, error } = await supabase.from("jobs").select("title").not("title", "is", null);
      if (error) return res.status(500).json({ error: error.message });

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const title = row.title || "Unknown";
        counts[title] = (counts[title] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);

      return res.json(result);
    }

    if (path === "/analytics/top-skills" && req.method === "GET") {
      const { limit: limitStr, source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const limit = parseInt(limitStr || "20");
      const hasJobFilters = source || country || status || date_from || date_to;

      let skillsData: any[] = [];
      if (hasJobFilters) {
        // First get filtered job IDs, then get their skills
        let jobQuery = supabase.from("jobs").select("id");
        if (source) jobQuery = jobQuery.eq("source", source);
        if (country) jobQuery = jobQuery.eq("location_country", country);
        if (status) jobQuery = jobQuery.eq("enrichment_status", status);
        if (date_from) jobQuery = jobQuery.gte("created_at", date_from);
        if (date_to) jobQuery = jobQuery.lte("created_at", date_to);
        const { data: jobs, error: jobsErr } = await jobQuery;
        if (jobsErr) return res.status(500).json({ error: jobsErr.message });
        const jobIds = (jobs || []).map((j: any) => j.id);
        if (jobIds.length === 0) return res.json([]);
        const { data, error } = await supabase.from("job_skills").select("skill_name").in("job_id", jobIds);
        if (error) return res.status(500).json({ error: error.message });
        skillsData = data || [];
      } else {
        const { data, error } = await supabase.from("job_skills").select("skill_name");
        if (error) return res.status(500).json({ error: error.message });
        skillsData = data || [];
      }

      const counts: Record<string, number> = {};
      for (const row of skillsData) {
        const name = row.skill_name || "Unknown";
        counts[name] = (counts[name] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([skill_name, count]) => ({ skill_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return res.json(result);
    }

    if (path === "/analytics/recent-skills" && req.method === "GET") {
      const days = parseInt((req.query as Record<string, string>).days || "30");
      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data: jobs, error: jobsErr } = await supabase
        .from("jobs")
        .select("id")
        .gte("created_at", since.toISOString());
      if (jobsErr) return res.status(500).json({ error: jobsErr.message });

      const jobIds = (jobs || []).map((j: any) => j.id);
      if (jobIds.length === 0) return res.json([]);

      const { data: skills, error: skillsErr } = await supabase
        .from("job_skills")
        .select("skill_name")
        .in("job_id", jobIds);
      if (skillsErr) return res.status(500).json({ error: skillsErr.message });

      const counts: Record<string, number> = {};
      for (const row of skills || []) {
        const name = row.skill_name || "Unknown";
        counts[name] = (counts[name] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([skill_name, count]) => ({ skill_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      return res.json(result);
    }

    if (path === "/analytics/enrichment-funnel" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      let query = supabase.from("jobs").select("enrichment_status");
      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (status) query = query.eq("enrichment_status", status);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const status = row.enrichment_status || "pending";
        counts[status] = (counts[status] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);

      return res.json(result);
    }

    if (path === "/analytics/timeline" && req.method === "GET") {
      const { granularity = "day", days = "30", source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days));

      let query = supabase
        .from("jobs")
        .select("created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true });
      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (status) query = query.eq("enrichment_status", status);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const buckets: Record<string, number> = {};
      for (const row of data || []) {
        const d = new Date(row.created_at);
        let key: string;
        if (granularity === "week") {
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - d.getDay());
          key = weekStart.toISOString().split("T")[0];
        } else {
          key = d.toISOString().split("T")[0];
        }
        buckets[key] = (buckets[key] || 0) + 1;
      }
      const result = Object.entries(buckets)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return res.json(result);
    }

    if (path === "/analytics/pipeline-health" && req.method === "GET") {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("pipeline_runs")
        .select("pipeline_type, status")
        .gte("created_at", since.toISOString());
      if (error) return res.status(500).json({ error: error.message });

      const grouped: Record<string, Record<string, number>> = {};
      for (const row of data || []) {
        const ptype = row.pipeline_type || "unknown";
        if (!grouped[ptype]) grouped[ptype] = {};
        const st = row.status || "unknown";
        grouped[ptype][st] = (grouped[ptype][st] || 0) + 1;
      }
      const result = Object.entries(grouped).map(([pipeline_type, statuses]) => ({
        pipeline_type,
        ...statuses,
      }));

      return res.json(result);
    }

    if (path === "/analytics/jobs-table" && req.method === "GET") {
      const {
        page = "1", limit = "50", search, source, status, country, sort = "created_at", order = "desc",
      } = req.query as Record<string, string>;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      let query = supabase
        .from("jobs")
        .select("id, title, company_name, location_country, location_city, source, enrichment_status, created_at, posted_at", { count: "exact" });

      if (search) {
        query = query.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`);
      }
      if (source) query = query.eq("source", source);
      if (status) query = query.eq("enrichment_status", status);
      if (country) query = query.eq("location_country", country);

      const ascending = order === "asc";
      query = query.order(sort, { ascending }).range(offset, offset + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Get skill counts for these jobs
      const jobIds = (data || []).map((j: any) => j.id);
      let skillCounts: Record<string, number> = {};
      if (jobIds.length > 0) {
        const { data: skills } = await supabase
          .from("job_skills")
          .select("job_id")
          .in("job_id", jobIds);
        for (const s of skills || []) {
          skillCounts[s.job_id] = (skillCounts[s.job_id] || 0) + 1;
        }
      }

      const enriched = (data || []).map((j: any) => ({
        ...j,
        skills_count: skillCounts[j.id] || 0,
      }));

      return res.json({ data: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    return res.status(404).json({ error: "Not found", path });
  } catch (err: any) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

// ==================== SCHEDULER HELPERS ====================

function calculateNextRun(frequency: string, cronExpression?: string | null, from?: Date): string {
  const now = from || new Date();
  if (frequency === "custom" && cronExpression) {
    try {
      const interval = CronExpressionParser.parse(cronExpression, { currentDate: now });
      return interval.next().toISOString();
    } catch {
      // Fallback to daily if cron parse fails
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
  }
  const intervals: Record<string, number> = {
    hourly: 60 * 60 * 1000,
    every_6h: 6 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  };
  const ms = intervals[frequency] || intervals.daily;
  return new Date(now.getTime() + ms).toISOString();
}

// ==================== PIPELINE EXECUTION ====================

async function executePipeline(runId: string, pipelineType: string, config: any) {
  try {
    if (pipelineType === "linkedin_jobs" || pipelineType === "alumni") {
      // These are handled by the run/poll endpoints, not here
      return;
    } else if (pipelineType === "google_jobs") {
      await executeGoogleJobs(runId, config);
    } else if (pipelineType === "company_enrichment") {
      await executeCompanyEnrichment(runId, config);
    } else if (pipelineType === "jd_enrichment") {
      await executeJDEnrichment(runId, config);
    } else if (pipelineType === "people_enrichment") {
      await executePeopleEnrichment(runId, config);
    }
  } catch (err: any) {
    await supabase.from("pipeline_runs").update({
      status: "failed",
      error_message: err.message,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
  }
}

// Process LinkedIn job results from Apify dataset (called by /poll endpoint)
async function processLinkedInResults(runId: string, datasetId: string, config: any) {
  // Fetch results from Apify dataset
  const resultsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=1000`
  );
  const rawResults = await resultsRes.json();

  // Apify practicaltools/linkedin-jobs returns nested structure:
  // [{scrapedAt, total, jobs: [{jobId, title, company, location, datePosted, url, ...}]}]
  // Flatten to get the actual job items
  const jobs: any[] = [];
  for (const item of rawResults) {
    if (Array.isArray(item.jobs)) {
      jobs.push(...item.jobs);
    } else {
      // Fallback: treat item itself as a job if no nested structure
      jobs.push(item);
    }
  }

  // Process and upsert jobs
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  await supabase.from("pipeline_runs").update({ total_items: jobs.length }).eq("id", runId);

  for (const item of jobs) {
    try {
      const externalId = item.jobId || item.id || item.url || `li-${Date.now()}-${processed}`;

      // Check for duplicate
      const { data: existing } = await supabase
        .from("jobs")
        .select("id")
        .eq("external_id", String(externalId))
        .eq("source", "linkedin")
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Upsert company if we have company info
      const companyName = item.company || item.companyName || null;
      let companyId = null;
      if (companyName) {
        // Try to find existing company first
        const { data: existingCompany } = await supabase
          .from("companies")
          .select("id")
          .eq("name", companyName)
          .maybeSingle();
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({
              name: companyName,
              linkedin_url: item.companyUrl || null,
              domain: item.companyDomain || null,
              enrichment_status: "pending",
            })
            .select("id")
            .maybeSingle();
          companyId = newCompany?.id;
        }
      }

      // Insert job - map Apify output fields correctly
      await supabase.from("jobs").insert({
        external_id: String(externalId),
        source: "linkedin",
        title: item.title || "Unknown",
        description: item.description || null,
        company_id: companyId,
        company_name: companyName,
        location_raw: item.location || item.formattedLocation || null,
        location_city: item.city || null,
        location_state: item.state || null,
        location_country: item.country || config.location || null,
        employment_type: mapEmploymentType(item.employmentType || item.jobType),
        seniority_level: mapSeniority(item.seniorityLevel || item.experienceLevel),
        salary_min: item.salaryMin || null,
        salary_max: item.salaryMax || null,
        salary_currency: item.salaryCurrency || null,
        posted_at: item.datePosted || item.postedAt || item.publishedAt || null,
        application_url: item.applyUrl || item.applicationUrl || null,
        source_url: item.url || item.link || null,
        recruiter_name: item.recruiterName || null,
        recruiter_url: item.recruiterUrl || null,
        enrichment_status: item.description ? "partial" : "pending",
        raw_data: item,
      });

      processed++;
    } catch (e) {
      failed++;
    }

    // Update progress every 10 items
    if ((processed + failed + skipped) % 10 === 0) {
      await supabase.from("pipeline_runs").update({
        processed_items: processed,
        failed_items: failed,
        skipped_items: skipped,
      }).eq("id", runId);
    }
  }

  // Update credits
  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";
  await supabase.rpc("increment_credits_used", { p_provider: "apify", p_month: currentMonth, p_amount: processed });

  // Final update
  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    skipped_items: skipped,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function executeGoogleJobs(runId: string, config: any) {
  if (!RAPIDAPI_KEY) throw new Error("RapidAPI key not configured");

  // Support multiple queries (new: array or newline-separated string)
  let queries: string[];
  if (Array.isArray(config.queries) && config.queries.length > 0) {
    queries = config.queries.filter((q: string) => q.trim());
  } else if (typeof config.queries === "string" && config.queries.trim()) {
    queries = config.queries.split("\n").map((q: string) => q.trim()).filter(Boolean);
  } else {
    queries = [config.query || "software engineer India"];
  }

  const pagesPerQuery = Math.min(Math.max(parseInt(config.pages_per_query) || parseInt(config.pages) || 3, 1), 10);
  const country = config.country || undefined;
  const datePosted = config.date_posted || undefined;
  const employmentTypes: string[] = Array.isArray(config.employment_type) ? config.employment_type : (config.employment_type ? [config.employment_type] : []);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let totalItems = 0;

  // Store full config for reproducibility
  await supabase.from("pipeline_runs").update({
    config: { ...config, _resolved_queries: queries, _pages_per_query: pagesPerQuery },
  }).eq("id", runId);

  for (const query of queries) {
    for (let page = 1; page <= pagesPerQuery; page++) {
      const url = new URL("https://jsearch.p.rapidapi.com/search");
      url.searchParams.set("query", query);
      url.searchParams.set("page", String(page));
      url.searchParams.set("num_pages", "1");
      if (datePosted) url.searchParams.set("date_posted", datePosted);
      if (country) url.searchParams.set("country", country);
      if (employmentTypes.length > 0) {
        url.searchParams.set("employment_types", employmentTypes.join(","));
      }

      const response = await fetch(url.toString(), {
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`RapidAPI error: ${errText}`);
      }

      const result = await response.json();
      const jobs = result.data || [];
      if (jobs.length === 0) break; // No more results for this query

      totalItems += jobs.length;
      await supabase.from("pipeline_runs").update({ total_items: totalItems }).eq("id", runId);

      for (const item of jobs) {
        try {
          const externalId = item.job_id || `gj-${Date.now()}-${processed}`;

          const { data: existing } = await supabase
            .from("jobs")
            .select("id")
            .eq("external_id", String(externalId))
            .eq("source", "google_jobs")
            .maybeSingle();

          if (existing) {
            skipped++;
            continue;
          }

          let companyId = null;
          if (item.employer_name) {
            companyId = await upsertCompanyByName(item.employer_name, item.employer_website, item.employer_logo);
          }

          const desc = item.job_description || null;
          const titleNorm = normalizeText(item.job_title || "");
          const companyNorm = normalizeText(item.employer_name || "");

          await supabase.from("jobs").insert({
            external_id: String(externalId),
            source: "google_jobs",
            title: item.job_title || "Unknown",
            title_normalized: titleNorm || null,
            company_name_normalized: companyNorm || null,
            description: desc,
            company_id: companyId,
            company_name: item.employer_name || null,
            location_raw: item.job_location || [item.job_city, item.job_state, item.job_country].filter(Boolean).join(", "),
            location_city: item.job_city || null,
            location_state: item.job_state || null,
            location_country: item.job_country || null,
            employment_type: mapEmploymentTypeExtended(item.job_employment_type),
            salary_min: item.job_min_salary || null,
            salary_max: item.job_max_salary || null,
            salary_currency: item.job_salary_currency || null,
            salary_unit: item.job_salary_period || null,
            posted_at: item.job_posted_at_datetime_utc || null,
            application_url: item.job_apply_link || null,
            source_url: item.job_google_link || null,
            enrichment_status: (desc && desc.length > 100) ? "partial" : "pending",
            raw_data: { ...item, search_query: query },
          });

          processed++;
        } catch (e) {
          failed++;
        }
      }

      // Rate limit: 1 second between API calls
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await supabase.from("enrichment_logs").insert({
    entity_type: "job",
    entity_id: runId,
    provider: "rapidapi",
    operation: "google_jobs_search",
    status: "success",
    credits_used: totalItems,
  });

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    skipped_items: skipped,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function executeCompanyEnrichment(runId: string, config: any) {
  const batchSize = parseInt(config.batch_size) || 50;

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, domain, linkedin_url")
    .eq("enrichment_status", "pending")
    .limit(batchSize);

  if (error) throw error;
  if (!companies?.length) {
    await supabase.from("pipeline_runs").update({
      status: "completed",
      total_items: 0,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return;
  }

  await supabase.from("pipeline_runs").update({ total_items: companies.length }).eq("id", runId);

  let processed = 0;
  for (const company of companies) {
    // Mark as partial enrichment (stub - would call Proxycurl/Apollo here)
    await supabase.from("companies").update({
      enrichment_status: "partial",
      enrichment_score: 25,
      enrichment_sources: { manual: true },
    }).eq("id", company.id);
    processed++;
  }

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function extractSkillsWithAI(text: string): Promise<Array<{ name: string; category: string; confidence: number }>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a skill extraction expert. Extract skills from job descriptions and return structured JSON.
Categories: "skill" (soft skills like communication), "technology" (tools/languages/frameworks), "knowledge" (domain knowledge), "ability" (cognitive/physical abilities).
Return ONLY a JSON array of objects with: name (string), category (string), confidence (number 0-1).
Extract 5-30 skills depending on JD length. Be specific - prefer "React.js" over "frontend".`,
        },
        {
          role: "user",
          content: `Extract skills from this job description:\n\n${text.slice(0, 4000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "[]";

  // Parse JSON from response (handle markdown code blocks)
  const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function executeJDEnrichment(runId: string, config: any) {
  const batchSize = parseInt(config.batch_size) || 100;
  const statusFilter = config.status_filter || config.status || "pending";

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, description")
    .eq("enrichment_status", statusFilter)
    .not("description", "is", null)
    .limit(batchSize);

  if (error) throw error;
  if (!jobs?.length) {
    await supabase.from("pipeline_runs").update({
      status: "completed",
      total_items: 0,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return;
  }

  await supabase.from("pipeline_runs").update({ total_items: jobs.length }).eq("id", runId);

  let processed = 0;
  let failed = 0;
  const useAI = !!OPENAI_API_KEY;

  // Process in batches of 5 with Promise.allSettled
  for (let i = 0; i < jobs.length; i += 5) {
    const batch = jobs.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (job) => {
        let skills: Array<{ name: string; category: string; confidence: number }>;

        if (useAI) {
          skills = await extractSkillsWithAI(job.description || "");
        } else {
          // Fallback to keyword extraction
          const keywords = extractSkillsKeyword(job.description || "");
          skills = keywords.map((k) => ({ name: k, category: categorizeSkill(k), confidence: 0.7 }));
        }

        for (const skill of skills) {
          // Try to match against taxonomy
          let taxonomySkillId: string | null = null;
          const { data: match } = await supabase
            .from("taxonomy_skills")
            .select("id")
            .ilike("name", skill.name)
            .limit(1)
            .single();
          if (match) taxonomySkillId = match.id;

          await supabase.from("job_skills").upsert({
            job_id: job.id,
            skill_name: skill.name,
            skill_category: skill.category,
            confidence_score: skill.confidence,
            extraction_method: useAI ? "ai" : "keyword",
            taxonomy_skill_id: taxonomySkillId,
          }, { onConflict: "job_id,skill_name", ignoreDuplicates: true });
        }

        await supabase.from("jobs").update({ enrichment_status: "complete" }).eq("id", job.id);
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        processed++;
      } else {
        failed++;
        console.error("JD enrichment error:", r.reason);
      }
    }

    await supabase.from("pipeline_runs").update({ processed_items: processed, failed_items: failed }).eq("id", runId);
  }

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

// Process Alumni results from Apify dataset (called by /poll endpoint)
async function processAlumniResults(runId: string, datasetId: string, config: any) {
  const resultsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=2500`
  );
  const profiles: any[] = await resultsRes.json();

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  await supabase.from("pipeline_runs").update({ total_items: profiles.length }).eq("id", runId);

  const universityName = config?.university_name || config?.university_slug || "Unknown University";

  for (const profile of profiles) {
    try {
      const linkedinUrl = profile.linkedinUrl || profile.profileUrl || null;
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.fullName || "Unknown";

      // Check for duplicate person by LinkedIn URL
      if (linkedinUrl) {
        const { data: existing } = await supabase
          .from("people")
          .select("id")
          .eq("linkedin_url", linkedinUrl)
          .maybeSingle();

        if (existing) {
          // Person exists — just ensure alumni record exists
          const { data: existingAlumni } = await supabase
            .from("alumni")
            .select("id")
            .eq("person_id", existing.id)
            .ilike("university_name", `%${universityName.split("-").join("%")}%`)
            .maybeSingle();

          if (!existingAlumni) {
            // Extract education for this university
            const eduEntry = findEducationEntry(profile.education, universityName);
            await supabase.from("alumni").insert({
              person_id: existing.id,
              university_name: eduEntry?.schoolName || formatUniversityName(universityName),
              degree: eduEntry?.degree || null,
              field_of_study: eduEntry?.fieldOfStudy || null,
              graduation_year: eduEntry?.endYear || null,
              start_year: eduEntry?.startYear || null,
              current_status: profile.headline || "unknown",
            });
            processed++;
          } else {
            skipped++;
          }
          continue;
        }
      }

      // Resolve company if current experience exists
      let companyId = null;
      const currentExp = Array.isArray(profile.experience) ? profile.experience[0] : null;
      if (currentExp?.companyName) {
        const { data: existingCompany } = await supabase
          .from("companies")
          .select("id")
          .eq("name", currentExp.companyName)
          .maybeSingle();
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({
              name: currentExp.companyName,
              linkedin_url: currentExp.companyUrl || null,
              enrichment_status: "pending",
            })
            .select("id")
            .maybeSingle();
          companyId = newCompany?.id;
        }
      }

      // Insert person
      const locationObj = profile.location || {};
      const { data: newPerson, error: personError } = await supabase
        .from("people")
        .insert({
          full_name: fullName,
          first_name: profile.firstName || null,
          last_name: profile.lastName || null,
          email: profile.email || null,
          linkedin_url: linkedinUrl,
          current_title: profile.headline || currentExp?.title || null,
          current_company_id: companyId,
          location_city: locationObj.city || null,
          location_state: locationObj.state || null,
          location_country: locationObj.country || locationObj.countryCode || null,
          bio: profile.about || profile.summary || null,
          skills: Array.isArray(profile.skills) ? profile.skills.map((s: any) => typeof s === "string" ? s : s.name || s.skill || "").filter(Boolean) : [],
          experience: Array.isArray(profile.experience) ? profile.experience : [],
          education: Array.isArray(profile.education) ? profile.education : [],
          network_size: profile.connectionsCount || null,
          audience_size: profile.followerCount || null,
          enrichment_status: "complete",
          enrichment_score: 80,
          enrichment_sources: { apify_alumni: true },
          raw_data: profile,
        })
        .select("id")
        .maybeSingle();

      if (personError || !newPerson) {
        failed++;
        continue;
      }

      // Insert alumni record
      const eduEntry = findEducationEntry(profile.education, universityName);
      await supabase.from("alumni").insert({
        person_id: newPerson.id,
        university_name: eduEntry?.schoolName || formatUniversityName(universityName),
        degree: eduEntry?.degree || null,
        field_of_study: eduEntry?.fieldOfStudy || null,
        graduation_year: eduEntry?.endYear || null,
        start_year: eduEntry?.startYear || null,
        current_status: profile.headline || "unknown",
      });

      processed++;
    } catch (e) {
      failed++;
    }

    if ((processed + failed + skipped) % 10 === 0) {
      await supabase.from("pipeline_runs").update({
        processed_items: processed,
        failed_items: failed,
        skipped_items: skipped,
      }).eq("id", runId);
    }
  }

  // Update credits
  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";
  await supabase.rpc("increment_credits_used", { p_provider: "apify", p_month: currentMonth, p_amount: profiles.length });

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    skipped_items: skipped,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

// People Enrichment pipeline (Apollo API stub)
async function executePeopleEnrichment(runId: string, config: any) {
  const mode = config?.mode || "search"; // "search" or "enrich"
  const batchSize = parseInt(config?.batch_size) || 50;

  if (mode === "search") {
    // Apollo People Search API stub
    // In production: POST https://api.apollo.io/api/v1/mixed_people/search
    // with person_titles, person_locations, organization_ids, etc.
    const searchParams = {
      job_title: config?.job_title || "",
      location: config?.location || "",
      company: config?.company || "",
      seniority: config?.seniority || "",
      limit: batchSize,
    };

    // Stub: generate sample results to demonstrate the pipeline
    const stubResults = generatePeopleSearchStub(searchParams, batchSize);
    await supabase.from("pipeline_runs").update({ total_items: stubResults.length }).eq("id", runId);

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const person of stubResults) {
      try {
        // Check for duplicate by email or LinkedIn URL
        if (person.email) {
          const { data: existing } = await supabase
            .from("people")
            .select("id")
            .eq("email", person.email)
            .maybeSingle();
          if (existing) { skipped++; continue; }
        }

        let companyId = null;
        if (person.company_name) {
          const { data: existingCompany } = await supabase
            .from("companies")
            .select("id")
            .eq("name", person.company_name)
            .maybeSingle();
          if (existingCompany) {
            companyId = existingCompany.id;
          } else {
            const { data: newCompany } = await supabase
              .from("companies")
              .insert({
                name: person.company_name,
                domain: person.company_domain || null,
                enrichment_status: "pending",
              })
              .select("id")
              .maybeSingle();
            companyId = newCompany?.id;
          }
        }

        await supabase.from("people").insert({
          full_name: person.full_name,
          first_name: person.first_name,
          last_name: person.last_name,
          email: person.email || null,
          linkedin_url: person.linkedin_url || null,
          current_title: person.title || null,
          current_company_id: companyId,
          seniority: mapPersonSeniority(person.seniority),
          function: mapPersonFunction(person.department),
          location_city: person.city || null,
          location_country: person.country || null,
          enrichment_status: "partial",
          enrichment_score: 40,
          enrichment_sources: { apollo_search_stub: true },
          raw_data: person,
        });
        processed++;
      } catch (e) {
        failed++;
      }
    }

    await supabase.from("enrichment_logs").insert({
      entity_type: "person",
      entity_id: runId,
      provider: "apollo",
      operation: "people_search",
      status: "success",
      credits_used: processed,
    });

    await supabase.from("pipeline_runs").update({
      status: "completed",
      processed_items: processed,
      failed_items: failed,
      skipped_items: skipped,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

  } else if (mode === "enrich") {
    // Apollo People Enrich API stub
    // In production: POST https://api.apollo.io/api/v1/people/match
    // with email, linkedin_url, first_name, last_name, organization_name
    const { data: people, error } = await supabase
      .from("people")
      .select("id, full_name, email, linkedin_url, current_title")
      .in("enrichment_status", ["pending", "partial"])
      .limit(batchSize);

    if (error) throw error;
    if (!people?.length) {
      await supabase.from("pipeline_runs").update({
        status: "completed",
        total_items: 0,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
      return;
    }

    await supabase.from("pipeline_runs").update({ total_items: people.length }).eq("id", runId);

    let processed = 0;
    let failed = 0;

    for (const person of people) {
      try {
        // Stub enrichment: In production, call Apollo enrich API and merge data
        // For now, mark as enriched with stub data
        const enrichedData = {
          phone: null, // Would come from Apollo
          bio: "[Stub] Enrichment data would come from Apollo API",
          skills: ["Leadership", "Strategy"],
        };

        await supabase.from("people").update({
          bio: enrichedData.bio,
          skills: enrichedData.skills,
          enrichment_status: "partial",
          enrichment_score: 50,
          enrichment_sources: { apollo_enrich_stub: true },
        }).eq("id", person.id);

        processed++;
      } catch (e) {
        failed++;
      }
    }

    await supabase.from("enrichment_logs").insert({
      entity_type: "person",
      entity_id: runId,
      provider: "apollo",
      operation: "people_enrich",
      status: "success",
      credits_used: processed,
    });

    await supabase.from("pipeline_runs").update({
      status: "completed",
      processed_items: processed,
      failed_items: failed,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
  }
}

// ==================== CSV UPLOAD BATCH PROCESSING ====================

function normalizeText(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

const ARABIC_EMPLOYMENT_MAP: Record<string, string> = {
  "دوام كامل": "full_time",
  "دوام جزئي": "part_time",
  "عقد": "contract",
  "تدريب": "internship",
  "FULLTIME": "full_time",
  "PARTTIME": "part_time",
  "CONTRACTOR": "contract",
  "INTERN": "internship",
};

function mapEmploymentTypeExtended(raw: string | null): string | null {
  if (!raw) return null;
  // Check Arabic/uppercase direct mapping first
  if (ARABIC_EMPLOYMENT_MAP[raw]) return ARABIC_EMPLOYMENT_MAP[raw];
  if (ARABIC_EMPLOYMENT_MAP[raw.toUpperCase()]) return ARABIC_EMPLOYMENT_MAP[raw.toUpperCase()];
  // Fall through to standard mapping
  const lower = raw.toLowerCase();
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temp")) return "temporary";
  return lower || "other";
}

const SENIORITY_MAP: Record<string, string> = {
  "associate": "associate",
  "entry level": "entry_level",
  "mid-senior level": "mid_senior",
  "director": "director",
  "executive": "executive",
  "internship": "internship",
};

function mapSeniorityFromClay(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return SENIORITY_MAP[lower] || "unknown";
}

function parseDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

async function upsertCompanyByName(name: string, website?: string | null, logoUrl?: string | null): Promise<string | null> {
  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const domain = parseDomain(website);
  const insertData: Record<string, any> = {
    name,
    enrichment_status: "pending",
  };
  if (domain) insertData.domain = domain;
  if (website) insertData.website = website;
  if (logoUrl) insertData.logo_url = logoUrl;

  const { data: newCompany } = await supabase
    .from("companies")
    .insert(insertData)
    .select("id")
    .maybeSingle();
  return newCompany?.id || null;
}

async function processUploadBatch(
  rows: any[],
  sourceType: string,
  uploadId: string
): Promise<{ processed: number; skipped: number; failed: number; errors: any[] }> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      let jobData: Record<string, any>;

      if (sourceType === "clay_linkedin") {
        const title = (row["Job Title"] || "").trim();
        const externalId = (row["Job Id"] || "").trim();
        if (!title) throw new Error("Missing required field: Job Title");
        if (!externalId) throw new Error("Missing required field: Job Id");

        const companyName = (row["Company Name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(
            companyName,
            row["Company URL"] || null,
            null
          );
          // Update company LinkedIn URL if provided
          if (row["Company LinkedIn Page"] && companyId) {
            await supabase.from("companies")
              .update({ linkedin_url: row["Company LinkedIn Page"] })
              .eq("id", companyId)
              .is("linkedin_url", null);
          }
        }

        let postedAt: string | null = null;
        if (row["Posted On"]) {
          try {
            const d = new Date(row["Posted On"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);

        jobData = {
          external_id: externalId,
          source: "linkedin",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          company_id: companyId,
          company_name: companyName || null,
          source_url: row["Job Post - LinkedIn"] || null,
          location_raw: row["Location"] || null,
          posted_at: postedAt,
          seniority_level: mapSeniorityFromClay(row["Seniority"]),
          enrichment_status: "pending",
          raw_data: row,
        };
      } else if (sourceType === "google_jobs") {
        const title = (row["job_title"] || "").trim();
        const externalId = (row["job_id"] || "").trim();
        if (!title) throw new Error("Missing required field: job_title");
        if (!externalId) throw new Error("Missing required field: job_id");

        const companyName = (row["employer_name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(
            companyName,
            row["employer_website"] || null,
            row["employer_logo"] || null
          );
        }

        let postedAt: string | null = null;
        if (row["job_posted_at_datetime_utc"]) {
          try {
            const d = new Date(row["job_posted_at_datetime_utc"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const desc = row["job_description"] || null;
        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);
        const locationRaw = row["job_location"] || [row["job_city"], row["job_state"], row["job_country"]].filter(Boolean).join(", ");

        jobData = {
          external_id: externalId,
          source: "google_jobs",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          description: desc,
          company_id: companyId,
          company_name: companyName || null,
          location_raw: locationRaw || null,
          location_city: row["job_city"] || null,
          location_state: row["job_state"] || null,
          location_country: row["job_country"] || null,
          employment_type: mapEmploymentTypeExtended(row["job_employment_type"]),
          salary_min: parseFloat(row["job_min_salary"]) || null,
          salary_max: parseFloat(row["job_max_salary"]) || null,
          salary_unit: row["job_salary_period"] || null,
          posted_at: postedAt,
          application_url: row["job_apply_link"] || null,
          source_url: row["job_google_link"] || null,
          enrichment_status: (desc && desc.length > 100) ? "partial" : "pending",
          raw_data: {
            ...row,
            onet_soc: row["job_onet_soc"] || null,
            search_query: row["search_query"] || null,
          },
        };
      } else {
        // custom source
        const title = (row["title"] || "").trim();
        const externalId = (row["external_id"] || "").trim();
        if (!title) throw new Error("Missing required field: title");
        if (!externalId) throw new Error("Missing required field: external_id");

        const companyName = (row["company_name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(companyName);
        }

        let postedAt: string | null = null;
        if (row["posted_at"]) {
          try {
            const d = new Date(row["posted_at"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);

        jobData = {
          external_id: externalId,
          source: "other",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          company_id: companyId,
          company_name: companyName || null,
          location_raw: row["location"] || null,
          posted_at: postedAt,
          description: row["description"] || null,
          source_url: row["source_url"] || null,
          employment_type: mapEmploymentTypeExtended(row["employment_type"]),
          seniority_level: row["seniority_level"] || null,
          enrichment_status: row["description"] ? "partial" : "pending",
          raw_data: row,
        };
      }

      // Insert with ON CONFLICT handling via upsert with ignoreDuplicates
      const { error: insertError } = await supabase
        .from("jobs")
        .upsert(jobData, { onConflict: "external_id,source", ignoreDuplicates: true });

      if (insertError) {
        // Check if it's a duplicate error
        if (insertError.message?.includes("duplicate") || insertError.code === "23505") {
          skipped++;
        } else {
          throw new Error(insertError.message);
        }
      } else {
        processed++;
      }
    } catch (err: any) {
      failed++;
      errors.push({
        row_index: i,
        error: err.message || "Unknown error",
        raw: row,
      });
    }
  }

  // Update csv_uploads with cumulative counts
  const { data: current } = await supabase
    .from("csv_uploads")
    .select("processed_rows, skipped_rows, failed_rows, error_log")
    .eq("id", uploadId)
    .single();

  const existingErrors = Array.isArray(current?.error_log) ? current.error_log : [];
  const newProcessed = (current?.processed_rows || 0) + processed;
  const newSkipped = (current?.skipped_rows || 0) + skipped;
  const newFailed = (current?.failed_rows || 0) + failed;

  await supabase.from("csv_uploads").update({
    processed_rows: newProcessed,
    skipped_rows: newSkipped,
    failed_rows: newFailed,
    error_log: [...existingErrors, ...errors].slice(-500), // Keep last 500 errors
  }).eq("id", uploadId);

  return { processed, skipped, failed, errors };
}

async function finalizeUpload(uploadId: string) {
  const { data } = await supabase
    .from("csv_uploads")
    .select("total_rows, processed_rows, skipped_rows, failed_rows, source_type, filename")
    .eq("id", uploadId)
    .single();

  if (!data) return;

  const totalProcessed = (data.processed_rows || 0) + (data.skipped_rows || 0) + (data.failed_rows || 0);
  const isDone = totalProcessed >= data.total_rows;

  if (isDone) {
    await supabase.from("csv_uploads").update({
      status: data.failed_rows > data.processed_rows ? "failed" : "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", uploadId);

    // Create a pipeline_run record for tracking
    await supabase.from("pipeline_runs").insert({
      pipeline_type: "csv_upload",
      trigger_type: "manual",
      config: { upload_id: uploadId, source_type: data.source_type, filename: data.filename },
      status: "completed",
      total_items: data.total_rows,
      processed_items: data.processed_rows,
      failed_items: data.failed_rows,
      skipped_items: data.skipped_rows,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: "csv_upload",
    });
  }
}

// ==================== HELPERS ====================

function mapEmploymentType(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temp")) return "temporary";
  return "other";
}

function mapSeniority(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("intern")) return "internship";
  if (lower.includes("entry")) return "entry_level";
  if (lower.includes("associate")) return "associate";
  if (lower.includes("mid") || lower.includes("senior")) return "mid_senior";
  if (lower.includes("director")) return "director";
  if (lower.includes("vp") || lower.includes("vice")) return "vp";
  if (lower.includes("cto") || lower.includes("ceo") || lower.includes("chief") || lower.includes("c-suite")) return "c_suite";
  return "other";
}

function findEducationEntry(education: any[], universitySlug: string): any | null {
  if (!Array.isArray(education) || !education.length) return null;
  const slugParts = universitySlug.toLowerCase().split("-").filter(Boolean);
  for (const edu of education) {
    const schoolName = (edu.schoolName || edu.school || edu.institution || "").toLowerCase();
    // Match if most slug parts appear in the school name
    const matchCount = slugParts.filter(part => schoolName.includes(part)).length;
    if (matchCount >= Math.ceil(slugParts.length * 0.6)) return edu;
  }
  return education[0]; // Fallback to first education entry
}

function formatUniversityName(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function mapPersonSeniority(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower.includes("intern")) return "intern";
  if (lower.includes("entry") || lower.includes("junior")) return "entry";
  if (lower.includes("associate")) return "associate";
  if (lower.includes("senior") || lower.includes("mid") || lower.includes("lead")) return "mid_senior";
  if (lower.includes("director")) return "director";
  if (lower.includes("vp") || lower.includes("vice")) return "vp";
  if (lower.includes("chief") || lower.includes("cto") || lower.includes("ceo") || lower.includes("cfo")) return "c_suite";
  return "unknown";
}

function mapPersonFunction(raw: string | null | undefined): string {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  if (lower.includes("engineer") || lower.includes("develop") || lower.includes("tech")) return "engineering";
  if (lower.includes("sale")) return "sales";
  if (lower.includes("market")) return "marketing";
  if (lower.includes("hr") || lower.includes("human") || lower.includes("recruit") || lower.includes("talent")) return "hr";
  if (lower.includes("financ") || lower.includes("account")) return "finance";
  if (lower.includes("operat")) return "operations";
  if (lower.includes("product")) return "product";
  if (lower.includes("design")) return "design";
  if (lower.includes("data") || lower.includes("analyt")) return "data";
  if (lower.includes("legal")) return "legal";
  if (lower.includes("consult")) return "consulting";
  if (lower.includes("educ") || lower.includes("teach")) return "education";
  if (lower.includes("health") || lower.includes("medical")) return "healthcare";
  return "other";
}

function generatePeopleSearchStub(params: any, count: number): any[] {
  // Stub data generator for People Search
  // In production, this would be replaced by Apollo API call
  const titles = ["Software Engineer", "Product Manager", "Data Scientist", "Marketing Manager", "Sales Director"];
  const companies = ["Google", "Microsoft", "Amazon", "Meta", "Apple", "Flipkart", "Infosys", "TCS"];
  const cities = ["Mumbai", "Bangalore", "Delhi", "Hyderabad", "Pune", "Chennai"];
  const seniorities = ["junior", "mid", "senior", "lead", "director"];
  const departments = ["Engineering", "Sales", "Marketing", "Product", "HR", "Data"];
  const firstNames = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Ananya", "Karan", "Neha", "Arjun", "Divya"];
  const lastNames = ["Sharma", "Patel", "Gupta", "Singh", "Kumar", "Reddy", "Jain", "Verma", "Mehta", "Das"];

  const results: any[] = [];
  const usedCount = Math.min(count, 10); // Cap stub at 10
  for (let i = 0; i < usedCount; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    results.push({
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      linkedin_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-stub`,
      title: params.job_title || titles[i % titles.length],
      company_name: params.company || companies[i % companies.length],
      company_domain: null,
      city: params.location || cities[i % cities.length],
      country: "India",
      seniority: params.seniority || seniorities[i % seniorities.length],
      department: departments[i % departments.length],
      _stub: true,
    });
  }
  return results;
}

const TECH_SKILLS = ["python", "javascript", "typescript", "java", "react", "node.js", "nodejs", "angular", "vue", "sql", "postgresql", "mongodb", "aws", "azure", "gcp", "docker", "kubernetes", "git", "linux", "html", "css", "c++", "c#", "ruby", "go", "rust", "swift", "kotlin", "php", "r", "scala", "tensorflow", "pytorch", "machine learning", "deep learning", "ai", "data science", "data analysis", "tableau", "power bi", "excel", "figma", "sketch", "jira", "agile", "scrum", "rest api", "graphql", "microservices", "ci/cd", "devops", "jenkins", "terraform", "redis", "elasticsearch", "kafka", "spark", "hadoop", "snowflake", "dbt", "airflow"];

function extractSkillsKeyword(description: string): string[] {
  const lower = description.toLowerCase();
  return TECH_SKILLS.filter(skill => lower.includes(skill));
}

function categorizeSkill(skill: string): string {
  const programming = ["python", "javascript", "typescript", "java", "c++", "c#", "ruby", "go", "rust", "swift", "kotlin", "php", "r", "scala"];
  const frameworks = ["react", "node.js", "nodejs", "angular", "vue", "tensorflow", "pytorch", "spark"];
  const databases = ["sql", "postgresql", "mongodb", "redis", "elasticsearch", "snowflake"];
  const cloud = ["aws", "azure", "gcp", "docker", "kubernetes", "terraform"];
  const tools = ["git", "jira", "figma", "sketch", "tableau", "power bi", "excel", "jenkins", "dbt", "airflow"];

  const lower = skill.toLowerCase();
  if (programming.includes(lower)) return "programming";
  if (frameworks.includes(lower)) return "framework";
  if (databases.includes(lower)) return "database";
  if (cloud.includes(lower)) return "cloud";
  if (tools.includes(lower)) return "tool";
  return "other";
}

// ==================== SURVEY FUNCTIONS ====================

function generateSecureOtp(length: number): string {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

function verifySurveyJwt(req: VercelRequest): { respondent_id: string; email: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { respondent_id: string; email: string };
    return decoded;
  } catch {
    return null;
  }
}

const SURVEY_SECTIONS = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];

async function handleSurveyRoutes(path: string, req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // ---- POST /api/survey/auth/send-otp ----
  if (path === "/survey/auth/send-otp" && req.method === "POST") {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const otp = generateSecureOtp(6);
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    const { error } = await supabase.from("survey_respondents").upsert(
      { email: normalizedEmail, auth_otp: hashedOtp, auth_otp_expires: expires },
      { onConflict: "email" }
    );
    if (error) return res.status(500).json({ error: error.message });

    // Send OTP via Resend if configured, otherwise log to console
    if (RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
            to: [normalizedEmail],
            subject: "Your Nexus Survey Access Code",
            text: `Your one-time code is: ${otp}\n\nValid for 15 minutes.`,
          }),
        });
        const emailBody = await emailRes.json();
        if (!emailRes.ok) {
          console.error(`[SURVEY OTP] Resend API error (${emailRes.status}):`, JSON.stringify(emailBody));
          console.log(`[SURVEY OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
        } else {
          console.log(`[SURVEY OTP] Sent via Resend to ${normalizedEmail}, id: ${emailBody.id}`);
        }
      } catch (emailErr: any) {
        console.error("[SURVEY OTP] Failed to send email:", emailErr.message);
        console.log(`[SURVEY OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
      }
    } else {
      console.log(`[SURVEY OTP] No RESEND_API_KEY configured. Email: ${normalizedEmail}, OTP: ${otp}`);
    }

    return res.json({ message: "OTP sent to your email" });
  }

  // ---- POST /api/survey/auth/verify-otp ----
  if (path === "/survey/auth/verify-otp" && req.method === "POST") {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const { data: respondent, error } = await supabase
      .from("survey_respondents")
      .select("id, auth_otp, auth_otp_expires")
      .eq("email", normalizedEmail)
      .single();

    if (error || !respondent) {
      return res.status(404).json({ error: "Email not found. Please request a new OTP." });
    }
    if (!respondent.auth_otp || !respondent.auth_otp_expires) {
      return res.status(400).json({ error: "No OTP pending. Please request a new one." });
    }
    if (new Date(respondent.auth_otp_expires) < new Date()) {
      return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    }
    const isValid = await bcrypt.compare(otp, respondent.auth_otp);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Clear OTP and update login time
    await supabase.from("survey_respondents").update({
      auth_otp: null,
      auth_otp_expires: null,
      last_login_at: new Date().toISOString(),
    }).eq("id", respondent.id);

    const token = jwt.sign(
      { respondent_id: respondent.id, email: normalizedEmail },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, respondent_id: respondent.id });
  }

  // ---- POST /api/survey/auth/register ----
  // Called after Supabase Auth OTP verification succeeds on the frontend.
  // Creates/upserts a survey_respondents record and issues a survey JWT.
  if (path === "/survey/auth/register" && req.method === "POST") {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    // Upsert respondent (create if first time, update last_login if returning)
    const { data: respondent, error } = await supabase
      .from("survey_respondents")
      .upsert(
        { email: normalizedEmail, last_login_at: new Date().toISOString() },
        { onConflict: "email" }
      )
      .select("id")
      .single();

    if (error || !respondent) {
      return res.status(500).json({ error: error?.message || "Failed to register respondent" });
    }

    const token = jwt.sign(
      { respondent_id: respondent.id, email: normalizedEmail },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, respondent_id: respondent.id });
  }

  // ---- GET /api/survey/skill-list (public) ----
  if (path === "/survey/skill-list" && req.method === "GET") {
    const { data: skills, error } = await supabase
      .from("taxonomy_skills")
      .select("id, name, category")
      .order("category")
      .order("name");

    if (error) return res.status(500).json({ error: error.message });

    // Group by category
    const grouped: Record<string, { id: string; name: string }[]> = {};
    for (const skill of skills || []) {
      const cat = skill.category || "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ id: skill.id, name: skill.name });
    }

    return res.json(grouped);
  }

  // ---- All routes below require survey JWT ----
  const surveyAuth = verifySurveyJwt(req);
  if (!surveyAuth) {
    return res.status(401).json({ error: "Survey authentication required" });
  }

  // ---- GET /api/survey/progress ----
  if (path === "/survey/progress" && req.method === "GET") {
    const respondentId = surveyAuth.respondent_id;

    // Check profile completion
    const { data: respondent } = await supabase
      .from("survey_respondents")
      .select("full_name, company_name, designation, industry, company_size, years_of_experience, location_city, location_country")
      .eq("id", respondentId)
      .single();

    const profileFields = respondent
      ? [respondent.full_name, respondent.company_name, respondent.designation, respondent.industry, respondent.company_size].filter(Boolean)
      : [];
    const profileStatus = profileFields.length >= 5 ? "complete" : profileFields.length > 0 ? "in_progress" : "pending";

    // Check section responses
    const { data: responses } = await supabase
      .from("survey_responses")
      .select("section_key, question_key")
      .eq("respondent_id", respondentId);

    const sectionCounts: Record<string, number> = {};
    for (const r of responses || []) {
      sectionCounts[r.section_key] = (sectionCounts[r.section_key] || 0) + 1;
    }

    // Check skill ratings
    const { count: skillCount } = await supabase
      .from("survey_skill_ratings")
      .select("id", { count: "exact", head: true })
      .eq("respondent_id", respondentId);

    // Required question counts per section
    const requiredCounts: Record<string, number> = {
      hiring_overview: 5,
      gap_analysis: 4,
      emerging_trends: 3,
    };

    const getStatus = (key: string) => {
      if (key === "profile") return profileStatus;
      if (key === "skill_ratings") {
        if ((skillCount || 0) >= 10) return "complete";
        if ((skillCount || 0) > 0) return "in_progress";
        return "pending";
      }
      const count = sectionCounts[key] || 0;
      const required = requiredCounts[key] || 1;
      if (count >= required) return "complete";
      if (count > 0) return "in_progress";
      return "pending";
    };

    const progress: Record<string, string> = {};
    let completedSections = 0;
    for (const section of SURVEY_SECTIONS) {
      progress[section] = getStatus(section);
      if (progress[section] === "complete") completedSections++;
    }

    return res.json({
      ...progress,
      total_pct: Math.round((completedSections / SURVEY_SECTIONS.length) * 100),
    });
  }

  // ---- POST /api/survey/responses ----
  if (path === "/survey/responses" && req.method === "POST") {
    const respondentId = surveyAuth.respondent_id;
    const { section_key, responses, profile, skill_ratings } = req.body || {};

    // Handle profile update (Section A)
    if (section_key === "profile" && profile) {
      const { error } = await supabase
        .from("survey_respondents")
        .update({
          full_name: profile.full_name || null,
          company_name: profile.company_name || null,
          designation: profile.designation || null,
          industry: profile.industry || null,
          company_size: profile.company_size || null,
          years_of_experience: profile.years_of_experience != null ? parseInt(profile.years_of_experience) : null,
          location_city: profile.location_city || null,
          location_country: profile.location_country || null,
        })
        .eq("id", respondentId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ saved: true, section_key: "profile" });
    }

    // Handle skill ratings (Section C)
    if (section_key === "skill_ratings" && skill_ratings) {
      for (const rating of skill_ratings) {
        const { error } = await supabase.from("survey_skill_ratings").upsert(
          {
            respondent_id: respondentId,
            skill_name: rating.skill_name,
            taxonomy_skill_id: rating.taxonomy_skill_id || null,
            importance_rating: rating.importance_rating || null,
            demonstration_rating: rating.demonstration_rating || null,
            is_custom_skill: rating.is_custom_skill || false,
          },
          { onConflict: "respondent_id,skill_name" }
        );
        if (error) {
          console.error("Skill rating upsert error:", error);
        }
      }
      return res.json({ saved: true, section_key: "skill_ratings", count: skill_ratings.length });
    }

    // Handle generic section responses (Sections B, D, E)
    if (!section_key || !responses || !Array.isArray(responses)) {
      return res.status(400).json({ error: "section_key and responses[] are required" });
    }

    for (const item of responses) {
      const { error } = await supabase.from("survey_responses").upsert(
        {
          respondent_id: respondentId,
          section_key,
          question_key: item.question_key,
          response_type: item.response_type,
          response_value: item.response_value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "respondent_id,section_key,question_key" }
      );
      if (error) {
        console.error("Response upsert error:", error);
      }
    }

    return res.json({ saved: true, section_key, count: responses.length });
  }

  // ---- GET /api/survey/my-responses ----
  if (path === "/survey/my-responses" && req.method === "GET") {
    const respondentId = surveyAuth.respondent_id;

    const [{ data: respondent }, { data: responses }, { data: skillRatings }] = await Promise.all([
      supabase.from("survey_respondents")
        .select("full_name, company_name, designation, industry, company_size, years_of_experience, location_city, location_country")
        .eq("id", respondentId).single(),
      supabase.from("survey_responses").select("*").eq("respondent_id", respondentId),
      supabase.from("survey_skill_ratings").select("*").eq("respondent_id", respondentId),
    ]);

    return res.json({ profile: respondent, responses: responses || [], skill_ratings: skillRatings || [] });
  }

  // ---- GET /api/survey/results (admin-only via main app auth) ----
  if (path === "/survey/results" && req.method === "GET") {
    // For admin results, also check main app auth
    const mainAuth = await verifyAuth(req);
    if (!mainAuth.authenticated) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [{ data: respondents, count }, { data: allResponses }, { data: allRatings }] = await Promise.all([
      supabase.from("survey_respondents").select("id, email, full_name, company_name, industry, created_at", { count: "exact" }),
      supabase.from("survey_responses").select("*"),
      supabase.from("survey_skill_ratings").select("*"),
    ]);

    // Compute skill averages
    const skillAverages: Record<string, { importance_avg: number; demonstration_avg: number; count: number }> = {};
    for (const r of allRatings || []) {
      if (!skillAverages[r.skill_name]) {
        skillAverages[r.skill_name] = { importance_avg: 0, demonstration_avg: 0, count: 0 };
      }
      const sa = skillAverages[r.skill_name];
      sa.importance_avg += r.importance_rating || 0;
      sa.demonstration_avg += r.demonstration_rating || 0;
      sa.count++;
    }
    for (const name of Object.keys(skillAverages)) {
      const sa = skillAverages[name];
      sa.importance_avg = Math.round((sa.importance_avg / sa.count) * 10) / 10;
      sa.demonstration_avg = Math.round((sa.demonstration_avg / sa.count) * 10) / 10;
    }

    return res.json({
      total_respondents: count || 0,
      respondents: respondents || [],
      responses: allResponses || [],
      skill_averages: skillAverages,
    });
  }

  return res.status(404).json({ error: "Survey endpoint not found", path });
}
