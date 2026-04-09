import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, APIFY_API_KEY, CRON_SECRET } from "./lib/supabase";
import { verifyAuth } from "./lib/auth";

// Pre-auth route handlers (public / custom JWT auth)
import { handlePlaceIntelRoutes, handlePlaceIntelAdminRoutes } from "./routes/placeintel";
import { handleSurveyRoutes, handleSurveyAdminRoutes } from "./routes/surveys";

// Post-auth route handlers
import { handleDashboardRoutes } from "./routes/dashboard";
import { handleJobsRoutes } from "./routes/jobs";
import { handleCompaniesRoutes } from "./routes/companies";
import { handlePeopleRoutes } from "./routes/people";
import { handlePipelineRoutes, executePipeline } from "./routes/pipelines";
import { handleSettingsRoutes } from "./routes/settings";
import { handleUsersRoutes } from "./routes/users";
import { handleTaxonomyRoutes } from "./routes/taxonomy";
import { handleAnalyticsRoutes } from "./routes/analytics";
import { handleDataQualityRoutes } from "./routes/data-quality";
import { handleUploadRoutes } from "./routes/upload";
import { handleScheduleRoutes, calculateNextRun } from "./routes/schedules";
import { handleReportRoutes } from "./routes/reports";
import { handleCollegeRoutes } from "./routes/colleges";
import { handleBucketTestRoutes } from "./routes/bucket-test";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS — restrict to known domains
  const allowedOrigins = [
    "https://nexus-bi-one.vercel.app",
    "https://nexus-bi-abhay-9478s-projects.vercel.app",
    "https://nexus-bi-git-main-abhay-9478s-projects.vercel.app",
    "https://nexus.boardinfinity.com",
  ];
  const origin = req.headers.origin || "";
  if (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0]);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Vercel passes catch-all path segments as query param 'path'
  // e.g. /api/dashboard/stats becomes /api/index.ts?path=dashboard/stats
  const pathParam = req.query?.path;
  const pathFromQuery = Array.isArray(pathParam) ? pathParam.join("/") : pathParam;
  const path = pathFromQuery ? `/${pathFromQuery}` : (req.url?.replace(/^\/api\/index\.ts/, "").replace(/^\/api/, "").split("?")[0] || "/");

  // ==================== PLACEINTEL ROUTES (public / placeintel-JWT auth, before main auth) ====================
  if (path.startsWith("/placeintel/") && !path.startsWith("/placeintel/admin") && !path.startsWith("/placeintel/sync")) {
    try {
      return await handlePlaceIntelRoutes(path, req, res);
    } catch (err: any) {
      console.error("PlaceIntel API Error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

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
  if (path === "/scheduler/tick" && (req.method === "POST" || req.method === "GET")) {
    try {
      // Verify CRON_SECRET via Authorization header or Vercel cron header
      const authHeader = req.headers.authorization;
      const vercelCronHeader = req.headers["x-vercel-cron"];
      const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

      if (!CRON_SECRET) {
        return res.status(500).json({ error: "CRON_SECRET not configured" });
      }
      if (bearerToken !== CRON_SECRET && vercelCronHeader !== "1") {
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
    return res.status(401).json({ error: "Access denied. Contact your administrator to get access." });
  }

  try {
    // Route to appropriate handler based on path prefix
    let result: VercelResponse | undefined;

    if (path.startsWith("/dashboard")) {
      result = await handleDashboardRoutes(path, req, res, auth);
    } else if (path.startsWith("/jobs")) {
      result = await handleJobsRoutes(path, req, res, auth);
    } else if (path.startsWith("/companies")) {
      result = await handleCompaniesRoutes(path, req, res, auth);
    } else if (path.startsWith("/people")) {
      result = await handlePeopleRoutes(path, req, res, auth);
    } else if (path.startsWith("/pipelines") || path.startsWith("/providers") || path.startsWith("/monitoring")) {
      result = await handlePipelineRoutes(path, req, res, auth);
    } else if (path.startsWith("/alumni")) {
      result = await handleCollegeRoutes(path, req, res, auth);
    } else if (path.startsWith("/settings")) {
      result = await handleSettingsRoutes(path, req, res, auth);
    } else if (path.startsWith("/users")) {
      result = await handleUsersRoutes(path, req, res, auth);
    } else if (path.startsWith("/taxonomy") || path.startsWith("/skills") || path === "/analyze-jd") {
      result = await handleTaxonomyRoutes(path, req, res, auth);
    } else if (path.startsWith("/analytics") || path.startsWith("/export")) {
      result = await handleAnalyticsRoutes(path, req, res, auth);
    } else if (path.startsWith("/data-quality")) {
      result = await handleDataQualityRoutes(path, req, res, auth);
    } else if (path.startsWith("/upload") || path.startsWith("/csv-uploads")) {
      result = await handleUploadRoutes(path, req, res, auth);
    } else if (path.startsWith("/schedules")) {
      result = await handleScheduleRoutes(path, req, res, auth);
    } else if (path.startsWith("/reports")) {
      result = await handleReportRoutes(path, req, res, auth);
    } else if (path.startsWith("/college") || path.startsWith("/colleges")) {
      result = await handleCollegeRoutes(path, req, res, auth);
    } else if (path.startsWith("/admin/bucket-test")) {
      result = await handleBucketTestRoutes(path, req, res, auth);
    } else if (path === "/admin/test-claude") {
      result = await handleReportRoutes("/reports/test-claude", req, res, auth);
    } else if (path.startsWith("/admin/survey")) {
      result = await handleSurveyAdminRoutes(path, req, res, auth);
    } else if (path.startsWith("/placeintel/admin") || path.startsWith("/placeintel/sync")) {
      result = await handlePlaceIntelAdminRoutes(path, req, res, auth);
    }

    if (result) return result;

    return res.status(404).json({ error: "Route not found", path });
  } catch (err: any) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
