import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const APIFY_API_KEY = process.env.APIFY_API_KEY || "";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";

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
        openai: { configured: false, key_preview: null },
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

    return res.status(404).json({ error: "Not found", path });
  } catch (err: any) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
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

  const query = config.query || "software engineer India";
  const numPages = parseInt(config.pages) || 1;
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let totalItems = 0;

  for (let page = 1; page <= numPages; page++) {
    const url = new URL("https://jsearch.p.rapidapi.com/search");
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("num_pages", "1");
    if (config.date_posted) url.searchParams.set("date_posted", config.date_posted);

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
          const { data: company } = await supabase
            .from("companies")
            .upsert(
              {
                name: item.employer_name,
                website: item.employer_website || null,
                logo_url: item.employer_logo || null,
                enrichment_status: "pending",
              },
              { onConflict: "domain", ignoreDuplicates: true }
            )
            .select("id")
            .maybeSingle();
          companyId = company?.id;
        }

        await supabase.from("jobs").insert({
          external_id: String(externalId),
          source: "google_jobs",
          title: item.job_title || "Unknown",
          description: item.job_description || null,
          company_id: companyId,
          company_name: item.employer_name || null,
          location_raw: `${item.job_city || ""}, ${item.job_state || ""}, ${item.job_country || ""}`.trim().replace(/^,\s*|,\s*$/g, ""),
          location_city: item.job_city || null,
          location_state: item.job_state || null,
          location_country: item.job_country || null,
          employment_type: mapEmploymentType(item.job_employment_type),
          salary_min: item.job_min_salary || null,
          salary_max: item.job_max_salary || null,
          salary_currency: item.job_salary_currency || null,
          posted_at: item.job_posted_at_datetime_utc || null,
          application_url: item.job_apply_link || null,
          source_url: item.job_google_link || null,
          enrichment_status: item.job_description ? "partial" : "pending",
          raw_data: item,
        });

        processed++;
      } catch (e) {
        failed++;
      }
    }

    // Rate limit between pages
    if (page < numPages) await new Promise(r => setTimeout(r, 1000));
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

async function executeJDEnrichment(runId: string, config: any) {
  const batchSize = parseInt(config.batch_size) || 100;
  const statusFilter = config.status || "pending";

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
  for (const job of jobs) {
    // Basic keyword extraction (stub for GPT-4o mini)
    const skills = extractSkillsKeyword(job.description || "");

    for (const skill of skills) {
      await supabase.from("job_skills").insert({
        job_id: job.id,
        skill_name: skill,
        skill_category: categorizeSkill(skill),
        confidence_score: 0.7,
        extraction_method: "keyword",
      });
    }

    await supabase.from("jobs").update({ enrichment_status: "complete" }).eq("id", job.id);
    processed++;
  }

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
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
