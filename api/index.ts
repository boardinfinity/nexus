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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
          const syncTypes = ["google_jobs", "company_enrichment", "jd_enrichment", "jd_fetch", "people_enrichment"];
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
        .select("id, external_id, title, company_name, location_raw, location_city, location_country, source, seniority_level, employment_type, salary_min, salary_max, salary_currency, posted_at, enrichment_status, job_status, status_checked_at, source_url, created_at", { count: "exact" });

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

    // Auto-enrich companies from job data
    if (path === "/companies/auto-enrich" && req.method === "POST") {
      const { data: companies, error: compErr } = await supabase
        .from("companies")
        .select("id, name");
      if (compErr) return res.status(500).json({ error: compErr.message });

      let enriched = 0;
      for (const company of companies || []) {
        // Get jobs for this company
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, location_city, location_state, location_country, employment_type")
          .eq("company_id", company.id);

        if (!jobs || jobs.length === 0) continue;

        const jobCount = jobs.length;

        // Most common location
        const locationCounts: Record<string, number> = {};
        const countryCounts: Record<string, number> = {};
        for (const j of jobs) {
          if (j.location_city) locationCounts[j.location_city] = (locationCounts[j.location_city] || 0) + 1;
          if (j.location_country) countryCounts[j.location_country] = (countryCounts[j.location_country] || 0) + 1;
        }
        const topCity = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        const topState = jobs.find(j => j.location_city === topCity)?.location_state || null;

        // Top skills from job_skills
        const jobIds = jobs.map(j => j.id);
        const { data: skills } = await supabase
          .from("job_skills")
          .select("skill_name")
          .in("job_id", jobIds.slice(0, 100));

        const skillCounts: Record<string, number> = {};
        for (const s of skills || []) {
          skillCounts[s.skill_name] = (skillCounts[s.skill_name] || 0) + 1;
        }
        const topSkills = Object.entries(skillCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name]) => name);

        // Update company
        const updates: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (topCity) updates.headquarters_city = topCity;
        if (topState) updates.headquarters_state = topState;
        if (topCountry) updates.headquarters_country = topCountry;
        if (topSkills.length > 0) updates.specialities = topSkills;

        // Calculate enrichment score based on filled fields
        const { data: current } = await supabase.from("companies").select("*").eq("id", company.id).single();
        if (current) {
          const fields = ["industry", "employee_count", "headquarters_city", "headquarters_country", "website", "linkedin_url", "description", "founded_year"];
          const merged = { ...current, ...updates };
          const filledCount = fields.filter(f => merged[f] != null && merged[f] !== "").length;
          updates.enrichment_score = Math.round((filledCount / fields.length) * 100);
          if (updates.enrichment_score > 0 && (!current.enrichment_status || current.enrichment_status === "pending")) {
            updates.enrichment_status = "partial";
          }
        }

        await supabase.from("companies").update(updates).eq("id", company.id);
        enriched++;
      }

      return res.json({ success: true, enriched, total: (companies || []).length });
    }

    // Manual edit company
    if (path.match(/^\/companies\/[^/]+$/) && req.method === "PATCH") {
      const id = path.split("/").pop();
      const allowedFields = [
        "industry", "sub_industry", "company_type", "size_range", "employee_count",
        "headquarters_city", "headquarters_state", "headquarters_country",
        "website", "linkedin_url", "description", "founded_year",
      ];
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const field of allowedFields) {
        if (req.body?.[field] !== undefined) updates[field] = req.body[field];
      }

      // Recalculate enrichment score
      const { data: current } = await supabase.from("companies").select("*").eq("id", id).single();
      if (current) {
        const fields = ["industry", "employee_count", "headquarters_city", "headquarters_country", "website", "linkedin_url", "description", "founded_year"];
        const merged = { ...current, ...updates };
        const filledCount = fields.filter(f => merged[f] != null && merged[f] !== "").length;
        updates.enrichment_score = Math.round((filledCount / fields.length) * 100);
      }

      const { data, error } = await supabase.from("companies").update(updates).eq("id", id).select().single();
      if (error) return res.status(500).json({ error: error.message });
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
      if (pipeline_type === "company_enrichment" || pipeline_type === "jd_enrichment" || pipeline_type === "jd_fetch" || pipeline_type === "people_enrichment") {
        await executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
      }

      // For Google Jobs, execute synchronously (fast RapidAPI call)
      if (pipeline_type === "google_jobs") {
        await executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
      }

      // Job status check pipeline executes synchronously
      if (pipeline_type === "job_status_check") {
        await executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
      }

      // Deduplication and co-occurrence pipelines execute synchronously
      if (pipeline_type === "deduplication" || pipeline_type === "cooccurrence") {
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

      // Enrich each skill with job_count
      if (data && data.length > 0) {
        const skillIds = data.map((s: any) => s.id);
        const { data: jobSkills } = await supabase
          .from("job_skills")
          .select("taxonomy_skill_id")
          .in("taxonomy_skill_id", skillIds);

        const countMap: Record<string, number> = {};
        for (const js of jobSkills || []) {
          if (js.taxonomy_skill_id) {
            countMap[js.taxonomy_skill_id] = (countMap[js.taxonomy_skill_id] || 0) + 1;
          }
        }
        for (const skill of data) {
          (skill as any).job_count = countMap[(skill as any).id] || 0;
        }
      }

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

    // Edit taxonomy skill name
    if (path.match(/^\/taxonomy\/[^/]+$/) && req.method === "PATCH") {
      const id = path.split("/")[2];
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ error: "name is required" });

      const { data, error } = await supabase
        .from("taxonomy_skills")
        .update({ name })
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Skill detail: linked jobs, courses, reports
    if (path.match(/^\/taxonomy\/[^/]+\/linked$/) && req.method === "GET") {
      const id = path.split("/")[2];

      // Get the skill first
      const { data: skill } = await supabase.from("taxonomy_skills").select("id, name").eq("id", id).single();
      if (!skill) return res.status(404).json({ error: "Skill not found" });

      // Linked jobs (via job_skills by taxonomy_skill_id or skill_name)
      const { data: jobSkills } = await supabase
        .from("job_skills")
        .select("job_id, skill_name")
        .or(`taxonomy_skill_id.eq.${id},skill_name.ilike.%${skill.name}%`)
        .limit(50);

      const jobIds = [...new Set((jobSkills || []).map(js => js.job_id))];
      let linkedJobs: any[] = [];
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, title, company_name, source")
          .in("id", jobIds.slice(0, 50));
        linkedJobs = jobs || [];
      }

      // Linked courses (via course_skills)
      const { data: courseSkills } = await supabase
        .from("course_skills")
        .select("course_id")
        .eq("taxonomy_skill_id", id)
        .limit(50);

      let linkedCourses: any[] = [];
      const courseIds = [...new Set((courseSkills || []).map(cs => cs.course_id))];
      if (courseIds.length > 0) {
        const { data: courses } = await supabase
          .from("college_courses")
          .select("id, course_code, title, college_id")
          .in("id", courseIds.slice(0, 50));
        linkedCourses = courses || [];
      }

      // Linked reports
      const { data: reports } = await supabase
        .from("reports")
        .select("id, title, report_type, created_at")
        .ilike("config::text", `%${skill.name}%`)
        .limit(20);

      return res.json({
        jobs: linkedJobs,
        courses: linkedCourses,
        reports: reports || [],
      });
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
    const VALID_PIPELINE_TYPES = ["linkedin_jobs", "google_jobs", "alumni", "company_enrichment", "jd_enrichment", "jd_fetch", "people_enrichment", "deduplication", "cooccurrence"];
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
      const { data, error } = await supabase.rpc('get_jobs_by_source', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/jobs-by-region" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_by_region', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/jobs-by-role" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_by_role', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/top-skills" && req.method === "GET") {
      const { limit: limitStr, source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const limit = parseInt(limitStr || "20");
      const { data, error } = await supabase.rpc('get_top_skills', {
        p_limit: limit,
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      // Map 'skill' key to 'skill_name' to match frontend expectations
      const result = (data || []).map((row: any) => ({ skill_name: row.skill, count: row.count }));
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
      const { data, error } = await supabase.rpc('get_enrichment_funnel', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/timeline" && req.method === "GET") {
      const { granularity = "day", days = "30", source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_timeline', {
        p_days: parseInt(days),
        p_granularity: granularity,
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
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

    // ==================== DATA QUALITY & DEDUP ====================

    if (path === "/data-quality/stats" && req.method === "GET") {
      // Quality score distribution and duplicate stats
      const { data: jobs, error } = await supabase
        .from("jobs")
        .select("quality_score, is_duplicate");
      if (error) return res.status(500).json({ error: error.message });

      const allJobs = jobs || [];
      const totalJobs = allJobs.length;
      const duplicates = allJobs.filter((j: any) => j.is_duplicate).length;
      const uniqueJobs = totalJobs - duplicates;
      const scores = allJobs.map((j: any) => j.quality_score || 0);
      const avgScore = totalJobs > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / totalJobs) : 0;

      // Distribution buckets
      const distribution = [
        { range: "0-20", count: 0 },
        { range: "21-40", count: 0 },
        { range: "41-60", count: 0 },
        { range: "61-80", count: 0 },
        { range: "81-100", count: 0 },
      ];
      for (const s of scores) {
        if (s <= 20) distribution[0].count++;
        else if (s <= 40) distribution[1].count++;
        else if (s <= 60) distribution[2].count++;
        else if (s <= 80) distribution[3].count++;
        else distribution[4].count++;
      }

      return res.json({
        total_jobs: totalJobs,
        duplicates,
        unique_jobs: uniqueJobs,
        avg_quality_score: avgScore,
        distribution,
      });
    }

    if (path === "/data-quality/duplicates" && req.method === "GET") {
      const { page = "1", limit = "20" } = req.query as Record<string, string>;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      // Get duplicate groups via RPC
      const { data: groups, error } = await supabase.rpc("find_duplicate_groups");
      if (error) return res.status(500).json({ error: error.message });

      const allGroups = groups || [];
      const total = allGroups.length;
      const paged = allGroups.slice(offset, offset + limitNum);

      // Fetch job details for the paged groups
      const allJobIds: string[] = [];
      for (const g of paged) {
        for (const id of g.job_ids) allJobIds.push(id);
      }

      let jobDetails: Record<string, any> = {};
      if (allJobIds.length > 0) {
        const { data: jobsData } = await supabase
          .from("jobs")
          .select("id, title, company_name, location_city, source, quality_score, is_duplicate, duplicate_of")
          .in("id", allJobIds);
        for (const j of jobsData || []) {
          jobDetails[j.id] = j;
        }
      }

      const enrichedGroups = paged.map((g: any) => ({
        dedup_key: g.dedup_key,
        jobs: g.job_ids.map((id: string) => jobDetails[id] || { id }),
      }));

      return res.json({ data: enrichedGroups, total, page: pageNum, limit: limitNum });
    }

    // ==================== EXPORT ENDPOINTS ====================

    if (path === "/export/jobs" && req.method === "GET") {
      const { source, country, enrichment_status, has_description, limit: limitStr } = req.query as Record<string, string>;
      const exportLimit = parseInt(limitStr || "10000");

      let query = supabase
        .from("jobs")
        .select("id, title, company_name, location_city, location_country, source, posted_at, seniority_level, employment_type, work_mode, description, enrichment_status, quality_score, salary_min, salary_max, industry_domain")
        .order("created_at", { ascending: false })
        .limit(exportLimit);

      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (enrichment_status) query = query.eq("enrichment_status", enrichment_status);
      if (has_description === "true") query = query.not("description", "is", null);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const rows = data || [];
      const headers = ["id", "title", "company_name", "location_city", "location_country", "source", "posted_at", "seniority_level", "employment_type", "work_mode", "description", "enrichment_status", "quality_score", "salary_min", "salary_max", "industry_domain"];

      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        const values = headers.map((h) => {
          let val = (row as any)[h];
          if (h === "description" && val) val = val.substring(0, 1000);
          return escapeCsv(val);
        });
        csv += values.join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="nexus_jobs_export_${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    }

    if (path === "/export/skills" && req.method === "GET") {
      const { min_frequency = "2" } = req.query as Record<string, string>;
      const minFreq = parseInt(min_frequency);

      // Get total jobs count
      const { count: totalJobs } = await supabase.from("jobs").select("*", { count: "exact", head: true });

      // Get all skills with counts
      const { data: skills, error } = await supabase
        .from("job_skills")
        .select("skill_name, taxonomy_skill_id, confidence_score");
      if (error) return res.status(500).json({ error: error.message });

      const skillMap: Record<string, { taxonomy_skill_id: string | null; count: number; totalConfidence: number }> = {};
      for (const s of skills || []) {
        const name = s.skill_name || "Unknown";
        if (!skillMap[name]) skillMap[name] = { taxonomy_skill_id: s.taxonomy_skill_id, count: 0, totalConfidence: 0 };
        skillMap[name].count++;
        skillMap[name].totalConfidence += s.confidence_score || 0;
      }

      const total = totalJobs || 1;
      const rows = Object.entries(skillMap)
        .filter(([_, v]) => v.count >= minFreq)
        .map(([name, v]) => ({
          skill_name: name,
          taxonomy_skill_id: v.taxonomy_skill_id || "",
          frequency: v.count,
          pct_of_total_jobs: Math.round((v.count / total) * 1000) / 10,
          avg_confidence: Math.round((v.totalConfidence / v.count) * 100) / 100,
        }))
        .sort((a, b) => b.frequency - a.frequency);

      const headers = ["skill_name", "taxonomy_skill_id", "frequency", "pct_of_total_jobs", "avg_confidence"];
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        csv += headers.map((h) => escapeCsv((row as any)[h])).join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="nexus_skills_export_${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    }

    // ==================== SKILL CO-OCCURRENCE ====================

    if (path === "/analytics/skill-cooccurrence" && req.method === "GET") {
      const { skill_name, limit: limitStr = "20" } = req.query as Record<string, string>;
      const limit = parseInt(limitStr);

      if (skill_name) {
        // Top co-occurring skills for a given skill
        const { data, error } = await supabase
          .from("skill_cooccurrence")
          .select("*")
          .or(`skill_a_name.eq.${skill_name},skill_b_name.eq.${skill_name}`)
          .order("cooccurrence_count", { ascending: false })
          .limit(limit);
        if (error) return res.status(500).json({ error: error.message });

        // Normalize: return the "other" skill name
        const result = (data || []).map((row: any) => ({
          skill_name: row.skill_a_name === skill_name ? row.skill_b_name : row.skill_a_name,
          cooccurrence_count: row.cooccurrence_count,
          pmi_score: row.pmi_score ? Math.round(row.pmi_score * 100) / 100 : null,
          jobs_with_skill: row.skill_a_name === skill_name ? row.jobs_with_b : row.jobs_with_a,
        }));

        return res.json(result);
      } else {
        // Top overall pairs
        const { data, error } = await supabase
          .from("skill_cooccurrence")
          .select("*")
          .order("cooccurrence_count", { ascending: false })
          .limit(limit);
        if (error) return res.status(500).json({ error: error.message });

        return res.json((data || []).map((row: any) => ({
          skill_a: row.skill_a_name,
          skill_b: row.skill_b_name,
          cooccurrence_count: row.cooccurrence_count,
          pmi_score: row.pmi_score ? Math.round(row.pmi_score * 100) / 100 : null,
        })));
      }
    }

    // ==================== SURVEY ADMIN ENDPOINTS ====================
    const ADMIN_SURVEY_SECTIONS = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];

    function determineSurveyStatus(respondent: any, responseSectionKeys: string[]): string {
      const uniqueSections = [...new Set(responseSectionKeys)];
      if (uniqueSections.length >= 5) return "completed";
      if (uniqueSections.length > 0) return "started";
      if (respondent.last_login_at) return "registered";
      return "invited";
    }

    // GET /api/admin/survey/dashboard
    if (path === "/admin/survey/dashboard" && req.method === "GET") {
      const [
        { data: respondents },
        { data: allResponses },
        { data: allRatings },
      ] = await Promise.all([
        supabase.from("survey_respondents").select("*"),
        supabase.from("survey_responses").select("respondent_id, section_key"),
        supabase.from("survey_skill_ratings").select("respondent_id, skill_name, importance_rating, demonstration_rating"),
      ]);

      const respList = respondents || [];
      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Build per-respondent section sets
      const respondentSections: Record<string, Set<string>> = {};
      for (const r of responseList) {
        if (!respondentSections[r.respondent_id]) respondentSections[r.respondent_id] = new Set();
        respondentSections[r.respondent_id].add(r.section_key);
      }
      // Profile section: check if respondent has full_name set
      for (const resp of respList) {
        if (resp.full_name) {
          if (!respondentSections[resp.id]) respondentSections[resp.id] = new Set();
          respondentSections[resp.id].add("profile");
        }
      }

      let totalInvited = 0, totalRegistered = 0, totalStarted = 0, totalCompleted = 0;
      for (const resp of respList) {
        const sections = respondentSections[resp.id] ? [...respondentSections[resp.id]] : [];
        const status = determineSurveyStatus(resp, sections);
        totalInvited++;
        if (status === "registered" || status === "started" || status === "completed") totalRegistered++;
        if (status === "started" || status === "completed") totalStarted++;
        if (status === "completed") totalCompleted++;
      }

      // Sections completion counts
      const sectionsCompletion: Record<string, number> = {};
      for (const section of ADMIN_SURVEY_SECTIONS) {
        sectionsCompletion[section] = 0;
      }
      for (const respId of Object.keys(respondentSections)) {
        for (const section of respondentSections[respId]) {
          if (sectionsCompletion[section] !== undefined) sectionsCompletion[section]++;
        }
      }

      // Responses by industry and company size
      const industryCounts: Record<string, number> = {};
      const companySizeCounts: Record<string, number> = {};
      for (const resp of respList) {
        if (resp.industry) industryCounts[resp.industry] = (industryCounts[resp.industry] || 0) + 1;
        if (resp.company_size) companySizeCounts[resp.company_size] = (companySizeCounts[resp.company_size] || 0) + 1;
      }

      // Skill ratings summary
      const skillAggs: Record<string, { impSum: number; demSum: number; count: number }> = {};
      for (const r of ratingList) {
        if (!skillAggs[r.skill_name]) skillAggs[r.skill_name] = { impSum: 0, demSum: 0, count: 0 };
        skillAggs[r.skill_name].impSum += r.importance_rating || 0;
        skillAggs[r.skill_name].demSum += r.demonstration_rating || 0;
        skillAggs[r.skill_name].count++;
      }
      const skillEntries = Object.entries(skillAggs).map(([skill, agg]) => ({
        skill,
        importance: Math.round((agg.impSum / agg.count) * 10) / 10,
        demonstration: Math.round((agg.demSum / agg.count) * 10) / 10,
        gap: Math.round(((agg.impSum - agg.demSum) / agg.count) * 10) / 10,
      }));
      const topImportance = [...skillEntries].sort((a, b) => b.importance - a.importance).slice(0, 10);
      const topGap = [...skillEntries].sort((a, b) => b.gap - a.gap).slice(0, 10);

      return res.json({
        total_invited: totalInvited,
        total_registered: totalRegistered,
        total_started: totalStarted,
        total_completed: totalCompleted,
        completion_rate: totalInvited > 0 ? Math.round((totalCompleted / totalInvited) * 1000) / 10 : 0,
        sections_completion: sectionsCompletion,
        responses_by_industry: Object.entries(industryCounts).map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
        responses_by_company_size: Object.entries(companySizeCounts).map(([company_size, count]) => ({ company_size, count })).sort((a, b) => b.count - a.count),
        skill_ratings_summary: {
          top_importance: topImportance.map(s => ({ skill: s.skill, avg: s.importance })),
          top_gap: topGap.map(s => ({ skill: s.skill, gap: s.gap })),
          total_skills_rated: ratingList.length,
        },
      });
    }

    // GET /api/admin/survey/respondents
    if (path === "/admin/survey/respondents" && req.method === "GET") {
      const { page = "1", limit = "20", status: filterStatus, search } = req.query as Record<string, string>;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [{ data: respondents }, { data: allResponses }, { data: allRatings }] = await Promise.all([
        supabase.from("survey_respondents").select("*").order("created_at", { ascending: false }),
        supabase.from("survey_responses").select("respondent_id, section_key"),
        supabase.from("survey_skill_ratings").select("respondent_id"),
      ]);

      const respList = respondents || [];
      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Build per-respondent data
      const respondentSections: Record<string, Set<string>> = {};
      const respondentRatingCounts: Record<string, number> = {};
      for (const r of responseList) {
        if (!respondentSections[r.respondent_id]) respondentSections[r.respondent_id] = new Set();
        respondentSections[r.respondent_id].add(r.section_key);
      }
      for (const r of ratingList) {
        respondentRatingCounts[r.respondent_id] = (respondentRatingCounts[r.respondent_id] || 0) + 1;
      }
      // Profile section check
      for (const resp of respList) {
        if (resp.full_name) {
          if (!respondentSections[resp.id]) respondentSections[resp.id] = new Set();
          respondentSections[resp.id].add("profile");
        }
      }

      let enriched = respList.map((resp: any) => {
        const sections = respondentSections[resp.id] ? [...respondentSections[resp.id]] : [];
        return {
          id: resp.id,
          email: resp.email,
          full_name: resp.full_name,
          company_name: resp.company_name,
          designation: resp.designation,
          industry: resp.industry,
          status: determineSurveyStatus(resp, sections),
          sections_completed: sections,
          skills_rated: respondentRatingCounts[resp.id] || 0,
          created_at: resp.created_at,
          last_login_at: resp.last_login_at,
        };
      });

      // Apply search filter
      if (search) {
        const s = search.toLowerCase();
        enriched = enriched.filter((r: any) =>
          (r.email && r.email.toLowerCase().includes(s)) ||
          (r.full_name && r.full_name.toLowerCase().includes(s)) ||
          (r.company_name && r.company_name.toLowerCase().includes(s))
        );
      }

      // Apply status filter
      if (filterStatus && filterStatus !== "all") {
        enriched = enriched.filter((r: any) => r.status === filterStatus);
      }

      const total = enriched.length;
      const offset = (pageNum - 1) * limitNum;
      const paginated = enriched.slice(offset, offset + limitNum);

      return res.json({ respondents: paginated, total, page: pageNum });
    }

    // GET /api/admin/survey/respondent/:id
    if (path.match(/^\/admin\/survey\/respondent\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/").pop()!;

      const [{ data: respondent, error: rErr }, { data: responses }, { data: ratings }] = await Promise.all([
        supabase.from("survey_respondents").select("*").eq("id", id).single(),
        supabase.from("survey_responses").select("*").eq("respondent_id", id).order("section_key"),
        supabase.from("survey_skill_ratings").select("*").eq("respondent_id", id).order("skill_name"),
      ]);

      if (rErr || !respondent) return res.status(404).json({ error: "Respondent not found" });

      return res.json({
        respondent,
        responses: responses || [],
        skill_ratings: ratings || [],
      });
    }

    // POST /api/admin/survey/invite
    if (path === "/admin/survey/invite" && req.method === "POST") {
      const { emails } = req.body || {};
      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "emails array is required" });
      }

      const results: Array<{ email: string; status: string; error?: string }> = [];

      for (const rawEmail of emails) {
        const email = (rawEmail as string).toLowerCase().trim();
        if (!email || !email.includes("@")) {
          results.push({ email: rawEmail, status: "failed", error: "Invalid email" });
          continue;
        }

        try {
          // Upsert respondent record
          const { error: upsertErr } = await supabase
            .from("survey_respondents")
            .upsert({ email }, { onConflict: "email" });

          if (upsertErr) {
            results.push({ email, status: "failed", error: upsertErr.message });
            continue;
          }

          // Try sending invite via Supabase Auth magic link
          let emailSent = false;
          try {
            const { error: linkErr } = await supabase.auth.admin.generateLink({
              type: "magiclink",
              email,
            });
            if (!linkErr) emailSent = true;
          } catch {
            // generateLink not available or failed
          }

          // Fallback: try signInWithOtp via service role
          if (!emailSent && RESEND_API_KEY) {
            try {
              const otp = generateSecureOtp(6);
              const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
              const hashedOtp = await bcrypt.hash(otp, 10);
              await supabase.from("survey_respondents").update({
                auth_otp: hashedOtp,
                auth_otp_expires: expires,
              }).eq("email", email);

              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${RESEND_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
                  to: [email],
                  subject: "You're invited to the Nexus MBA Skills Survey",
                  text: `You've been invited to participate in the Board Infinity MBA Skills Survey.\n\nYour one-time access code is: ${otp}\n\nAccess the survey at: ${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/survey\n\nThis code is valid for 15 minutes.`,
                }),
              });
              emailSent = true;
            } catch {
              // email send failed
            }
          }

          results.push({ email, status: emailSent ? "invited" : "added" });
        } catch (err: any) {
          results.push({ email, status: "failed", error: err.message });
        }
      }

      return res.json({
        results,
        total: results.length,
        successful: results.filter(r => r.status !== "failed").length,
        failed: results.filter(r => r.status === "failed").length,
      });
    }

    // POST /api/admin/survey/remind
    if (path === "/admin/survey/remind" && req.method === "POST") {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: "email is required" });

      const normalizedEmail = (email as string).toLowerCase().trim();

      // Generate new OTP and send
      let emailSent = false;
      try {
        const { error: linkErr } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: normalizedEmail,
        });
        if (!linkErr) emailSent = true;
      } catch {
        // fallback
      }

      if (!emailSent && RESEND_API_KEY) {
        try {
          const otp = generateSecureOtp(6);
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          const hashedOtp = await bcrypt.hash(otp, 10);
          await supabase.from("survey_respondents").update({
            auth_otp: hashedOtp,
            auth_otp_expires: expires,
          }).eq("email", normalizedEmail);

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
              to: [normalizedEmail],
              subject: "Reminder: Complete the Nexus MBA Skills Survey",
              text: `This is a reminder to complete the Board Infinity MBA Skills Survey.\n\nYour new one-time access code is: ${otp}\n\nAccess the survey at: ${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/survey\n\nThis code is valid for 15 minutes.`,
            }),
          });
          emailSent = true;
        } catch {
          // failed
        }
      }

      return res.json({ success: true, email_sent: emailSent });
    }

    // GET /api/admin/survey/analytics
    if (path === "/admin/survey/analytics" && req.method === "GET") {
      const [{ data: allResponses }, { data: allRatings }, { data: respondents }] = await Promise.all([
        supabase.from("survey_responses").select("*"),
        supabase.from("survey_skill_ratings").select("*"),
        supabase.from("survey_respondents").select("*"),
      ]);

      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Skill importance vs demonstration
      const skillAggs: Record<string, { impSum: number; demSum: number; count: number }> = {};
      for (const r of ratingList) {
        if (!skillAggs[r.skill_name]) skillAggs[r.skill_name] = { impSum: 0, demSum: 0, count: 0 };
        skillAggs[r.skill_name].impSum += r.importance_rating || 0;
        skillAggs[r.skill_name].demSum += r.demonstration_rating || 0;
        skillAggs[r.skill_name].count++;
      }
      const skillComparison = Object.entries(skillAggs).map(([skill, agg]) => ({
        skill,
        importance: Math.round((agg.impSum / agg.count) * 10) / 10,
        demonstration: Math.round((agg.demSum / agg.count) * 10) / 10,
        gap: Math.round(((agg.impSum - agg.demSum) / agg.count) * 10) / 10,
        respondent_count: agg.count,
      })).sort((a, b) => b.gap - a.gap);

      // Hiring patterns from survey responses
      const hiringResponses = responseList.filter((r: any) => r.section_key === "hiring_overview");
      const roleCounts: Record<string, number> = {};
      const rejectionCounts: Record<string, number[]> = {};
      for (const r of hiringResponses) {
        if (r.question_key === "B1" && r.response_value) {
          const roles = Array.isArray(r.response_value) ? r.response_value : (r.response_value as any)?.selected || [];
          for (const role of roles) {
            if (typeof role === "string") roleCounts[role] = (roleCounts[role] || 0) + 1;
          }
        }
        if (r.question_key === "B5" && r.response_value) {
          const rankings = Array.isArray(r.response_value) ? r.response_value : (r.response_value as any)?.rankings || [];
          for (const item of rankings) {
            if (item && typeof item === "object" && item.reason && item.rank) {
              if (!rejectionCounts[item.reason]) rejectionCounts[item.reason] = [];
              rejectionCounts[item.reason].push(item.rank);
            }
          }
        }
      }

      // Gap analysis responses
      const gapResponses = responseList.filter((r: any) => r.section_key === "gap_analysis");
      // Trend responses
      const trendResponses = responseList.filter((r: any) => r.section_key === "emerging_trends");

      return res.json({
        skill_importance_vs_demonstration: skillComparison,
        biggest_gaps: skillComparison.slice(0, 10),
        most_adequate: [...skillComparison].sort((a, b) => a.gap - b.gap).slice(0, 10),
        hiring_patterns: {
          top_roles_hired: Object.entries(roleCounts).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count).slice(0, 15),
          top_rejection_reasons: Object.entries(rejectionCounts).map(([reason, ranks]) => ({
            reason,
            avg_rank: Math.round((ranks.reduce((s, r) => s + r, 0) / ranks.length) * 10) / 10,
            count: ranks.length,
          })).sort((a, b) => a.avg_rank - b.avg_rank),
        },
        gap_analysis_responses: gapResponses,
        trend_responses: trendResponses,
        total_respondents: (respondents || []).length,
        total_ratings: ratingList.length,
        total_responses: responseList.length,
      });
    }

    // ==================== REPORTS ROUTES ====================

    // POST /api/reports — create report record
    if (path === "/reports" && req.method === "POST") {
      const { title, source_org, report_year, report_type, region, file_url, file_type, file_size_bytes } = req.body || {};
      if (!title || !file_url) {
        return res.status(400).json({ error: "title and file_url are required" });
      }
      const { data, error } = await supabase
        .from("secondary_reports")
        .insert({
          title,
          source_org: source_org || null,
          report_year: report_year || null,
          report_type: report_type || null,
          region: region || null,
          file_url,
          file_type: file_type || null,
          file_size_bytes: file_size_bytes || null,
          uploaded_by: auth.email,
          processing_status: "pending",
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // GET /api/reports — list reports
    if (path === "/reports" && req.method === "GET") {
      const { search, status, report_type, region, page = "1", limit = "20" } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabase
        .from("secondary_reports")
        .select("*", { count: "exact" });

      if (search) query = query.or(`title.ilike.%${search}%,source_org.ilike.%${search}%`);
      if (status && status !== "all") query = query.eq("processing_status", status);
      if (report_type && report_type !== "all") query = query.eq("report_type", report_type);
      if (region && region !== "all") query = query.eq("region", region);

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) return res.status(500).json({ error: error.message });

      // Get skill mention counts for each report
      const reportIds = (data || []).map((r: any) => r.id);
      let skillCounts: Record<string, number> = {};
      if (reportIds.length > 0) {
        const { data: counts } = await supabase
          .from("report_skill_mentions")
          .select("report_id")
          .in("report_id", reportIds);
        for (const row of counts || []) {
          skillCounts[row.report_id] = (skillCounts[row.report_id] || 0) + 1;
        }
      }

      const enriched = (data || []).map((r: any) => ({
        ...r,
        skill_count: skillCounts[r.id] || 0,
      }));

      return res.json({ data: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    // GET /api/reports/:id — single report detail
    if (path.match(/^\/reports\/[^/]+$/) && !path.includes("/skills") && req.method === "GET") {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("secondary_reports")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return res.status(404).json({ error: "Report not found" });
      return res.json(data);
    }

    // GET /api/reports/:id/skills — skill mentions for a report
    if (path.match(/^\/reports\/[^/]+\/skills$/) && req.method === "GET") {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("report_skill_mentions")
        .select("*")
        .eq("report_id", id)
        .order("ranking", { ascending: true, nullsFirst: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // DELETE /api/reports/:id — delete report
    if (path.match(/^\/reports\/[^/]+$/) && req.method === "DELETE") {
      const id = path.split("/")[2];
      const { error } = await supabase
        .from("secondary_reports")
        .delete()
        .eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    // POST /api/reports/:id/process — trigger AI processing
    if (path.match(/^\/reports\/[^/]+\/process$/) && req.method === "POST") {
      const id = path.split("/")[2];

      // Get the report
      const { data: report, error: fetchErr } = await supabase
        .from("secondary_reports")
        .select("*")
        .eq("id", id)
        .single();
      if (fetchErr || !report) return res.status(404).json({ error: "Report not found" });
      if (report.processing_status === "completed") return res.status(400).json({ error: "Report already processed" });

      // Mark as processing
      await supabase.from("secondary_reports").update({ processing_status: "processing", error_message: null }).eq("id", id);

      try {
        // Download file
        const fileResponse = await fetch(report.file_url);
        if (!fileResponse.ok) throw new Error("Failed to download file from storage");
        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

        // Extract text
        let fullText = "";
        if (report.file_type === "pdf") {
          const pdfParse = require("pdf-parse");
          const pdf = await pdfParse(fileBuffer);
          fullText = pdf.text;
        } else if (report.file_type === "docx") {
          const mammoth = require("mammoth");
          const result = await mammoth.extractRawText({ buffer: fileBuffer });
          fullText = result.value;
        } else {
          throw new Error("Unsupported file type: " + report.file_type);
        }

        // Chunk text
        const chunks = chunkText(fullText, 80000);
        await supabase.from("secondary_reports").update({ total_chunks: chunks.length, processed_chunks: 0 }).eq("id", id);

        // Process each chunk with GPT
        const allResults: any[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkResult = await processReportChunk(
            chunks[i],
            report.title,
            report.source_org || "Unknown",
            report.report_year || 0,
            report.region || "Global",
            i + 1,
            chunks.length
          );
          allResults.push(chunkResult);

          // Update progress
          await supabase.from("secondary_reports").update({ processed_chunks: i + 1 }).eq("id", id);
        }

        // Merge results from all chunks
        const mergedFindings: any[] = [];
        const mergedSkills: any[] = [];
        const mergedTables: any[] = [];
        const mergedStats: any[] = [];
        const summaryParts: string[] = [];

        for (const result of allResults) {
          if (result.section_summary) summaryParts.push(result.section_summary);
          if (result.key_findings) mergedFindings.push(...result.key_findings);
          if (result.skill_mentions) mergedSkills.push(...result.skill_mentions);
          if (result.extracted_tables) mergedTables.push(...result.extracted_tables);
          if (result.stats) mergedStats.push(...result.stats);
        }

        // Deduplicate skills by name — keep the one with more data
        const skillMap = new Map<string, any>();
        for (const skill of mergedSkills) {
          const key = skill.skill_name?.toLowerCase();
          if (!key) continue;
          const existing = skillMap.get(key);
          if (!existing || (skill.data_point && !existing.data_point) || (skill.ranking && !existing.ranking)) {
            skillMap.set(key, skill);
          }
        }
        const dedupedSkills = Array.from(skillMap.values());

        // Generate overall summary if multiple chunks
        let summary = summaryParts.join(" ");
        if (summaryParts.length > 1 && ANTHROPIC_API_KEY) {
          try {
            const summaryPrompt = `Summarize the following section summaries from an industry report into a concise executive summary (3-5 sentences).\n\n${summaryParts.join("\n\n")}`;
            summary = await callClaude(summaryPrompt) || summary;
          } catch {
            // Keep concatenated summary
          }
        }

        // Match skills against taxonomy
        const skillMentionsToInsert: any[] = [];
        for (const skill of dedupedSkills) {
          let taxonomySkillId: string | null = null;

          // Exact match
          const { data: exactMatch } = await supabase
            .from("taxonomy_skills")
            .select("id")
            .ilike("name", skill.skill_name)
            .limit(1)
            .maybeSingle();

          if (exactMatch) {
            taxonomySkillId = exactMatch.id;
          } else {
            // Fuzzy match
            try {
              const { data: fuzzyMatch } = await supabase
                .rpc("find_similar_skill", { search_term: skill.skill_name })
                .limit(1)
                .maybeSingle();
              if ((fuzzyMatch as any)?.id) {
                taxonomySkillId = (fuzzyMatch as any).id;
              }
            } catch {
              // RPC may not exist
            }
          }

          skillMentionsToInsert.push({
            report_id: id,
            taxonomy_skill_id: taxonomySkillId,
            skill_name: skill.skill_name,
            mention_context: skill.mention_context || null,
            ranking: skill.ranking || null,
            growth_indicator: skill.growth_indicator || null,
            data_point: skill.data_point || null,
          });
        }

        // Insert skill mentions
        if (skillMentionsToInsert.length > 0) {
          // Delete existing mentions first (in case of reprocessing)
          await supabase.from("report_skill_mentions").delete().eq("report_id", id);
          // Insert in batches of 50
          for (let i = 0; i < skillMentionsToInsert.length; i += 50) {
            await supabase.from("report_skill_mentions").insert(skillMentionsToInsert.slice(i, i + 50));
          }
        }

        // Update report with results
        await supabase.from("secondary_reports").update({
          summary,
          key_findings: mergedFindings,
          extracted_data: { tables: mergedTables, stats: mergedStats },
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        }).eq("id", id);

        return res.json({
          success: true,
          chunks_processed: chunks.length,
          skills_extracted: dedupedSkills.length,
          findings_count: mergedFindings.length,
        });
      } catch (err: any) {
        console.error("Report processing error:", err);
        await supabase.from("secondary_reports").update({
          processing_status: "error",
          error_message: err.message || "Processing failed",
        }).eq("id", id);
        return res.status(500).json({ error: err.message || "Processing failed" });
      }
    }

    // ==================== COLLEGE INTELLIGENCE ENGINE ROUTES ====================

    // POST /api/college/upload-catalog — Register a catalog upload (file already in Supabase Storage)
    if (path === "/college/upload-catalog" && req.method === "POST") {
      const { file_name, file_path, file_size_bytes } = req.body || {};
      if (!file_name || !file_path) {
        return res.status(400).json({ error: "file_name and file_path are required" });
      }

      const { data: upload, error: insertErr } = await supabase
        .from("catalog_uploads")
        .insert({
          file_name,
          file_path,
          file_size_bytes: file_size_bytes || 0,
          status: "uploaded",
        })
        .select()
        .single();

      if (insertErr) return res.status(500).json({ error: insertErr.message });
      return res.json(upload);
    }

    // POST /api/college/process-phase — Phased catalog processing (one phase per call)
    if (path === "/college/process-phase" && req.method === "POST") {
      const { upload_id, phase, college_name, college_short_name, catalog_year } = req.body || {};
      if (!upload_id || !phase) return res.status(400).json({ error: "upload_id and phase are required" });

      const { data: upload, error: fetchErr } = await supabase
        .from("catalog_uploads")
        .select("*")
        .eq("id", upload_id)
        .single();
      if (fetchErr || !upload) return res.status(404).json({ error: "Upload not found" });

      try {
        const result = await runCatalogPhase(upload, phase, { college_name, college_short_name, catalog_year });
        return res.json(result);
      } catch (err: any) {
        console.error(`Phase ${phase} failed:`, err.message);
        await supabase.from("catalog_uploads").update({
          status: "failed",
          error_message: (err.message || "Phase failed").slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", upload_id);
        return res.status(500).json({ error: err.message, phase });
      }
    }

    // GET /api/college/processing-status/:upload_id
    if (path.match(/^\/college\/processing-status\/[^/]+$/) && req.method === "GET") {
      const uploadId = path.split("/").pop()!;
      const { data, error } = await supabase
        .from("catalog_uploads")
        .select("id, status, progress, extraction_results, error_message, college_id, updated_at")
        .eq("id", uploadId)
        .single();
      if (error) return res.status(404).json({ error: "Upload not found" });
      return res.json(data);
    }

    // GET /api/colleges — List all colleges with stats
    if (path === "/colleges" && req.method === "GET") {
      const { data: colleges, error } = await supabase
        .from("colleges")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      // Fetch counts for each college
      const enriched = await Promise.all((colleges || []).map(async (c: any) => {
        const [programs, courses, skills] = await Promise.all([
          supabase.from("college_programs").select("id", { count: "exact", head: true }).eq("college_id", c.id),
          supabase.from("college_courses").select("id", { count: "exact", head: true }).eq("college_id", c.id),
          supabase.from("course_skills").select("id", { count: "exact", head: true })
            .in("course_id", (await supabase.from("college_courses").select("id").eq("college_id", c.id)).data?.map((r: any) => r.id) || []),
        ]);
        return {
          ...c,
          program_count: programs.count || 0,
          course_count: courses.count || 0,
          skill_count: skills.count || 0,
        };
      }));

      return res.json(enriched);
    }

    // GET /api/colleges/:id — College detail with schools and programs
    if (path.match(/^\/colleges\/[^/]+$/) && !path.includes("/programs") && !path.includes("/courses") && req.method === "GET") {
      const collegeId = path.split("/")[2];
      const [collegeRes, schoolsRes, programsRes, coursesRes] = await Promise.all([
        supabase.from("colleges").select("*").eq("id", collegeId).single(),
        supabase.from("college_schools").select("*").eq("college_id", collegeId).order("name"),
        supabase.from("college_programs").select("*").eq("college_id", collegeId).order("name"),
        supabase.from("college_courses").select("id", { count: "exact", head: true }).eq("college_id", collegeId),
      ]);
      if (collegeRes.error) return res.status(404).json({ error: "College not found" });

      return res.json({
        ...collegeRes.data,
        schools: schoolsRes.data || [],
        programs: programsRes.data || [],
        course_count: coursesRes.count || 0,
      });
    }

    // GET /api/colleges/:id/programs — All programs for a college
    if (path.match(/^\/colleges\/[^/]+\/programs$/) && req.method === "GET") {
      const collegeId = path.split("/")[2];
      const { data: programs, error } = await supabase
        .from("college_programs")
        .select("*, college_schools(name)")
        .eq("college_id", collegeId)
        .order("name");
      if (error) return res.status(500).json({ error: error.message });

      const enriched = await Promise.all((programs || []).map(async (p: any) => {
        const [courseCount, skillCount] = await Promise.all([
          supabase.from("program_courses").select("id", { count: "exact", head: true }).eq("program_id", p.id),
          supabase.from("course_skills").select("id", { count: "exact", head: true })
            .in("course_id", (await supabase.from("program_courses").select("course_id").eq("program_id", p.id)).data?.map((r: any) => r.course_id) || []),
        ]);
        return {
          ...p,
          school_name: p.college_schools?.name || null,
          course_count: courseCount.count || 0,
          skill_count: skillCount.count || 0,
        };
      }));

      return res.json(enriched);
    }

    // GET /api/colleges/:id/programs/:program_id — Program detail with courses and skills
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "GET") {
      const parts = path.split("/");
      const programId = parts[4];

      const [programRes, coursesRes] = await Promise.all([
        supabase.from("college_programs").select("*, college_schools(name)").eq("id", programId).single(),
        supabase.from("program_courses")
          .select("*, college_courses(*)")
          .eq("program_id", programId)
          .order("year_of_study")
          .order("sort_order"),
      ]);

      if (programRes.error) return res.status(404).json({ error: "Program not found" });

      // Fetch skills for each course
      const courseIds = (coursesRes.data || []).map((pc: any) => pc.course_id);
      const { data: skills } = await supabase
        .from("course_skills")
        .select("*")
        .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

      return res.json({
        ...programRes.data,
        school_name: programRes.data.college_schools?.name || null,
        courses: coursesRes.data || [],
        skills: skills || [],
      });
    }

    // GET /api/colleges/:id/courses — All courses for a college with filtering
    if (path.match(/^\/colleges\/[^/]+\/courses$/) && req.method === "GET") {
      const collegeId = path.split("/")[2];
      const { prefix, level, search } = req.query as Record<string, string>;

      let query = supabase
        .from("college_courses")
        .select("*")
        .eq("college_id", collegeId)
        .order("code");

      if (prefix) query = query.eq("department_prefix", prefix);
      if (level) query = query.eq("level", parseInt(level));
      if (search) query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);

      const { data: courses, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Get skill counts for each course
      const courseIds = (courses || []).map((c: any) => c.id);
      const { data: skillCounts } = await supabase
        .from("course_skills")
        .select("course_id")
        .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

      const countMap: Record<string, number> = {};
      for (const s of skillCounts || []) {
        countMap[s.course_id] = (countMap[s.course_id] || 0) + 1;
      }

      return res.json((courses || []).map((c: any) => ({
        ...c,
        skill_count: countMap[c.id] || 0,
      })));
    }

    // GET /api/colleges/:id/courses/:course_id — Course detail
    if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "GET") {
      const parts = path.split("/");
      const courseId = parts[4];

      const [courseRes, skillsRes, programsRes] = await Promise.all([
        supabase.from("college_courses").select("*").eq("id", courseId).single(),
        supabase.from("course_skills").select("*").eq("course_id", courseId).order("confidence", { ascending: false }),
        supabase.from("program_courses")
          .select("course_type, year_of_study, college_programs(id, name, degree_type)")
          .eq("course_id", courseId),
      ]);

      if (courseRes.error) return res.status(404).json({ error: "Course not found" });

      return res.json({
        ...courseRes.data,
        skills: skillsRes.data || [],
        programs: (programsRes.data || []).map((pc: any) => ({
          ...pc.college_programs,
          course_type: pc.course_type,
          year_of_study: pc.year_of_study,
        })),
      });
    }

    // GET /api/college/skill-coverage/:program_id — Skill category breakdown
    if (path.match(/^\/college\/skill-coverage\/[^/]+$/) && req.method === "GET") {
      const programId = path.split("/").pop()!;

      const { data: programCourses } = await supabase
        .from("program_courses")
        .select("course_id, course_type, college_courses(code, name)")
        .eq("program_id", programId);

      const courseIds = (programCourses || []).map((pc: any) => pc.course_id);
      const { data: skills } = await supabase
        .from("course_skills")
        .select("*")
        .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

      // Group by category
      const categories: Record<string, { skill_count: number; skills: any[]; courses: string[] }> = {};
      for (const s of skills || []) {
        const cat = s.skill_category || "Other";
        if (!categories[cat]) categories[cat] = { skill_count: 0, skills: [], courses: [] };
        categories[cat].skill_count++;
        categories[cat].skills.push(s);
        const course = (programCourses || []).find((pc: any) => pc.course_id === s.course_id);
        if (course?.college_courses) {
          const courseLabel = `${(course.college_courses as any).code} - ${(course.college_courses as any).name}`;
          if (!categories[cat].courses.includes(courseLabel)) {
            categories[cat].courses.push(courseLabel);
          }
        }
      }

      return res.json({
        categories: Object.entries(categories).map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.skill_count - a.skill_count),
      });
    }

    // GET /api/college/compare-programs?program_ids=uuid1,uuid2,...
    if (path === "/college/compare-programs" && req.method === "GET") {
      const { program_ids } = req.query as Record<string, string>;
      if (!program_ids) return res.status(400).json({ error: "program_ids query param required" });

      const ids = program_ids.split(",").filter(Boolean);
      if (ids.length < 2 || ids.length > 4) {
        return res.status(400).json({ error: "Provide 2-4 program IDs" });
      }

      const { data, error } = await supabase.rpc("get_program_skill_comparison", { p_program_ids: ids });
      if (error) return res.status(500).json({ error: error.message });

      // Also fetch program names
      const { data: programs } = await supabase
        .from("college_programs")
        .select("id, name, degree_type, major")
        .in("id", ids);

      return res.json({ programs: programs || [], skills: data || [] });
    }

    // GET /api/college/skill-gaps/:college_id
    if (path.match(/^\/college\/skill-gaps\/[^/]+$/) && req.method === "GET") {
      const collegeId = path.split("/").pop()!;
      const { taxonomy_category } = req.query as Record<string, string>;

      const { data, error } = await supabase.rpc("get_skill_gaps", { p_college_id: collegeId });
      if (error) return res.status(500).json({ error: error.message });

      let filtered = data || [];
      if (taxonomy_category) {
        filtered = filtered.filter((s: any) => s.taxonomy_category === taxonomy_category);
      }

      // Group by category
      const grouped: Record<string, string[]> = {};
      for (const s of filtered) {
        if (!grouped[s.taxonomy_category]) grouped[s.taxonomy_category] = [];
        grouped[s.taxonomy_category].push(s.taxonomy_skill_name);
      }

      return res.json({ gaps: grouped, total: filtered.length });
    }

    // GET /api/college/program-skill-heatmap/:college_id
    if (path.match(/^\/college\/program-skill-heatmap\/[^/]+$/) && req.method === "GET") {
      const collegeId = path.split("/").pop()!;

      const { data, error } = await supabase.rpc("get_program_skill_heatmap", { p_college_id: collegeId });
      if (error) return res.status(500).json({ error: error.message });

      return res.json(data || []);
    }

    // GET /api/college/course-prerequisites/:college_id
    if (path.match(/^\/college\/course-prerequisites\/[^/]+$/) && req.method === "GET") {
      const collegeId = path.split("/").pop()!;

      const { data: courses } = await supabase
        .from("college_courses")
        .select("id, code, name, prerequisite_codes, level, department_prefix")
        .eq("college_id", collegeId);

      const codeToId: Record<string, string> = {};
      for (const c of courses || []) codeToId[c.code] = c.id;

      const nodes = (courses || []).map((c: any) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        level: c.level,
        prefix: c.department_prefix,
      }));

      const edges: { from: string; to: string }[] = [];
      for (const c of courses || []) {
        for (const prereqCode of c.prerequisite_codes || []) {
          if (codeToId[prereqCode]) {
            edges.push({ from: codeToId[prereqCode], to: c.id });
          }
        }
      }

      return res.json({ nodes, edges });
    }

    // ==================== COLLEGE CRUD ENDPOINTS ====================

    // PATCH /api/colleges/:id — Update college info
    if (path.match(/^\/colleges\/[^/]+$/) && !path.includes("/programs") && !path.includes("/courses") && req.method === "PATCH") {
      const collegeId = path.split("/")[2];
      const { name, short_name, country, city, website, catalog_year } = req.body || {};
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) updates.name = name;
      if (short_name !== undefined) updates.short_name = short_name;
      if (country !== undefined) updates.country = country;
      if (city !== undefined) updates.city = city;
      if (website !== undefined) updates.website = website;
      if (catalog_year !== undefined) updates.catalog_year = catalog_year;

      const { data, error } = await supabase
        .from("colleges")
        .update(updates)
        .eq("id", collegeId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // POST /api/colleges/:id/programs — Create program
    if (path.match(/^\/colleges\/[^/]+\/programs$/) && req.method === "POST") {
      const collegeId = path.split("/")[2];
      const { name, school_id, degree_type, abbreviation, major, duration_years, total_credit_points, description, learning_outcomes } = req.body || {};
      if (!name) return res.status(400).json({ error: "name is required" });
      if (!degree_type) return res.status(400).json({ error: "degree_type is required" });

      const { data, error } = await supabase
        .from("college_programs")
        .insert({
          college_id: collegeId,
          name,
          school_id: school_id || null,
          degree_type,
          abbreviation: abbreviation || null,
          major: major || null,
          duration_years: duration_years || null,
          total_credit_points: total_credit_points || null,
          description: description || null,
          learning_outcomes: learning_outcomes || [],
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    // PATCH /api/colleges/:id/programs/:pid — Update program
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "PATCH") {
      const parts = path.split("/");
      const programId = parts[4];
      const { name, school_id, degree_type, abbreviation, major, duration_years, total_credit_points, description, learning_outcomes } = req.body || {};
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) updates.name = name;
      if (school_id !== undefined) updates.school_id = school_id;
      if (degree_type !== undefined) updates.degree_type = degree_type;
      if (abbreviation !== undefined) updates.abbreviation = abbreviation;
      if (major !== undefined) updates.major = major;
      if (duration_years !== undefined) updates.duration_years = duration_years;
      if (total_credit_points !== undefined) updates.total_credit_points = total_credit_points;
      if (description !== undefined) updates.description = description;
      if (learning_outcomes !== undefined) updates.learning_outcomes = learning_outcomes;

      const { data, error } = await supabase
        .from("college_programs")
        .update(updates)
        .eq("id", programId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // DELETE /api/colleges/:id/programs/:pid — Delete program
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "DELETE") {
      const parts = path.split("/");
      const programId = parts[4];
      // Delete related program_courses first
      await supabase.from("program_courses").delete().eq("program_id", programId);
      const { error } = await supabase.from("college_programs").delete().eq("id", programId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    // POST /api/colleges/:id/courses — Create course
    if (path.match(/^\/colleges\/[^/]+\/courses$/) && req.method === "POST") {
      const collegeId = path.split("/")[2];
      const { code, name, credit_points, description, prerequisites, hours_format } = req.body || {};
      if (!code) return res.status(400).json({ error: "code is required" });
      if (!name) return res.status(400).json({ error: "name is required" });

      // Parse department prefix and level from code
      const codeMatch = code.match(/^([A-Z]+)(\d+)/);
      const department_prefix = codeMatch ? codeMatch[1] : null;
      const level = codeMatch ? Math.floor(parseInt(codeMatch[2]) / 100) * 100 : null;

      // Parse prerequisite codes from prerequisites string
      const prerequisite_codes = prerequisites
        ? (prerequisites.match(/[A-Z]{2,5}\d{3,4}/g) || [])
        : [];

      const { data, error } = await supabase
        .from("college_courses")
        .insert({
          college_id: collegeId,
          code,
          name,
          credit_points: credit_points || 6,
          description: description || null,
          prerequisites: prerequisites || null,
          prerequisite_codes,
          hours_format: hours_format || null,
          department_prefix,
          level,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    // PATCH /api/colleges/:id/courses/:cid — Update course
    if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "PATCH") {
      const parts = path.split("/");
      const courseId = parts[4];
      const { code, name, credit_points, description, prerequisites, hours_format } = req.body || {};
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (code !== undefined) {
        updates.code = code;
        const codeMatch = code.match(/^([A-Z]+)(\d+)/);
        updates.department_prefix = codeMatch ? codeMatch[1] : null;
        updates.level = codeMatch ? Math.floor(parseInt(codeMatch[2]) / 100) * 100 : null;
      }
      if (name !== undefined) updates.name = name;
      if (credit_points !== undefined) updates.credit_points = credit_points;
      if (description !== undefined) updates.description = description;
      if (prerequisites !== undefined) {
        updates.prerequisites = prerequisites;
        updates.prerequisite_codes = prerequisites
          ? (prerequisites.match(/[A-Z]{2,5}\d{3,4}/g) || [])
          : [];
      }
      if (hours_format !== undefined) updates.hours_format = hours_format;

      const { data, error } = await supabase
        .from("college_courses")
        .update(updates)
        .eq("id", courseId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // DELETE /api/colleges/:id/courses/:cid — Delete course
    if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "DELETE") {
      const parts = path.split("/");
      const courseId = parts[4];
      // Check if course is assigned to programs
      const { count } = await supabase
        .from("program_courses")
        .select("id", { count: "exact", head: true })
        .eq("course_id", courseId);
      // Delete related records
      await supabase.from("course_skills").delete().eq("course_id", courseId);
      await supabase.from("program_courses").delete().eq("course_id", courseId);
      const { error } = await supabase.from("college_courses").delete().eq("id", courseId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, had_program_assignments: (count || 0) > 0 });
    }

    // POST /api/colleges/:id/programs/:pid/courses — Add course to program
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses$/) && req.method === "POST") {
      const parts = path.split("/");
      const programId = parts[4];
      const { course_id, course_type, year_of_study, sort_order } = req.body || {};
      if (!course_id) return res.status(400).json({ error: "course_id is required" });

      // Check for duplicates
      const { data: existing } = await supabase
        .from("program_courses")
        .select("id")
        .eq("program_id", programId)
        .eq("course_id", course_id)
        .maybeSingle();
      if (existing) return res.status(400).json({ error: "Course already assigned to this program" });

      const { data, error } = await supabase
        .from("program_courses")
        .insert({
          program_id: programId,
          course_id,
          course_type: course_type || "core",
          year_of_study: year_of_study || null,
          sort_order: sort_order || 0,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    // PATCH /api/colleges/:id/programs/:pid/courses/:cid — Update program-course assignment
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses\/[^/]+$/) && req.method === "PATCH") {
      const parts = path.split("/");
      const programId = parts[4];
      const courseId = parts[6];
      const { course_type, year_of_study, sort_order } = req.body || {};
      const updates: Record<string, any> = {};
      if (course_type !== undefined) updates.course_type = course_type;
      if (year_of_study !== undefined) updates.year_of_study = year_of_study;
      if (sort_order !== undefined) updates.sort_order = sort_order;

      const { data, error } = await supabase
        .from("program_courses")
        .update(updates)
        .eq("program_id", programId)
        .eq("course_id", courseId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // DELETE /api/colleges/:id/programs/:pid/courses/:cid — Remove course from program
    if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses\/[^/]+$/) && req.method === "DELETE") {
      const parts = path.split("/");
      const programId = parts[4];
      const courseId = parts[6];
      const { error } = await supabase
        .from("program_courses")
        .delete()
        .eq("program_id", programId)
        .eq("course_id", courseId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    // ==================== JOB STATUS CHECKER ====================
    if (path === "/pipelines/check-job-status" && req.method === "POST") {
      const { batch_size = 50 } = req.body || {};
      const limit = Math.min(parseInt(batch_size) || 50, 200);

      // Get jobs with source_url that haven't been checked recently (or never checked)
      const { data: jobs, error: fetchErr } = await supabase
        .from("jobs")
        .select("id, title, source_url, job_status, status_checked_at")
        .not("source_url", "is", null)
        .order("status_checked_at", { ascending: true, nullsFirst: true })
        .limit(limit);

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });
      if (!jobs || jobs.length === 0) return res.json({ success: true, checked: 0, message: "No jobs with source URLs to check" });

      // Create a pipeline run
      const { data: run, error: runErr } = await supabase
        .from("pipeline_runs")
        .insert({
          pipeline_type: "job_status_check",
          trigger_type: "manual",
          config: { batch_size: limit },
          status: "running",
          total_items: jobs.length,
          processed_items: 0,
          started_at: new Date().toISOString(),
          triggered_by: "dashboard",
        })
        .select()
        .single();
      if (runErr) return res.status(500).json({ error: runErr.message });

      // Process each job
      let processed = 0;
      let failed = 0;
      for (const job of jobs) {
        try {
          let status = "unknown";
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(job.source_url!, {
              method: "GET",
              headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusBot/1.0)" },
              signal: controller.signal,
              redirect: "follow",
            });
            clearTimeout(timeout);

            if (response.status === 404 || response.status === 410) {
              status = "closed";
            } else if (response.ok) {
              const html = await response.text();
              const lowerHtml = html.toLowerCase();
              // Check for closed/expired indicators
              if (
                lowerHtml.includes("job not found") ||
                lowerHtml.includes("this job has expired") ||
                lowerHtml.includes("no longer available") ||
                lowerHtml.includes("position has been filled") ||
                lowerHtml.includes("this job is no longer") ||
                lowerHtml.includes("job has been removed")
              ) {
                status = "closed";
              } else if (
                lowerHtml.includes("apply now") ||
                lowerHtml.includes("apply for this") ||
                lowerHtml.includes("submit application") ||
                lowerHtml.includes("easy apply")
              ) {
                status = "open";
              }
            } else {
              status = "unknown";
            }
          } catch {
            status = "unknown";
          }

          await supabase
            .from("jobs")
            .update({ job_status: status, status_checked_at: new Date().toISOString() })
            .eq("id", job.id);
          processed++;
        } catch {
          failed++;
        }

        // Update progress
        await supabase
          .from("pipeline_runs")
          .update({ processed_items: processed, failed_items: failed })
          .eq("id", run.id);
      }

      // Complete the pipeline run
      await supabase
        .from("pipeline_runs")
        .update({
          status: "completed",
          processed_items: processed,
          failed_items: failed,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);

      return res.json({ success: true, checked: processed, failed, pipeline_run_id: run.id });
    }

    return res.status(404).json({ error: "Not found", path });
  } catch (err: any) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

// ==================== COLLEGE CATALOG PHASED PROCESSING ====================

async function downloadAndParsePDF(sb: any, filePath: string): Promise<{ text: string; pages: number }> {
  const { data: fileData, error: dlErr } = await sb.storage
    .from("college-catalogs")
    .download(filePath);
  if (dlErr || !fileData) throw new Error("Failed to download catalog PDF");
  const pdfParse = require("pdf-parse");
  const buffer = Buffer.from(await fileData.arrayBuffer());
  const pdf = await pdfParse(buffer);
  return { text: pdf.text, pages: pdf.numpages };
}

async function runCatalogPhase(
  upload: any,
  phase: string,
  opts: { college_name?: string; college_short_name?: string; catalog_year?: string }
): Promise<{ done: boolean; next_phase?: string; batch?: number; stats?: Record<string, any> }> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const progress = upload.progress || {};

  const updateProgress = async (updates: Record<string, any>) => {
    const merged = { ...progress, ...updates };
    await sb.from("catalog_uploads").update({
      status: "extracting",
      progress: merged,
      updated_at: new Date().toISOString(),
    }).eq("id", upload.id);
  };

  switch (phase) {
    // ---- PHASE 1: Extract college info + schools ----
    case "extract_info": {
      const { text: fullText, pages: totalPages } = await downloadAndParsePDF(sb, upload.file_path);
      await sb.from("catalog_uploads").update({ total_pages: totalPages }).eq("id", upload.id);
      await updateProgress({ current_phase: "extract_info", total_pages: totalPages });

      // Extract schools using regex (more reliable than GPT for this)
      const schoolRegex = /School of [A-Za-z, &]+/g;
      const schoolMentions = new Set<string>();
      let match;
      while ((match = schoolRegex.exec(fullText)) !== null) {
        let name = match[0].replace(/\s+/g, " ").trim();
        // Clean up: remove trailing prepositions/articles
        name = name.replace(/\s+(of|the|and|in|for|to|at|on|with|from|by|or|as|is|an|a)$/i, "").trim();
        if (name.length > 15 && name.length < 80) schoolMentions.add(name);
      }
      // Deduplicate similar school names (keep longest)
      const schoolNames = [...schoolMentions].filter(s => 
        !["School of Business offers", "School of Business office"].some(skip => s.startsWith(skip))
      ).filter(s => /^School of [A-Z]/.test(s));
      const uniqueSchools = schoolNames.reduce((acc: string[], s) => {
        if (!acc.some(a => s.startsWith(a) || a.startsWith(s))) acc.push(s);
        else {
          const idx = acc.findIndex(a => s.startsWith(a) || a.startsWith(s));
          if (idx >= 0 && s.length > acc[idx].length) acc[idx] = s;
        }
        return acc;
      }, []);
      console.log("Found schools via regex:", uniqueSchools);

      // Use GPT just for college name/location (first 5K chars is enough for that)
      const firstSection = fullText.slice(0, 5000);
      const gptResult = await callGPT(`You are analyzing a university academic catalog. Extract basic info from this text.

Text:
${firstSection}

Return a JSON object:
{
  "college_name": "Full official name of the university",
  "short_name": "Abbreviation",
  "country": "Country",
  "city": "City",
  "website": "Website URL if found",
  "catalog_year": "Academic year e.g. 2025-2026"
}

Only include information clearly stated in the text.`);

      const collegeInfo = JSON.parse(gptResult);
      // Add schools from regex extraction
      collegeInfo.schools = uniqueSchools.map(name => ({
        name,
        short_name: name.replace("School of ", "").split(",")[0].trim()
      }));
      const collegeFinalName = opts.college_name || collegeInfo.college_name;

      let collegeId: string;
      const { data: existingCollege } = await sb
        .from("colleges").select("id").eq("name", collegeFinalName).maybeSingle();

      if (existingCollege) {
        await sb.from("colleges").update({
          short_name: opts.college_short_name || collegeInfo.short_name,
          country: collegeInfo.country, city: collegeInfo.city,
          website: collegeInfo.website,
          catalog_year: opts.catalog_year || collegeInfo.catalog_year,
          updated_at: new Date().toISOString(),
        }).eq("id", existingCollege.id);
        collegeId = existingCollege.id;
      } else {
        const { data: newCollege, error: insertErr } = await sb
          .from("colleges").insert({
            name: collegeFinalName,
            short_name: opts.college_short_name || collegeInfo.short_name,
            country: collegeInfo.country, city: collegeInfo.city,
            website: collegeInfo.website,
            catalog_year: opts.catalog_year || collegeInfo.catalog_year,
          }).select().single();
        if (insertErr) throw new Error(`Failed to create college: ${insertErr.message}`);
        collegeId = newCollege.id;
      }

      await sb.from("catalog_uploads").update({ college_id: collegeId }).eq("id", upload.id);

      const schoolMap: Record<string, string> = {};
      for (const school of collegeInfo.schools || []) {
        const { data: schoolData } = await sb
          .from("college_schools")
          .upsert({ college_id: collegeId, name: school.name, short_name: school.short_name }, { onConflict: "college_id,name" })
          .select().single();
        if (schoolData) schoolMap[school.name] = schoolData.id;
      }

      await updateProgress({
        current_phase: "extract_info",
        college_id: collegeId,
        school_map: schoolMap,
        total_pages: totalPages,
        schools_found: Object.keys(schoolMap).length,
        programs_extracted: 0,
        courses_found: 0,
      });

      return { done: false, next_phase: "extract_programs", stats: { schools: Object.keys(schoolMap).length } };
    }

    // ---- PHASE 2: Extract programs (2 chunks per call) ----
    case "extract_programs": {
      const collegeId = progress.college_id;
      const schoolMap = progress.school_map || {};
      if (!collegeId) throw new Error("No college_id in progress — run extract_info first");

      const { text: fullText } = await downloadAndParsePDF(sb, upload.file_path);
      const programChunks = chunkTextForCatalog(fullText, 15000);
      const maxChunks = Math.min(programChunks.length, 10);
      const batchIndex = progress.programs_batch_index || 0;
      const chunksPerCall = 1;
      const endIndex = Math.min(batchIndex + chunksPerCall, maxChunks);

      const allPrograms: any[] = [];
      for (let i = batchIndex; i < endIndex; i++) {
        try {
          const gptResult = await callGPT(`You are analyzing a university academic catalog section. Extract all degree programs mentioned.

Text:
${programChunks[i]}

Schools in this university: ${Object.keys(schoolMap).join(", ")}

Return JSON array of programs:
[{
  "name": "Full program name e.g. Bachelor of Business (Accountancy)",
  "school_name": "Which school this belongs to (must be one from the list above)",
  "degree_type": "bachelor|master|phd|graduate_certificate|diploma",
  "abbreviation": "e.g. BBus, BCS, MBA",
  "major": "Major specialization if any, null otherwise",
  "duration_years": 3,
  "total_credit_points": 144,
  "qf_emirates_level": 7,
  "delivery_mode": "on_campus|online|hybrid",
  "description": "Brief program description",
  "learning_outcomes": ["outcome1", "outcome2"],
  "intake_sessions": ["Autumn", "Spring"]
}]

Only include programs clearly described. Skip duplicates.`);
          allPrograms.push(...JSON.parse(gptResult));
        } catch { /* skip chunk errors */ }
      }

      // Deduplicate and insert
      const seenPrograms = new Set<string>();
      for (const prog of allPrograms) {
        if (seenPrograms.has(prog.name)) continue;
        seenPrograms.add(prog.name);
        const schoolId = schoolMap[prog.school_name] || Object.values(schoolMap)[0];
        if (!schoolId) continue;
        await sb.from("college_programs").upsert({
          school_id: schoolId, college_id: collegeId, name: prog.name,
          degree_type: prog.degree_type || "bachelor", abbreviation: prog.abbreviation,
          major: prog.major, duration_years: prog.duration_years,
          total_credit_points: prog.total_credit_points, qf_emirates_level: prog.qf_emirates_level,
          delivery_mode: prog.delivery_mode, description: prog.description,
          learning_outcomes: prog.learning_outcomes || [], intake_sessions: prog.intake_sessions || [],
          processing_status: "completed", updated_at: new Date().toISOString(),
        }, { onConflict: "college_id,name" });
      }

      const { count: totalPrograms } = await sb.from("college_programs")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      if (endIndex < maxChunks) {
        await updateProgress({
          current_phase: "extract_programs",
          programs_batch_index: endIndex,
          programs_total_batches: maxChunks,
          programs_extracted: totalPrograms || 0,
        });
        return { done: false, next_phase: "extract_programs", batch: endIndex, stats: { programs: totalPrograms } };
      }

      await updateProgress({
        current_phase: "extract_programs",
        programs_batch_index: maxChunks,
        programs_total_batches: maxChunks,
        programs_extracted: totalPrograms || 0,
      });
      return { done: false, next_phase: "extract_courses", stats: { programs: totalPrograms } };
    }

    // ---- PHASE 3: Extract courses (2 chunks per call) ----
    case "extract_courses": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { text: fullText } = await downloadAndParsePDF(sb, upload.file_path);
      const courseChunks = chunkTextForCatalog(fullText, 15000);
      const batchIndex = progress.courses_batch_index || 0;
      const chunksPerCall = 1;
      const endIndex = Math.min(batchIndex + chunksPerCall, courseChunks.length);

      for (let i = batchIndex; i < endIndex; i++) {
        try {
          const gptResult = await callGPT(`You are analyzing a university catalog section. Extract all course/subject descriptions.

Text:
${courseChunks[i]}

Return JSON array of courses:
[{
  "code": "ACCY121",
  "name": "Accounting for Decision Making",
  "credit_points": 6,
  "description": "Full course description",
  "hours_format": "L-2, T-2",
  "prerequisites": "Raw prerequisite text",
  "topics_covered": ["topic1", "topic2"]
}]

Only include courses with a valid course code (letters followed by numbers, e.g. ACCY121, BUS101, CSIT111). Skip entries that aren't course descriptions.`);

          const courses = JSON.parse(gptResult);
          for (const course of courses) {
            if (!course.code) continue;
            const codeMatch = course.code.match(/^([A-Z]+)\s?(\d)/);
            const prefix = codeMatch ? codeMatch[1] : null;
            const level = codeMatch ? parseInt(codeMatch[2]) * 100 : null;
            const prereqCodes = (course.prerequisites || "").match(/[A-Z]{2,4}\s?\d{3}/g) || [];
            await sb.from("college_courses").upsert({
              college_id: collegeId, code: course.code.replace(/\s/g, ""), name: course.name,
              credit_points: course.credit_points || 6, description: course.description,
              hours_format: course.hours_format, prerequisites: course.prerequisites,
              prerequisite_codes: prereqCodes.map((c: string) => c.replace(/\s/g, "")),
              department_prefix: prefix, level, topics_covered: course.topics_covered || [],
              updated_at: new Date().toISOString(),
            }, { onConflict: "college_id,code" });
          }
        } catch { /* skip chunk errors */ }
      }

      const { count: totalCourses } = await sb.from("college_courses")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      if (endIndex < courseChunks.length) {
        await updateProgress({
          current_phase: "extract_courses",
          courses_batch_index: endIndex,
          courses_total_batches: courseChunks.length,
          courses_found: totalCourses || 0,
        });
        return { done: false, next_phase: "extract_courses", batch: endIndex, stats: { courses: totalCourses } };
      }

      await updateProgress({
        current_phase: "extract_courses",
        courses_batch_index: courseChunks.length,
        courses_total_batches: courseChunks.length,
        courses_found: totalCourses || 0,
      });
      return { done: false, next_phase: "map_courses", stats: { courses: totalCourses } };
    }

    // ---- PHASE 4: Map courses to programs (3 programs per call) ----
    case "map_courses": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbPrograms } = await sb.from("college_programs").select("id, name").eq("college_id", collegeId);
      const { data: dbCourses } = await sb.from("college_courses").select("id, code").eq("college_id", collegeId);
      const codeToId: Record<string, string> = {};
      for (const c of dbCourses || []) codeToId[c.code] = c.id;
      const courseCodes = (dbCourses || []).map((c: any) => c.code).join(", ");

      const batchIndex = progress.map_batch_index || 0;
      const progsPerCall = 3;
      const programs = dbPrograms || [];
      const endIndex = Math.min(batchIndex + progsPerCall, programs.length);

      for (let i = batchIndex; i < endIndex; i++) {
        const prog = programs[i];
        try {
          const gptResult = await callGPT(`Given this university program name: "${prog.name}"
And these available course codes: ${courseCodes}

Based on the program name and common university curriculum patterns, identify which courses likely belong to this program.

Return JSON:
[{
  "code": "ACCY121",
  "course_type": "core|major|elective|capstone|general_education",
  "year_of_study": 1,
  "is_required": true
}]

Be conservative — only include courses that clearly relate to this program based on the department prefix and program focus.`);

          const mappings = JSON.parse(gptResult);
          for (let idx = 0; idx < mappings.length; idx++) {
            const m = mappings[idx];
            const courseId = codeToId[m.code?.replace(/\s/g, "")];
            if (!courseId) continue;
            await sb.from("program_courses").upsert({
              program_id: prog.id, course_id: courseId,
              course_type: m.course_type || "core", year_of_study: m.year_of_study,
              is_required: m.is_required !== false, sort_order: idx,
            }, { onConflict: "program_id,course_id" });
          }
        } catch { /* skip mapping errors */ }
      }

      if (endIndex < programs.length) {
        await updateProgress({
          current_phase: "map_courses",
          map_batch_index: endIndex,
          map_total_batches: programs.length,
        });
        return { done: false, next_phase: "map_courses", batch: endIndex };
      }

      await updateProgress({
        current_phase: "map_courses",
        map_batch_index: programs.length,
        map_total_batches: programs.length,
      });
      return { done: false, next_phase: "extract_skills" };
    }

    // ---- PHASE 5: Extract skills (1 batch of 6 courses per call) ----
    case "extract_skills": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbCourses } = await sb.from("college_courses")
        .select("id, code, name, description").eq("college_id", collegeId);
      const coursesWithDesc = (dbCourses || []).filter((c: any) => c.description);

      const batchSize = 6;
      const totalBatches = Math.ceil(coursesWithDesc.length / batchSize);
      const batchIndex = progress.skills_batch_index || 0;

      if (batchIndex < totalBatches) {
        const batch = coursesWithDesc.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
        const courseDescriptions = batch.map((c: any) =>
          `Course: ${c.code} - ${c.name}\nDescription: ${c.description}`
        ).join("\n\n---\n\n");

        try {
          const gptResult = await callGPT(`You are analyzing university courses. Extract skills and competencies students will develop.

${courseDescriptions}

For EACH course above, extract skills. Return JSON:
{
  "courses": [
    {
      "code": "ACCY121",
      "skills": [
        { "skill_name": "Financial Statement Analysis", "skill_category": "Technical", "confidence": 0.9 },
        { "skill_name": "Critical Thinking", "skill_category": "Analytical", "confidence": 0.7 }
      ]
    }
  ]
}

Categories: "Technical", "Analytical", "Domain Knowledge", "Communication", "Leadership", "Research"
Be specific (not "business skills" but "financial statement analysis"). Only include skills clearly developed in each course.`);

          const result = JSON.parse(gptResult);
          for (const courseSkills of result.courses || []) {
            const course = (dbCourses || []).find((c: any) => c.code === courseSkills.code?.replace(/\s/g, ""));
            if (!course) continue;
            for (const skill of courseSkills.skills || []) {
              await sb.from("course_skills").upsert({
                course_id: course.id, skill_name: skill.skill_name,
                skill_category: skill.skill_category, confidence: skill.confidence || 0.8,
                source: "ai_extraction",
              }, { onConflict: "course_id,skill_name" });
            }
          }
        } catch { /* skip batch errors */ }

        const nextBatch = batchIndex + 1;
        await updateProgress({
          current_phase: "extract_skills",
          skills_batch_index: nextBatch,
          skills_total_batches: totalBatches,
        });

        if (nextBatch < totalBatches) {
          return { done: false, next_phase: "extract_skills", batch: nextBatch, stats: { skills_batches: `${nextBatch}/${totalBatches}` } };
        }
      }

      await updateProgress({ current_phase: "extract_skills", skills_batch_index: totalBatches, skills_total_batches: totalBatches });
      return { done: false, next_phase: "map_taxonomy" };
    }

    // ---- PHASE 6: Map skills to taxonomy ----
    case "map_taxonomy": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbCourses } = await sb.from("college_courses").select("id").eq("college_id", collegeId);
      const courseIds = (dbCourses || []).map((c: any) => c.id);

      const { data: extractedSkills } = await sb
        .from("course_skills").select("id, skill_name")
        .is("taxonomy_skill_id", null)
        .in("course_id", courseIds);

      for (const skill of extractedSkills || []) {
        const { data: exactMatch } = await sb
          .from("taxonomy_skills").select("id")
          .ilike("name", skill.skill_name).limit(1).maybeSingle();

        if (exactMatch) {
          await sb.from("course_skills").update({ taxonomy_skill_id: exactMatch.id }).eq("id", skill.id);
        } else {
          try {
            const { data: fuzzyMatch } = await sb
              .rpc("find_similar_skill", { search_term: skill.skill_name }).limit(1).maybeSingle();
            if ((fuzzyMatch as any)?.id) {
              await sb.from("course_skills").update({ taxonomy_skill_id: (fuzzyMatch as any).id }).eq("id", skill.id);
            }
          } catch { /* RPC may not exist */ }
        }
      }

      // Compute final stats
      const { count: totalSkills } = await sb.from("course_skills")
        .select("id", { count: "exact", head: true }).in("course_id", courseIds);
      const { count: totalPrograms } = await sb.from("college_programs")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);
      const { count: totalCourses } = await sb.from("college_courses")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      await sb.from("catalog_uploads").update({
        status: "completed",
        progress: { ...progress, current_phase: "done" },
        extraction_results: {
          schools: progress.schools_found || 0,
          programs: totalPrograms || 0,
          courses: totalCourses || 0,
          skills: totalSkills || 0,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", upload.id);

      return {
        done: true,
        stats: {
          schools: progress.schools_found || 0,
          programs: totalPrograms || 0,
          courses: totalCourses || 0,
          skills: totalSkills || 0,
        },
      };
    }

    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

async function callGPT(prompt: string, retries = 2): Promise<string> {
  // Truncate prompt to ~120K chars to stay within GPT-4o-mini context window
  const truncatedPrompt = prompt.length > 120000 ? prompt.slice(0, 120000) + "\n[TEXT TRUNCATED]" : prompt;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout per call
      
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.2",
          messages: [{ role: "user", content: truncatedPrompt }],
          temperature: 0.2,
          max_completion_tokens: 4096,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown error");
        throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      // Strip markdown code blocks if present
      return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    } catch (err: any) {
      console.error(`callGPT attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries) throw err;
      // Wait before retry
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("callGPT: all retries failed");
}

async function callClaude(prompt: string, jsonSchema?: any, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const body: any = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      };

      // If JSON schema provided, use tool_use for guaranteed structured output
      if (jsonSchema) {
        body.tools = [{
          name: "extract_data",
          description: "Extract structured data from the content",
          input_schema: jsonSchema,
        }];
        body.tool_choice = { type: "tool", name: "extract_data" };
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown");
        throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();

      // Extract result based on response type
      if (jsonSchema) {
        const toolBlock = data.content?.find((b: any) => b.type === "tool_use");
        return JSON.stringify(toolBlock?.input || {});
      } else {
        const textBlock = data.content?.find((b: any) => b.type === "text");
        return textBlock?.text || "";
      }
    } catch (err: any) {
      console.error(`callClaude attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("callClaude: all retries failed");
}

function chunkTextForCatalog(text: string, maxChars: number = 20000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n\n", end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// ==================== REPORT PROCESSING HELPERS ====================

function chunkText(text: string, maxChars: number = 80000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Try to break at a paragraph boundary
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n\n", end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function processReportChunk(
  text: string,
  title: string,
  sourceOrg: string,
  year: number,
  region: string,
  chunkNum: number,
  totalChunks: number
): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  // Truncate text to fit within Claude context limits
  const truncatedText = text.slice(0, 80000);

  const prompt = `You are an expert analyst processing a section of an industry/skills report.
Extract structured information from the following report section.

Report: ${title} by ${sourceOrg} (${year}) — Region: ${region}
Section ${chunkNum} of ${totalChunks}:
"""
${truncatedText}
"""`;

  const jsonSchema = {
    type: "object" as const,
    properties: {
      section_summary: { type: "string", description: "Brief summary of this section (2-3 sentences)" },
      key_findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: { type: "string" },
            category: { type: "string", enum: ["skills", "labor_market", "technology", "salary", "education", "regional"] },
            confidence: { type: "number" },
          },
          required: ["finding", "category", "confidence"],
        },
      },
      skill_mentions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill_name: { type: "string" },
            mention_context: { type: "string" },
            ranking: { type: "number" },
            growth_indicator: { type: "string", enum: ["growing", "declining", "stable", "emerging"] },
            data_point: { type: "string" },
          },
          required: ["skill_name"],
        },
      },
      extracted_tables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
                required: ["label", "value"],
              },
            },
          },
          required: ["title", "rows"],
        },
      },
      stats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            metric: { type: "string" },
            value: { type: "string" },
            context: { type: "string" },
          },
          required: ["metric", "value", "context"],
        },
      },
    },
    required: ["section_summary", "key_findings", "skill_mentions", "extracted_tables", "stats"],
  };

  try {
    const result = await callClaude(prompt, jsonSchema);
    return JSON.parse(result);
  } catch {
    return { section_summary: "", key_findings: [], skill_mentions: [], extracted_tables: [], stats: [] };
  }
}

// ==================== SCHEDULER HELPERS ====================

// ==================== DEDUPLICATION PIPELINE ====================

async function executeDeduplication(runId: string, _config: any) {
  // Step 1: Recompute quality scores
  await supabase.from("pipeline_runs").update({ status: "running", total_items: 0 }).eq("id", runId);

  const { error: qErr } = await supabase.rpc("recompute_quality_scores");
  if (qErr) throw new Error(`Quality score computation failed: ${qErr.message}`);

  // Step 2: Normalize fields
  const { error: nErr } = await supabase.rpc("normalize_job_fields");
  if (nErr) throw new Error(`Normalization failed: ${nErr.message}`);

  // Step 3: Find duplicate groups
  const { data: groups, error: gErr } = await supabase.rpc("find_duplicate_groups");
  if (gErr) throw new Error(`Duplicate detection failed: ${gErr.message}`);

  const dupGroups = groups || [];
  let totalDuplicates = 0;

  // Step 4: For each group, keep highest quality_score job, mark others
  for (const group of dupGroups) {
    const jobIds: string[] = group.job_ids;
    if (jobIds.length < 2) continue;

    const bestId = jobIds[0]; // Already sorted by quality_score DESC
    const dupeIds = jobIds.slice(1);

    for (const dupeId of dupeIds) {
      await supabase
        .from("jobs")
        .update({ is_duplicate: true, duplicate_of: bestId })
        .eq("id", dupeId);
      totalDuplicates++;
    }
  }

  // Step 5: Update pipeline run
  await supabase.from("pipeline_runs").update({
    status: "completed",
    total_items: dupGroups.length,
    processed_items: totalDuplicates,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

// ==================== CO-OCCURRENCE PIPELINE ====================

async function executeCooccurrence(runId: string, _config: any) {
  await supabase.from("pipeline_runs").update({ status: "running" }).eq("id", runId);

  // Step 1: Get all job_skills grouped by job
  const { data: allSkills, error: sErr } = await supabase
    .from("job_skills")
    .select("job_id, skill_name, taxonomy_skill_id")
    .order("job_id");
  if (sErr) throw new Error(`Failed to fetch job skills: ${sErr.message}`);

  // Group by job_id
  const jobSkillsMap: Record<string, Array<{ skill_name: string; taxonomy_skill_id: string | null }>> = {};
  for (const s of allSkills || []) {
    if (!jobSkillsMap[s.job_id]) jobSkillsMap[s.job_id] = [];
    jobSkillsMap[s.job_id].push({ skill_name: s.skill_name, taxonomy_skill_id: s.taxonomy_skill_id });
  }

  // Filter to jobs with 2+ skills
  const jobIds = Object.keys(jobSkillsMap).filter(id => jobSkillsMap[id].length >= 2);
  const totalJobs = jobIds.length;

  // Step 2-3: Generate pairs and count co-occurrences
  const pairCounts: Record<string, { count: number; skill_a_id: string | null; skill_b_id: string | null }> = {};
  const skillJobCounts: Record<string, number> = {};

  for (const jobId of jobIds) {
    const skills = jobSkillsMap[jobId];
    const uniqueNames = [...new Set(skills.map(s => s.skill_name))];

    // Count jobs per skill
    for (const name of uniqueNames) {
      skillJobCounts[name] = (skillJobCounts[name] || 0) + 1;
    }

    // Generate all pairs (sorted to avoid duplicates)
    for (let i = 0; i < uniqueNames.length; i++) {
      for (let j = i + 1; j < uniqueNames.length; j++) {
        const [a, b] = [uniqueNames[i], uniqueNames[j]].sort();
        const key = `${a}|||${b}`;
        if (!pairCounts[key]) {
          const skillA = skills.find(s => s.skill_name === a);
          const skillB = skills.find(s => s.skill_name === b);
          pairCounts[key] = { count: 0, skill_a_id: skillA?.taxonomy_skill_id || null, skill_b_id: skillB?.taxonomy_skill_id || null };
        }
        pairCounts[key].count++;
      }
    }
  }

  // Step 5: Upsert into skill_cooccurrence — batch in groups of 100
  const pairs = Object.entries(pairCounts);
  const BATCH_SIZE = 100;

  await supabase.from("pipeline_runs").update({ total_items: pairs.length }).eq("id", runId);

  let processed = 0;
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    const rows = batch.map(([key, val]) => {
      const [a, b] = key.split("|||");
      return {
        skill_a_name: a,
        skill_b_name: b,
        skill_a_id: val.skill_a_id,
        skill_b_id: val.skill_b_id,
        cooccurrence_count: val.count,
        jobs_with_a: skillJobCounts[a] || 0,
        jobs_with_b: skillJobCounts[b] || 0,
        last_updated: new Date().toISOString(),
      };
    });

    await supabase
      .from("skill_cooccurrence")
      .upsert(rows, { onConflict: "skill_a_name,skill_b_name" });

    processed += batch.length;
    if (i % (BATCH_SIZE * 10) === 0) {
      await supabase.from("pipeline_runs").update({ processed_items: processed }).eq("id", runId);
    }
  }

  // Step 6: Compute PMI scores
  const { error: pmiErr } = await supabase.rpc("compute_pmi_scores", { p_total_jobs: totalJobs });
  if (pmiErr) throw new Error(`PMI computation failed: ${pmiErr.message}`);

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: pairs.length,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

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
    } else if (pipelineType === "jd_fetch") {
      await executeJDFetch(runId, config);
    } else if (pipelineType === "jd_enrichment") {
      await executeJDEnrichment(runId, config);
    } else if (pipelineType === "people_enrichment") {
      await executePeopleEnrichment(runId, config);
    } else if (pipelineType === "deduplication") {
      await executeDeduplication(runId, config);
    } else if (pipelineType === "cooccurrence") {
      await executeCooccurrence(runId, config);
    } else if (pipelineType === "job_status_check") {
      // Handled by the /pipelines/check-job-status endpoint directly
      return;
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
      model: "gpt-5.4-nano",
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
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    const parsed = JSON.parse(content);
    // Handle both { skills: [...] } and direct array format
    const skills = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.skills) ? parsed.skills : []);
    return skills;
  } catch {
    return [];
  }
}

// ==================== JD FETCH PIPELINE (Feature 4) ====================

async function executeJDFetch(runId: string, config: any) {
  const batchSize = Math.min(parseInt(config.batch_size) || 10, 50);

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, company_name, source, source_url, description")
    .eq("jd_fetch_status", "pending")
    .or("description.is.null,description.lt.100")
    .order("created_at", { ascending: false })
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

  for (const job of jobs) {
    try {
      let fetchedDescription: string | null = null;

      // Strategy 1: Apify for LinkedIn jobs with source_url
      if (job.source === "linkedin" && job.source_url && APIFY_API_KEY) {
        try {
          const apifyRes = await fetch(
            `https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=30`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                startUrls: [{ url: job.source_url }],
                maxRequestsPerCrawl: 1,
                pageFunction: `async function pageFunction(context) {
                  const $ = context.jQuery;
                  const desc = $(".description__text, .show-more-less-html__markup, [class*='description'], .job-description").text().trim();
                  return { description: desc || document.body.innerText.substring(0, 8000) };
                }`,
              }),
            }
          );
          if (apifyRes.ok) {
            const items = await apifyRes.json();
            const desc = items?.[0]?.description;
            if (desc && desc.length > 100) {
              fetchedDescription = desc;
            }
          }
        } catch (apifyErr: any) {
          console.error(`[JD Fetch] Apify failed for job ${job.id}:`, apifyErr.message);
        }
      }

      // Strategy 2: OpenAI fallback — reconstruct JD from what we know
      if (!fetchedDescription && OPENAI_API_KEY) {
        try {
          const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-5.4-nano",
              messages: [{
                role: "user",
                content: `Find or reconstruct the full job description for the role "${job.title}" at ${job.company_name || "unknown company"}. ${job.source_url ? `Original posting: ${job.source_url}` : ""}\n\nReturn ONLY the full job description text. If you cannot find it, construct a realistic job description based on the role title and company. Start directly with the job description content.`,
              }],
              temperature: 0.3,
              max_completion_tokens: 2000,
            }),
          });
          if (openaiRes.ok) {
            const openaiData = await openaiRes.json();
            const content = openaiData.choices?.[0]?.message?.content;
            if (content && content.length > 100 && !content.includes("NOT_FOUND")) {
              fetchedDescription = content;
            }
          }
        } catch (oaiErr: any) {
          console.error(`[JD Fetch] OpenAI fallback failed for job ${job.id}:`, oaiErr.message);
        }
      }

      if (fetchedDescription && fetchedDescription.length > 100) {
        // Extract implicit data from the JD
        const implicitData = await extractImplicitData(fetchedDescription, job.title, job.company_name);

        await supabase.from("jobs").update({
          description: fetchedDescription,
          jd_fetch_status: "fetched",
          jd_fetched_at: new Date().toISOString(),
          enrichment_status: "partial",
          ...(implicitData.work_mode && { work_mode: implicitData.work_mode }),
          ...(implicitData.benefits?.length && { benefits: implicitData.benefits }),
          ...(implicitData.min_experience_years != null && { min_experience_years: implicitData.min_experience_years }),
          ...(implicitData.max_experience_years != null && { max_experience_years: implicitData.max_experience_years }),
          ...(implicitData.education_requirements?.length && { education_requirements: implicitData.education_requirements }),
          ...(implicitData.certifications_required?.length && { certifications_required: implicitData.certifications_required }),
          ...(implicitData.inferred_salary_min != null && { inferred_salary_min: implicitData.inferred_salary_min }),
          ...(implicitData.inferred_salary_max != null && { inferred_salary_max: implicitData.inferred_salary_max }),
          ...(implicitData.inferred_salary_currency && { inferred_salary_currency: implicitData.inferred_salary_currency }),
          ...(implicitData.inferred_salary_source && { inferred_salary_source: implicitData.inferred_salary_source }),
          ...(implicitData.industry_domain && { industry_domain: implicitData.industry_domain }),
          ...(implicitData.tools_platforms?.length && { tools_platforms: implicitData.tools_platforms }),
        }).eq("id", job.id);

        await supabase.from("enrichment_logs").insert({
          entity_type: "job",
          entity_id: job.id,
          provider: "apify+openai",
          operation: "jd_fetch",
          status: "success",
          details: { description_length: fetchedDescription.length, implicit_fields_extracted: Object.keys(implicitData).length },
        });

        processed++;
      } else {
        await supabase.from("jobs").update({ jd_fetch_status: "failed" }).eq("id", job.id);

        await supabase.from("enrichment_logs").insert({
          entity_type: "job",
          entity_id: job.id,
          provider: "apify+openai",
          operation: "jd_fetch",
          status: "failed",
          details: { error: "Could not fetch or reconstruct JD" },
        });

        failed++;
      }

      // Update progress
      await supabase.from("pipeline_runs").update({
        processed_items: processed,
        failed_items: failed,
      }).eq("id", runId);

      // Rate limit: 2 second delay between jobs
      await new Promise(r => setTimeout(r, 2000));
    } catch (jobErr: any) {
      console.error(`[JD Fetch] Error processing job ${job.id}:`, jobErr.message);
      await supabase.from("jobs").update({ jd_fetch_status: "failed" }).eq("id", job.id);
      await supabase.from("enrichment_logs").insert({
        entity_type: "job",
        entity_id: job.id,
        provider: "apify+openai",
        operation: "jd_fetch",
        status: "failed",
        details: { error: jobErr.message },
      });
      failed++;
      await supabase.from("pipeline_runs").update({ processed_items: processed, failed_items: failed }).eq("id", runId);
    }
  }

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function extractImplicitData(description: string, title: string, companyName: string | null): Promise<any> {
  if (!OPENAI_API_KEY) return {};

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        messages: [
          {
            role: "system",
            content: `You extract structured data from job descriptions. Return a JSON object with these fields (use null for unknown):
- work_mode: "remote" | "hybrid" | "onsite" | null
- benefits: string[] (e.g. ["health insurance", "401k", "remote work"])
- min_experience_years: number | null
- max_experience_years: number | null
- education_requirements: string[] (e.g. ["Bachelor's in Computer Science", "MBA preferred"])
- certifications_required: string[] (e.g. ["CPA", "AWS Certified"])
- inferred_salary_min: number | null (annual, in local currency)
- inferred_salary_max: number | null
- inferred_salary_currency: string | null (e.g. "USD", "INR")
- inferred_salary_source: "explicit" | "inferred" | null
- industry_domain: string | null (e.g. "fintech", "healthcare", "e-commerce")
- tools_platforms: string[] (specific tools/platforms mentioned, e.g. ["Salesforce", "Jira", "AWS"])`,
          },
          {
            role: "user",
            content: `Job Title: ${title}\nCompany: ${companyName || "Unknown"}\n\nJob Description:\n${description.slice(0, 4000)}`,
          },
        ],
        temperature: 0.2,
        max_completion_tokens: 1000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return {};

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// ==================== JD ANALYSIS PIPELINE (Feature 5 — Enhanced jd_enrichment) ====================

async function executeJDEnrichment(runId: string, config: any) {
  const batchSize = Math.min(parseInt(config.batch_size) || 25, 100);

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, company_name, description")
    .in("enrichment_status", ["pending", "partial"])
    .not("description", "is", null)
    .order("created_at", { ascending: false })
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

  // Filter out jobs with very short descriptions
  const validJobs = jobs.filter(j => j.description && j.description.length > 100);
  await supabase.from("pipeline_runs").update({ total_items: validJobs.length }).eq("id", runId);

  let processed = 0;
  let failed = 0;

  // Process in parallel batches of 5
  for (let i = 0; i < validJobs.length; i += 5) {
    const batch = validJobs.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (job) => {
        // Call GPT-4o-mini with enhanced extraction prompt
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-5.4-nano",
            messages: [
              {
                role: "system",
                content: `You are an expert job description analyst. Extract structured information from job descriptions and return JSON.

Return a JSON object with:
- skills: array of { name: string, type: "technical" | "soft" | "domain" | "tool", required: boolean, confidence: number (0-1) }
  Extract 10-40 skills. Be specific (e.g. "React.js" not "frontend", "PostgreSQL" not "database").
- experience: { min_years: number|null, max_years: number|null, level: "entry"|"mid"|"senior"|"lead"|"executive"|null }
- education: string[] (e.g. ["Bachelor's in CS", "Master's preferred"])
- certifications: string[]
- industry: string|null (e.g. "fintech", "healthcare")
- tools_platforms: string[] (specific tools mentioned)
- work_mode: "remote"|"hybrid"|"onsite"|null
- responsibilities: string[] (top 5-8 key responsibilities, brief)
- seniority: "intern"|"entry"|"mid"|"senior"|"lead"|"manager"|"director"|"executive"|null
- functions: string[] (job function areas, e.g. ["engineering", "data science", "product management"])`,
              },
              {
                role: "user",
                content: `Job Title: ${job.title}\nCompany: ${job.company_name || "Unknown"}\n\nJob Description:\n${job.description!.slice(0, 6000)}`,
              },
            ],
            temperature: 0.2,
            max_completion_tokens: 3000,
            response_format: { type: "json_object" },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} ${errText}`);
        }

        const aiData = await response.json();
        const tokenUsage = aiData.usage || {};
        const content = aiData.choices?.[0]?.message?.content || "{}";
        const extracted = JSON.parse(content);

        // Match extracted skills against taxonomy
        const skills = extracted.skills || [];
        for (const skill of skills) {
          if (skill.confidence < 0.6) continue;

          let taxonomySkillId: string | null = null;

          // Exact match (case-insensitive)
          const { data: exactMatch } = await supabase
            .from("taxonomy_skills")
            .select("id")
            .ilike("name", skill.name)
            .limit(1)
            .maybeSingle();

          if (exactMatch) {
            taxonomySkillId = exactMatch.id;
          } else {
            // Fuzzy match via find_similar_skill RPC
            try {
              const { data: fuzzyMatch } = await supabase
                .rpc("find_similar_skill", { search_term: skill.name })
                .limit(1)
                .maybeSingle();
              if ((fuzzyMatch as any)?.id) {
                taxonomySkillId = (fuzzyMatch as any).id;
              }
            } catch {
              // RPC may not exist — skip fuzzy matching
            }
          }

          await supabase.from("job_skills").upsert({
            job_id: job.id,
            skill_name: skill.name,
            skill_category: skill.type || "technical",
            confidence_score: skill.confidence,
            extraction_method: "ai_enhanced",
            taxonomy_skill_id: taxonomySkillId,
            is_required: skill.required ?? null,
          }, { onConflict: "job_id,skill_name" });
        }

        // Update job record with all structured fields
        const updateFields: any = {
          enrichment_status: "complete",
        };
        if (extracted.experience?.min_years != null) updateFields.min_experience_years = extracted.experience.min_years;
        if (extracted.experience?.max_years != null) updateFields.max_experience_years = extracted.experience.max_years;
        if (extracted.education?.length) updateFields.education_requirements = extracted.education;
        if (extracted.certifications?.length) updateFields.certifications_required = extracted.certifications;
        if (extracted.work_mode) updateFields.work_mode = extracted.work_mode;
        if (extracted.industry) updateFields.industry_domain = extracted.industry;
        if (extracted.tools_platforms?.length) updateFields.tools_platforms = extracted.tools_platforms;
        if (extracted.seniority) updateFields.seniority_level = extracted.seniority;

        await supabase.from("jobs").update(updateFields).eq("id", job.id);

        // Log enrichment
        await supabase.from("enrichment_logs").insert({
          entity_type: "job",
          entity_id: job.id,
          provider: "openai",
          operation: "jd_analysis",
          status: "success",
          credits_used: tokenUsage.total_tokens || 0,
          details: { skills_extracted: skills.length, model: "gpt-5.4-nano", tokens: tokenUsage },
        });
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        processed++;
      } else {
        failed++;
        console.error("[JD Analysis] Error:", r.reason?.message || r.reason);
        // Log failure for any job in the batch that failed
      }
    }

    await supabase.from("pipeline_runs").update({
      processed_items: processed,
      failed_items: failed,
    }).eq("id", runId);

    // Rate limit: 2 second delay between batches
    if (i + 5 < validJobs.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
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

// People Enrichment pipeline (Apify LinkedIn Profile Scraper)

// Apify actor IDs to try for LinkedIn profile scraping (in order of preference)
const LINKEDIN_PROFILE_ACTORS = [
  "harvestapi/linkedin-profile-scraper",
  "dev_fusion/Linkedin-Profile-Scraper",
  "curious_coder/linkedin-profile-scraper",
];

async function fetchLinkedInProfile(linkedinUrl: string): Promise<any> {
  let lastError: Error | null = null;

  for (const actorId of LINKEDIN_PROFILE_ACTORS) {
    try {
      const actorSlug = actorId.replace("/", "~");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

      const response = await fetch(
        `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startUrls: [{ url: linkedinUrl }],
            maxItems: 1,
            proxyConfiguration: { useApifyProxy: true },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastError = new Error(`Apify ${actorId} error ${response.status}: ${text.slice(0, 200)}`);
        continue;
      }

      const items = await response.json();
      if (Array.isArray(items) && items.length > 0) {
        return items[0];
      }

      // If sync returned empty, try async pattern
      return await fetchLinkedInProfileAsync(actorSlug, linkedinUrl);
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  throw lastError || new Error("All Apify actors failed for LinkedIn profile scraping");
}

async function fetchLinkedInProfileAsync(actorSlug: string, linkedinUrl: string): Promise<any> {
  // Start run
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${actorSlug}/runs?token=${APIFY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: linkedinUrl }],
        maxItems: 1,
        proxyConfiguration: { useApifyProxy: true },
      }),
    }
  );
  if (!startRes.ok) throw new Error(`Apify async start failed: ${startRes.status}`);
  const runData = await startRes.json();
  const runId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!runId) throw new Error("No run ID from Apify async start");

  // Poll for completion (max 120s)
  const maxWait = 120000;
  const pollInterval = 5000;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
    );
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json();
    const status = statusData.data?.status;
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }

  // Get dataset items
  if (!datasetId) throw new Error("No dataset ID from Apify run");
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
  );
  if (!dataRes.ok) throw new Error(`Failed to get Apify dataset: ${dataRes.status}`);
  const items = await dataRes.json();
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function getSeniorityScore(title: string): number {
  const t = (title || "").toLowerCase();
  if (/\b(ceo|cto|cfo|coo|founder|president|chairman)\b/.test(t)) return 90;
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 80;
  if (/\b(director|head of)\b/.test(t)) return 70;
  if (/\b(senior manager|sr manager)\b/.test(t)) return 60;
  if (/\b(manager)\b/.test(t)) return 50;
  if (/\b(senior|sr|lead|principal)\b/.test(t)) return 40;
  if (/\b(associate|analyst|engineer|developer|consultant)\b/.test(t)) return 30;
  if (/\b(junior|jr|entry|trainee|intern)\b/.test(t)) return 20;
  return 25;
}

function classifyCareerTransition(prev: any, curr: any): string {
  const sameCompany = (prev.companyName || prev.company || "").toLowerCase() ===
    (curr.companyName || curr.company || "").toLowerCase();
  const seniorityUp = getSeniorityScore(curr.title || curr.position || "") >
    getSeniorityScore(prev.title || prev.position || "");
  const prevIndustry = (prev.industry || prev.companyIndustry || "").toLowerCase();
  const currIndustry = (curr.industry || curr.companyIndustry || "").toLowerCase();
  const industryChange = prevIndustry && currIndustry && prevIndustry !== currIndustry;

  if (sameCompany && seniorityUp) return "promotion";
  if (sameCompany) return "lateral";
  if (industryChange) return "industry_change";
  return "company_change";
}

function computeCareerTransitions(experiences: any[]): any[] {
  if (!experiences || experiences.length < 2) return [];

  // Sort by start date (oldest first)
  const sorted = [...experiences].sort((a, b) => {
    const dateA = a.startDate || a.start || a.dateRange?.split("–")[0] || "";
    const dateB = b.startDate || b.start || b.dateRange?.split("–")[0] || "";
    return String(dateA).localeCompare(String(dateB));
  });

  const transitions: any[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    transitions.push({
      from_title: prev.title || prev.position || null,
      from_company: prev.companyName || prev.company || null,
      to_title: curr.title || curr.position || null,
      to_company: curr.companyName || curr.company || null,
      type: classifyCareerTransition(prev, curr),
      date: curr.startDate || curr.start || null,
    });
  }
  return transitions;
}

function computeEnrichmentScore(data: {
  headline?: string | null;
  profilePicture?: string | null;
  experiences?: any[];
  education?: any[];
  skills?: any[];
  certifications?: any[];
  careerTransitions?: any[];
  email?: string | null;
}): number {
  let score = 0;
  if (data.headline) score += 10;
  if (data.profilePicture) score += 5;
  if (data.experiences && data.experiences.length >= 2) score += 20;
  if (data.education && data.education.length > 0) score += 15;
  if (data.skills && data.skills.length > 0) score += 15;
  if (data.certifications && data.certifications.length > 0) score += 10;
  if (data.careerTransitions && data.careerTransitions.length > 0) score += 15;
  if (data.email) score += 10;
  return Math.min(score, 100);
}

function extractProfileData(raw: any) {
  // Handle various Apify actor response formats
  const fullName = raw.fullName || raw.full_name || raw.name || null;
  const headline = raw.headline || raw.title || raw.tagline || null;
  const profilePicture = raw.profilePicUrl || raw.profilePictureUrl || raw.profilePicture || raw.avatar || raw.photo || null;
  const connectionsCount = raw.connectionsCount || raw.connections || raw.connectionCount || null;

  // Experiences: different actors use different field names
  const experiences = raw.experiences || raw.experience || raw.positions || raw.workExperience || [];
  const education = raw.educations || raw.education || raw.schools || [];
  const certifications = raw.certifications || raw.certificates || [];
  const skills = raw.skills || [];
  const languages = raw.languages || [];
  const volunteerWork = raw.volunteerExperience || raw.volunteerWork || raw.volunteer || [];
  const publications = raw.publications || [];

  // Normalize skills to string array
  const skillsList: string[] = Array.isArray(skills)
    ? skills.map((s: any) => typeof s === "string" ? s : s.name || s.skill || String(s)).filter(Boolean)
    : [];

  // Normalize languages to string array
  const languagesList: string[] = Array.isArray(languages)
    ? languages.map((l: any) => typeof l === "string" ? l : l.name || l.language || String(l)).filter(Boolean)
    : [];

  return {
    fullName,
    headline,
    profilePicture,
    connectionsCount: typeof connectionsCount === "number" ? connectionsCount : parseInt(connectionsCount) || null,
    experiences: Array.isArray(experiences) ? experiences : [],
    education: Array.isArray(education) ? education : [],
    certifications: Array.isArray(certifications) ? certifications : [],
    skills: skillsList,
    languages: languagesList,
    volunteerWork: Array.isArray(volunteerWork) ? volunteerWork : [],
    publications: Array.isArray(publications) ? publications : [],
  };
}

async function executePeopleEnrichment(runId: string, config: any) {
  const mode = config?.mode || "enrich";
  const batchSize = Math.min(parseInt(config?.batch_size) || 5, 20);

  if (mode === "search") {
    // Keep search mode as a stub fallback
    const stubResults = generatePeopleSearchStub({
      job_title: config?.job_title || "",
      location: config?.location || "",
      company: config?.company || "",
      seniority: config?.seniority || "",
      limit: batchSize,
    }, batchSize);
    await supabase.from("pipeline_runs").update({ total_items: stubResults.length }).eq("id", runId);

    let processed = 0, failed = 0, skipped = 0;
    for (const person of stubResults) {
      try {
        if (person.email) {
          const { data: existing } = await supabase.from("people").select("id").eq("email", person.email).maybeSingle();
          if (existing) { skipped++; continue; }
        }
        let companyId = null;
        if (person.company_name) {
          const { data: existingCompany } = await supabase.from("companies").select("id").eq("name", person.company_name).maybeSingle();
          if (existingCompany) { companyId = existingCompany.id; }
          else {
            const { data: newCompany } = await supabase.from("companies").insert({ name: person.company_name, domain: person.company_domain || null, enrichment_status: "pending" }).select("id").maybeSingle();
            companyId = newCompany?.id;
          }
        }
        await supabase.from("people").insert({
          full_name: person.full_name, first_name: person.first_name, last_name: person.last_name,
          email: person.email || null, linkedin_url: person.linkedin_url || null, current_title: person.title || null,
          current_company_id: companyId, seniority: mapPersonSeniority(person.seniority),
          function: mapPersonFunction(person.department), location_city: person.city || null,
          location_country: person.country || null, enrichment_status: "partial", enrichment_score: 40,
          enrichment_sources: { search_stub: true }, raw_data: person,
        });
        processed++;
      } catch (e) { failed++; }
    }

    await supabase.from("enrichment_logs").insert({
      entity_type: "person", entity_id: runId, provider: "stub", operation: "people_search",
      status: "success", credits_used: 0,
    });
    await supabase.from("pipeline_runs").update({
      status: "completed", processed_items: processed, failed_items: failed,
      skipped_items: skipped, completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return;
  }

  // Mode: "enrich" — Real Apify LinkedIn profile enrichment
  const { data: people, error } = await supabase
    .from("people")
    .select("id, full_name, email, linkedin_url, current_title")
    .in("enrichment_status", ["pending", "partial"])
    .not("linkedin_url", "is", null)
    .limit(batchSize);

  if (error) throw error;
  if (!people?.length) {
    await supabase.from("pipeline_runs").update({
      status: "completed", total_items: 0, completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return;
  }

  await supabase.from("pipeline_runs").update({ total_items: people.length }).eq("id", runId);

  let processed = 0;
  let failed = 0;
  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    try {
      // Rate limit: 3 second delay between Apify calls (skip for first call)
      if (i > 0) {
        await new Promise(r => setTimeout(r, 3000));
      }

      const rawProfile = await fetchLinkedInProfile(person.linkedin_url!);
      if (!rawProfile) {
        await supabase.from("enrichment_logs").insert({
          entity_type: "person", entity_id: person.id, provider: "apify",
          operation: "profile_enrich", status: "no_data", credits_used: 1,
          pipeline_run_id: runId,
        });
        failed++;
        continue;
      }

      const profile = extractProfileData(rawProfile);
      const careerTransitions = computeCareerTransitions(profile.experiences);
      const enrichmentScore = computeEnrichmentScore({
        headline: profile.headline,
        profilePicture: profile.profilePicture,
        experiences: profile.experiences,
        education: profile.education,
        skills: profile.skills,
        certifications: profile.certifications,
        careerTransitions,
        email: person.email,
      });

      // Determine current title from most recent experience if not already set
      let currentTitle = person.current_title;
      if (!currentTitle && profile.experiences.length > 0) {
        const latest = profile.experiences[0];
        currentTitle = latest.title || latest.position || null;
      }

      await supabase.from("people").update({
        full_name: profile.fullName || person.full_name,
        headline: profile.headline,
        profile_picture_url: profile.profilePicture,
        connections_count: profile.connectionsCount,
        current_title: currentTitle,
        experience: profile.experiences,
        education: profile.education,
        certifications: profile.certifications,
        skills: profile.skills,
        languages_spoken: profile.languages,
        volunteer_work: profile.volunteerWork,
        publications: profile.publications,
        career_transitions: careerTransitions,
        enrichment_status: "enriched",
        enrichment_score: enrichmentScore,
        enrichment_sources: { apify_linkedin: true },
        last_enriched_at: new Date().toISOString(),
        raw_data: rawProfile,
      }).eq("id", person.id);

      await supabase.from("enrichment_logs").insert({
        entity_type: "person", entity_id: person.id, provider: "apify",
        operation: "profile_enrich", status: "success", credits_used: 1,
        pipeline_run_id: runId,
      });

      processed++;
    } catch (e: any) {
      await supabase.from("enrichment_logs").insert({
        entity_type: "person", entity_id: person.id, provider: "apify",
        operation: "profile_enrich", status: "failed", credits_used: 0,
        error_message: e?.message?.slice(0, 500) || "Unknown error",
        pipeline_run_id: runId,
      });
      failed++;
    }
  }

  // Update credits
  if (processed > 0) {
    await supabase.rpc("increment_credits_used", { p_provider: "apify", p_month: currentMonth, p_amount: processed });
  }

  await supabase.from("pipeline_runs").update({
    status: "completed", processed_items: processed, failed_items: failed,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
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
