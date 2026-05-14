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
import { handleSchedulerRoutes } from "./routes/scheduler";
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
import { handleMastersRoutes } from "./routes/masters";
import { handleCampusUploadRoutes } from "./routes/campus-upload";
import { handleCollegeDashboardRoutes, handlePublicCollegeDashboardRoutes } from "./routes/college-dashboard";
import { handleExtractUaeJobSkillsRoutes, handlePublicExtractUaeJobSkillsTick } from "./routes/extract-uae-job-skills";

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

  // ==================== PUBLIC COLLEGE DASHBOARD (share-token auth, before main auth) ====================
  if (path.startsWith("/public/college-dashboard/")) {
    try {
      const r = await handlePublicCollegeDashboardRoutes(path, req, res);
      if (r) return r;
      return res.status(404).json({ error: "Not found" });
    } catch (err: any) {
      console.error("Public College Dashboard API Error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  // ==================== PUBLIC EXTRACT-UAE-JOB-SKILLS TICK (cron-secret, before main auth) ====================
  if (path.startsWith("/public/extract-uae-job-skills/")) {
    try {
      const r = await handlePublicExtractUaeJobSkillsTick(path, req, res);
      if (r) return r;
      return res.status(404).json({ error: "Not found" });
    } catch (err: any) {
      console.error("Public Extract UAE Job Skills API Error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  // ==================== JD AUTO-DRAIN CHAIN (cron-secret auth, before main auth) ====================
  if (path === "/pipelines/jd/chain" && req.method === "POST") {
    // Auth is enforced inside handlePipelineRoutes via x-cron-secret check.
    const cronAuth = await verifyAuth(req).catch(() => ({ nexusUser: null as any })) as any;
    const result = await handlePipelineRoutes(path, req, res, cronAuth);
    if (result) return;
    return res.status(404).json({ error: "Not found" });
  }

  // ==================== SCHEDULER TICK (cron-secret auth, before main auth) ====================
  if (path === "/scheduler/tick" && (req.method === "POST" || req.method === "GET")) {
    // Tick has its own auth (x-vercel-cron header or CRON_SECRET)
    // Pass a minimal auth object since verifyAuth hasn't run yet
    const cronAuth = await verifyAuth(req).catch(() => ({ nexusUser: null as any })) as any;
    const result = await handleSchedulerRoutes(path, req, res, cronAuth);
    if (result) return;
    return res.status(404).json({ error: "Not found" });
  }

  // Authenticate all other requests
  const auth = await verifyAuth(req);

  // Handle access-denied page for non-authenticated users on non-public routes
  if (!auth.nexusUser && !path.startsWith("/public")) {
    return res.status(401).json({ error: "Access denied. Contact your administrator to get access." });
  }

  let result: VercelResponse | undefined;

  try {
    if (path.startsWith("/dashboard")) {
      result = await handleDashboardRoutes(path, req, res, auth);
    } else if (path.startsWith("/jobs")) {
      result = await handleJobsRoutes(path, req, res, auth);
    } else if (path.startsWith("/people")) {
      result = await handlePeopleRoutes(path, req, res, auth);
    } else if (path.startsWith("/scheduler")) {
      result = await handleSchedulerRoutes(path, req, res, auth);
    } else if (path.startsWith("/pipelines") || path.startsWith("/providers") || path.startsWith("/monitoring") || path.startsWith("/discovered-titles")) {
      result = await handlePipelineRoutes(path, req, res, auth);
    } else if (path.startsWith("/alumni")) {
      result = await handleCollegeRoutes(path, req, res, auth);
    } else if (path.startsWith("/settings")) {
      result = await handleSettingsRoutes(path, req, res, auth);
    } else if (path.startsWith("/users")) {
      result = await handleUsersRoutes(path, req, res, auth);
    } else if (path.startsWith("/taxonomy") || path.startsWith("/skills") || path === "/analyze-jd" || path === "/analyze-jd/runs" || path.startsWith("/analyze-jd")) {
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
    } else if (path.startsWith("/college-dashboard")) {
      result = await handleCollegeDashboardRoutes(path, req, res, auth);
    } else if (path.startsWith("/college") || path.startsWith("/colleges")) {
      result = await handleCollegeRoutes(path, req, res, auth);
    } else if (path.startsWith("/campus-upload")) {
      result = await handleCampusUploadRoutes(path, req, res, auth);
    } else if (path.startsWith("/masters")) {
      result = await handleMastersRoutes(path, req, res, auth);
    } else if (path.startsWith("/admin/bucket-test")) {
      result = await handleBucketTestRoutes(path, req, res, auth);
    } else if (path.startsWith("/admin/extract-uae-job-skills")) {
      result = await handleExtractUaeJobSkillsRoutes(path, req, res, auth);
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
