import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission, requireReader } from "../lib/auth";
import { supabase, APIFY_API_KEY, OPENAI_API_KEY } from "../lib/supabase";
import { callGPT } from "../lib/openai";
import { submitJDBatch, pollBatch, processBatchResults } from "../lib/batch";
import { normalizeText, mapEmploymentType, mapEmploymentTypeExtended, mapSeniority, mapOnetJobZone, upsertCompanyByName, findEducationEntry, formatUniversityName, mapPersonSeniority, mapPersonFunction, generatePeopleSearchStub, computeRoleMatchScore, mapBaytJob, mapNaukriGulfJob, mapBaytCareerLevel } from "../lib/helpers";
import { randomUUID } from "crypto";
import { runAnalyzeJd } from "../lib/analyze-jd";

export async function handlePipelineRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  // ==================== PIPELINES ====================
  if (!requireReader(auth, "pipelines", res)) return;

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
    if (!requirePermission("pipelines", "full")(auth, res)) return;

    // Auto-kill zombie runs (running > 30 min)
    await supabase.from("pipeline_runs")
      .update({ status: "failed", error: "Auto-killed: exceeded 30 min timeout", completed_at: new Date().toISOString() })
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

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

      // Build common Apify filters from config
      const commonInput: Record<string, any> = {
        location: config?.location || "India",
        maxPages: Math.ceil((parseInt(config?.limit) || 100) / 10),
      };
      if (config?.date_posted && timePostedMap[config.date_posted]) {
        commonInput.timePosted = timePostedMap[config.date_posted];
      }
      if (config?.experience_level) {
        commonInput.experienceLevel = config.experience_level.split(",").filter(Boolean);
      }
      if (config?.work_type) {
        commonInput.workType = config.work_type.split(",").filter(Boolean);
      }
      if (config?.work_location) {
        commonInput.workLocation = config.work_location.split(",").filter(Boolean);
      }
      if (config?.industry_ids) {
        commonInput.industryIds = config.industry_ids.split(",").filter(Boolean);
      }
      if (config?.company_names) {
        commonInput.companyNames = config.company_names.split(",").filter(Boolean);
      }
      if (config?.fetch_description !== undefined) {
        commonInput.fetchDescription = !!config.fetch_description;
      }
      if (config?.easy_apply_only) {
        commonInput.easyApplyOnly = true;
      }
      if (config?.sort_by) {
        commonInput.sortBy = config.sort_by;
      }

      // Build keyword queries: one Apify run per role, or single run for free-text
      const jobRoleIds = config?.job_role_ids as string[] | undefined;
      let runs: { keywords: string; roleId?: string; roleName?: string }[] = [];

      if (jobRoleIds && jobRoleIds.length > 0) {
        const { data: roles } = await supabase
          .from("job_roles")
          .select("id, name, synonyms")
          .in("id", jobRoleIds);
        if (roles && roles.length > 0) {
          // One run per role — each role's synonyms combined with OR (~200 chars, well within 1000 limit)
          runs = roles.map(r => ({
            keywords: ((r.synonyms as string[]) || []).map(s => `"${s}"`).join(" OR "),
            roleId: r.id,
            roleName: r.name,
          }));
        }
      }
      // Fallback: free-text keywords as single run
      if (runs.length === 0) {
        runs = [{ keywords: config?.search_keywords || config?.keywords || "software engineer" }];
      }

      // Launch first run (primary — tracked in pipeline_runs)
      const firstRun = runs[0];
      const actorInput = { ...commonInput, keywords: firstRun.keywords };
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

      // Launch additional runs for remaining roles (fire-and-forget, tracked in config)
      const additionalRuns: { roleId?: string; roleName?: string; runId?: string; datasetId?: string }[] = [];
      if (runs.length > 1) {
        for (const run of runs.slice(1)) {
          try {
            const res2 = await fetch(
              `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs?token=${APIFY_API_KEY}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...commonInput, keywords: run.keywords }) }
            );
            if (res2.ok) {
              const d = await res2.json();
              additionalRuns.push({ roleId: run.roleId, roleName: run.roleName, runId: d.data?.id, datasetId: d.data?.defaultDatasetId });
            }
          } catch (e) { /* continue with other roles */ }
        }
      }

      // Store all role metadata in config for later result processing
      config._job_roles = runs.map((r, i) => ({
        id: r.roleId, name: r.roleName,
        ...(i === 0 ? { runId: providerRunId, datasetId: providerDatasetId } : additionalRuns[i - 1] || {}),
      }));
      if (additionalRuns.length > 0) {
        config._additional_runs = additionalRuns;
      }
    }

    // Alumni pipeline: Apify LinkedIn profile search by university
    if (pipeline_type === "alumni") {
      if (!APIFY_API_KEY) return res.status(400).json({ error: "Apify API key not configured" });

      // Build search queries from college master list
      // Strategy: use college name as searchQuery (NOT schoolUrls — tested 90% accuracy)
      // + post-scrape education validation for 100% accuracy
      let collegeNames: string[] = [];
      let collegeConfig: any[] = [];
      
      if (config?.college_ids && Array.isArray(config.college_ids) && config.college_ids.length > 0) {
        const { data: colleges } = await supabase
          .from("colleges")
          .select("id, name, short_name, degree_level, linkedin_slug")
          .in("id", config.college_ids);
        if (colleges && colleges.length > 0) {
          collegeConfig = colleges;
          collegeNames = colleges.map((c: any) => {
            const degree = c.degree_level || config?.degree_filter || "";
            return `${c.short_name || c.name} ${degree}`.trim();
          });
        }
      } else if (config?.university_slug) {
        collegeNames = config.university_slug.split(",").map((s: string) => s.trim());
      }
      if (collegeNames.length === 0) {
        return res.status(400).json({ error: "Select colleges from the master list." });
      }

      // Store college info for traceability and post-scrape validation
      config._colleges = collegeConfig;
      config._college_names = collegeNames;
      config._validation_enabled = true;

      // Build actor input — one run per college for best results
      // Use searchQuery with college name (90%+ match rate, validated to 100% post-scrape)
      // IMPORTANT: field names must match harvestapi/linkedin-profile-search schema exactly
      const firstCollege = collegeNames[0];
      const requestedMode = config?.scraper_mode;
      // Must be "Full" or "Full + email search" to get education data for validation
      const profileScraperMode = (requestedMode === "Full + email search" || requestedMode === "Full") ? requestedMode : "Full";
      const actorInput: Record<string, any> = {
        searchQuery: config?.search_query || firstCollege,
        profileScraperMode,
        startPage: 1,
        takePages: parseInt(config?.pages) || 5,
        maxItems: parseInt(config?.max_profiles) || 0,
      };
      // Target profile filters
      if (config?.current_job_titles?.length) actorInput.currentJobTitles = config.current_job_titles;
      if (config?.past_job_titles?.length) actorInput.pastJobTitles = config.past_job_titles;
      if (config?.locations?.length) actorInput.locations = config.locations;
      // Actor expects these as arrays of STRINGS (not numbers) — coerce defensively
      if (config?.years_of_experience_ids?.length) actorInput.yearsOfExperienceIds = config.years_of_experience_ids.map(String);
      if (config?.seniority_level_ids?.length) actorInput.seniorityLevelIds = config.seniority_level_ids.map(String);
      if (config?.function_ids?.length) actorInput.functionIds = config.function_ids.map(String);
      if (config?.current_companies?.length) actorInput.currentCompanies = config.current_companies;
      if (config?.past_companies?.length) actorInput.pastCompanies = config.past_companies;
      if (config?.company_headcount?.length) actorInput.companyHeadcount = config.company_headcount;
      if (config?.recently_changed_jobs) actorInput.recentlyChangedJobs = true;
      if (config?.industry_ids?.length) actorInput.industryIds = config.industry_ids.map(String);
      if (config?.first_names?.length) actorInput.firstNames = config.first_names;
      if (config?.last_names?.length) actorInput.lastNames = config.last_names;
      // Exclusions
      if (config?.exclude_locations?.length) actorInput.excludeLocations = config.exclude_locations;
      if (config?.exclude_current_companies?.length) actorInput.excludeCurrentCompanies = config.exclude_current_companies;
      if (config?.exclude_schools?.length) actorInput.excludeSchools = config.exclude_schools;

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

      // Launch additional runs for remaining colleges
      if (collegeNames.length > 1) {
        const additionalRuns: any[] = [];
        for (const college of collegeNames.slice(1)) {
          try {
            const input2 = { ...actorInput, searchQuery: config?.search_query || college };
            const res2 = await fetch(
              `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/runs?token=${APIFY_API_KEY}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input2) }
            );
            if (res2.ok) {
              const d = await res2.json();
              additionalRuns.push({ college, runId: d.data?.id, datasetId: d.data?.defaultDatasetId });
            }
          } catch {}
        }
        config._additional_alumni_runs = additionalRuns;
      }
    }

    // Alumni Bulk Upload: scrape specific LinkedIn profile URLs from CSV
    if (pipeline_type === "alumni_bulk_upload") {
      if (!APIFY_API_KEY) return res.status(400).json({ error: "Apify API key not configured" });

      const urls = config?.urls;
      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: "urls array is required" });
      }

      // Resolve college info for education validation
      let universityName = config?.college_name || "Unknown";
      let collegeConfig: any[] = [];
      let collegeNames: string[] = [universityName];

      if (config?.college_id) {
        const { data: college } = await supabase
          .from("colleges")
          .select("id, name, short_name, degree_level")
          .eq("id", config.college_id)
          .single();
        if (college) {
          universityName = college.name;
          collegeConfig = [college];
          // Include BOTH full name AND short name — LinkedIn uses full name, pattern expander needs it
          collegeNames = Array.from(new Set([college.name, college.short_name].filter(Boolean)));
        }
      }

      config.university_name = universityName;
      config._colleges = collegeConfig;
      config._college_names = collegeNames;
      config._validation_enabled = true;

      // Filter to valid LinkedIn profile URLs
      const cleanUrls = urls
        .filter((u: string) => u && u.includes("linkedin.com/in/"))
        .map((u: string) => u.trim());

      if (cleanUrls.length === 0) {
        return res.status(400).json({ error: "No valid LinkedIn profile URLs found" });
      }

      config._total_urls = cleanUrls.length;

      // Start Apify profile scraper — actor expects `queries` array of URL strings
      const validBulkModes = ["Profile details no email ($4 per 1k)", "Profile details + email search ($10 per 1k)"];
      const requestedBulkMode = config?.profile_scraper_mode;
      const bulkProfileScraperMode = validBulkModes.includes(requestedBulkMode) ? requestedBulkMode : validBulkModes[0];
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-scraper/runs?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queries: cleanUrls,
            profileScraperMode: bulkProfileScraperMode,
          }),
        }
      );
      if (!startRes.ok) {
        const errText = await startRes.text();
        return res.status(500).json({ error: `Apify bulk upload start failed: ${errText}` });
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
    if (pipeline_type === "company_enrichment" || pipeline_type === "jd_enrichment" || pipeline_type === "jd_fetch" || pipeline_type === "people_enrichment" || pipeline_type === "jd_batch_submit" || pipeline_type === "jd_batch_poll") {
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

    // Middle East job source pipelines — same async fire-and-forget pattern as LinkedIn
    if (pipeline_type === "bayt_jobs" || pipeline_type === "naukrigulf_jobs") {
      executePipeline(run.id, pipeline_type, config || {}).catch(console.error);
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
      alumni_bulk_upload: "harvestapi~linkedin-profile-scraper",
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
      let chunkResult: { done: boolean; remaining?: number } | undefined;
      if (run.pipeline_type === "linkedin_jobs") {
        // Recover role context from config._job_roles (primary run is first entry)
        const jobRolesMeta = (run.config?._job_roles as any[]) || [];
        const primaryRole = jobRolesMeta[0];
        let runMeta: any = undefined;
        if (primaryRole?.id) {
          // Re-fetch synonyms for match scoring
          const { data: roleRow } = await supabase.from("job_roles").select("synonyms").eq("id", primaryRole.id).maybeSingle();
          runMeta = {
            roleId: primaryRole.id,
            roleName: primaryRole.name,
            synonyms: (roleRow?.synonyms as string[]) || [],
          };
        }
        await processLinkedInResults(id, dsId, run.config, runMeta);
      } else if (run.pipeline_type === "alumni" || run.pipeline_type === "alumni_bulk_upload") {
        // Chunked processing: each /poll call processes up to ALUMNI_CHUNK_SIZE profiles
        // and returns. The status stays 'running' until all profiles are done.
        // This is required because Vercel's serverless functions are capped at 300s
        // (see vercel.json maxDuration), and a 10K-profile run cannot finish in one call.
        chunkResult = await processAlumniResults(id, dsId, run.config, ALUMNI_CHUNK_SIZE);
      }
      const { data: updated } = await supabase.from("pipeline_runs").select("*").eq("id", id).single();

      // If the alumni chunk has more work remaining, kick off the next chunk
      // before returning. We must AWAIT the dispatch (just not the response body)
      // because Vercel suspends the function instance the moment we return —
      // an unawaited fetch() never gets its TCP handshake out. Use AbortController
      // with a short timeout so we wait only long enough for the next instance to
      // accept the connection, not for it to finish processing.
      if (chunkResult && !chunkResult.done && req.headers.host) {
        const proto = (req.headers["x-forwarded-proto"] as string) || "https";
        const selfUrl = `${proto}://${req.headers.host}/api/pipelines/${id}/poll`;
        const authHeader = (req.headers.authorization as string) || "";
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3000);
        try {
          await fetch(selfUrl, {
            method: "POST",
            headers: authHeader ? { authorization: authHeader } : {},
            signal: ac.signal,
          });
        } catch {
          // Expected: aborted after 3s. The downstream invocation has already
          // accepted the request and is processing independently.
        } finally {
          clearTimeout(timer);
        }
      }
      return res.json(updated);
    }

    return res.json(run);
  }

  // ==================== BULK DISPATCH ====================
  // POST /pipelines/jobs/bulk-dispatch
  // Fan-out across (country × experience_level × city) — one pipeline_run per combination.
  // All 30 job_role_ids are embedded in every run; executeLinkedInJobs fans them out per role.
  if (path === "/pipelines/jobs/bulk-dispatch" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return

    const {
      job_role_ids,
      countries,
      experience_levels,
      cities,
      date_posted = "past_month",
      fetch_description,
    } = req.body || {}

    if (!Array.isArray(job_role_ids) || job_role_ids.length === 0)
      return res.status(400).json({ error: "job_role_ids is required" })
    if (!Array.isArray(countries) || countries.length === 0)
      return res.status(400).json({ error: "countries is required" })
    if (!Array.isArray(experience_levels) || experience_levels.length === 0)
      return res.status(400).json({ error: "experience_levels is required" })

    const bulkDispatchId = randomUUID()
    const runRows: { run_id: string; country: string; city: string | null; exp: string }[] = []
    const insertErrors: string[] = []

    for (const country of countries) {
      const citiesForCountry: string[] | undefined = cities?.[country]
      const locations: string[] = citiesForCountry && citiesForCountry.length > 0
        ? citiesForCountry
        : [country]

      for (const exp of experience_levels) {
        for (const location of locations) {
          const isCity = citiesForCountry && citiesForCountry.length > 0
          const config: Record<string, any> = {
            job_role_ids,
            experience_level: exp,
            location,
            date_posted,
            fetch_description: !!fetch_description,
            _bulk_dispatch_id: bulkDispatchId,
            _bulk_meta: { country, city: isCity ? location : null, exp },
          }

          const { data: run, error: insertErr } = await supabase
            .from("pipeline_runs")
            .insert({
              pipeline_type: "linkedin_jobs",
              trigger_type: "manual",
              status: "pending",
              config,
              started_at: new Date().toISOString(),
              triggered_by: "bulk_dispatch",
            })
            .select("id")
            .single()

          if (insertErr || !run) {
            insertErrors.push(`${country}/${location}/${exp}: ${insertErr?.message || "unknown"}`)
            continue
          }

          runRows.push({ run_id: run.id, country, city: isCity ? location : null, exp })

          // Fire-and-forget — do not await
          executePipeline(run.id, "linkedin_jobs", config).catch(console.error)
        }
      }
    }

    return res.json({
      bulk_dispatch_id: bulkDispatchId,
      dispatched: runRows.length,
      runs: runRows,
      ...(insertErrors.length > 0 ? { errors: insertErrors } : {}),
    })
  }

  // ==================== DISCOVERY SWEEP ====================
  // POST /pipelines/jobs/discovery-sweep
  // Launches exploratory jobs collection across domain keywords and industry queries,
  // independently of the known job_roles list, to surface new title candidates.
  if (path === "/pipelines/jobs/discovery-sweep" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return

    const {
      countries,
      experience_levels = ["1", "2", "3"],
      date_posted = "past_month",
      domain_keywords = ["engineer", "manager", "analyst", "designer", "developer", "specialist", "consultant", "lead", "architect", "scientist", "researcher", "executive"],
      industry_queries = ["fintech", "edtech", "healthtech", "saas", "ecommerce", "logistics", "manufacturing", "retail", "banking", "insurance", "media", "telecom", "energy", "real estate", "consulting", "government", "aerospace", "automotive", "pharmaceutical", "hospitality"],
      fetch_description,
    } = req.body || {}

    if (!Array.isArray(countries) || countries.length === 0)
      return res.status(400).json({ error: "countries is required" })

    const expJoined = (experience_levels as string[]).join(",")
    const runRows: { run_id: string; discovery_run_id: string; country: string; query: string; run_type: string }[] = []
    const insertErrors: string[] = []

    for (const country of countries) {
      // Domain-keyword queries
      for (const keyword of (domain_keywords as string[])) {
        const { data: discRun, error: drErr } = await supabase
          .from("discovery_runs")
          .insert({
            run_type: "domain",
            country,
            query: keyword,
            source: "linkedin",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single()

        if (drErr || !discRun) {
          insertErrors.push(`discovery_runs domain ${country}/${keyword}: ${drErr?.message || "unknown"}`)
          continue
        }

        const config: Record<string, any> = {
          keywords: keyword,
          location: country,
          experience_level: expJoined,
          date_posted,
          discovery_source: "domain_sweep",
          _discovery_run_id: discRun.id,
          fetch_description: !!fetch_description,
        }

        const { data: pRun, error: prErr } = await supabase
          .from("pipeline_runs")
          .insert({
            pipeline_type: "linkedin_jobs",
            trigger_type: "manual",
            status: "pending",
            config,
            started_at: new Date().toISOString(),
            triggered_by: "discovery_sweep",
          })
          .select("id")
          .single()

        if (prErr || !pRun) {
          insertErrors.push(`pipeline_runs domain ${country}/${keyword}: ${prErr?.message || "unknown"}`)
          continue
        }

        // Link pipeline_run back to discovery_run
        await supabase.from("discovery_runs").update({ pipeline_run_id: pRun.id }).eq("id", discRun.id)

        runRows.push({ run_id: pRun.id, discovery_run_id: discRun.id, country, query: keyword, run_type: "domain" })
        executePipeline(pRun.id, "linkedin_jobs", config).catch(console.error)
      }

      // Industry-query queries
      for (const industry of (industry_queries as string[])) {
        const { data: discRun, error: drErr } = await supabase
          .from("discovery_runs")
          .insert({
            run_type: "industry",
            country,
            query: industry,
            source: "linkedin",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single()

        if (drErr || !discRun) {
          insertErrors.push(`discovery_runs industry ${country}/${industry}: ${drErr?.message || "unknown"}`)
          continue
        }

        const discoverySource = `industry_sweep:${industry}`
        const config: Record<string, any> = {
          keywords: industry,
          location: country,
          experience_level: expJoined,
          date_posted,
          discovery_source: discoverySource,
          _discovery_run_id: discRun.id,
          fetch_description: !!fetch_description,
        }

        const { data: pRun, error: prErr } = await supabase
          .from("pipeline_runs")
          .insert({
            pipeline_type: "linkedin_jobs",
            trigger_type: "manual",
            status: "pending",
            config,
            started_at: new Date().toISOString(),
            triggered_by: "discovery_sweep",
          })
          .select("id")
          .single()

        if (prErr || !pRun) {
          insertErrors.push(`pipeline_runs industry ${country}/${industry}: ${prErr?.message || "unknown"}`)
          continue
        }

        await supabase.from("discovery_runs").update({ pipeline_run_id: pRun.id }).eq("id", discRun.id)

        runRows.push({ run_id: pRun.id, discovery_run_id: discRun.id, country, query: industry, run_type: "industry" })
        executePipeline(pRun.id, "linkedin_jobs", config).catch(console.error)
      }
    }

    return res.json({
      discovery_runs: runRows.length,
      dispatched: runRows.length,
      runs: runRows,
      ...(insertErrors.length > 0 ? { errors: insertErrors } : {}),
    })
  }

  // ==================== RECOVER MULTI-ROLE BULK RUNS ====================
  // POST /pipelines/jobs/recover-bulk-roles
  // For pipeline_runs created with 30 job_role_ids via /pipelines/run, the standard
  // /poll endpoint only harvests the primary Apify dataset — the other 29 (stored in
  // config._additional_runs) are silently dropped. This endpoint iterates ALL the
  // role datasets, polls Apify per-role, harvests succeeded ones, and accumulates
  // counts properly. Idempotent — safe to re-run; processLinkedInResults UPSERTs jobs.
  if (path === "/pipelines/jobs/recover-bulk-roles" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return

    const { run_ids } = req.body || {}
    if (!Array.isArray(run_ids) || run_ids.length === 0) {
      return res.status(400).json({ error: "run_ids array is required" })
    }

    const summary: any[] = []

    for (const runId of run_ids) {
      const { data: run, error: runErr } = await supabase.from("pipeline_runs").select("*").eq("id", runId).single()
      if (runErr || !run) {
        summary.push({ run_id: runId, ok: false, error: "run not found" })
        continue
      }
      if (run.pipeline_type !== "linkedin_jobs") {
        summary.push({ run_id: runId, ok: false, error: `unsupported pipeline_type ${run.pipeline_type}` })
        continue
      }

      const cfg = run.config || {}
      // Build complete role-run list: primary + additional
      const primary = {
        runId: cfg._provider_run_id,
        datasetId: cfg._provider_dataset_id,
        roleId: (cfg._job_roles as any[])?.[0]?.id,
        roleName: (cfg._job_roles as any[])?.[0]?.name,
      }
      const additional = (cfg._additional_runs as any[]) || []
      const allRoleRuns = [primary, ...additional].filter(r => r.runId && r.datasetId)

      // Pre-fetch synonyms for all roles in one query
      const roleIds = allRoleRuns.map(r => r.roleId).filter(Boolean) as string[]
      const synMap = new Map<string, string[]>()
      if (roleIds.length > 0) {
        const { data: roles } = await supabase.from("job_roles").select("id, synonyms").in("id", roleIds)
        for (const r of roles || []) synMap.set(r.id as string, (r.synonyms as string[]) || [])
      }

      let totalProcessed = 0
      let totalItems = 0
      let succeededRoles = 0
      let runningRoles = 0
      let failedRoles = 0
      const roleErrors: string[] = []

      for (const rr of allRoleRuns) {
        try {
          const apifyRes = await fetch(
            `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs/${rr.runId}?token=${APIFY_API_KEY}`
          )
          const apifyData = await apifyRes.json()
          const st = apifyData.data?.status
          if (st === "RUNNING" || st === "READY") { runningRoles++; continue }
          if (st !== "SUCCEEDED") { failedRoles++; continue }

          // Count items in dataset before harvest (for total tracking)
          const dsId = rr.datasetId || apifyData.data?.defaultDatasetId
          if (!dsId) { failedRoles++; continue }

          // Snapshot processed_items before this harvest so we can compute delta
          const { data: pre } = await supabase.from("pipeline_runs").select("processed_items, total_items").eq("id", runId).single()
          const preProcessed = (pre?.processed_items as number) || 0
          const preTotal = (pre?.total_items as number) || 0

          await processLinkedInResults(runId, dsId, cfg, {
            roleId: rr.roleId, roleName: rr.roleName,
            synonyms: synMap.get(rr.roleId as string) || [],
            discoverySource: cfg.discovery_source || null,
          } as any)

          // processLinkedInResults wrote: processed_items=<this role's processed>, total_items=<this role's total>
          // We need to ADD them to the pre-existing values. Read what it wrote, then accumulate.
          const { data: post } = await supabase.from("pipeline_runs").select("processed_items, total_items").eq("id", runId).single()
          const thisProcessed = (post?.processed_items as number) || 0
          const thisTotal = (post?.total_items as number) || 0

          const newProcessed = preProcessed + thisProcessed
          const newTotal = preTotal + thisTotal
          await supabase.from("pipeline_runs").update({
            processed_items: newProcessed,
            total_items: newTotal,
          }).eq("id", runId)

          totalProcessed = newProcessed
          totalItems = newTotal
          succeededRoles++
        } catch (err: any) {
          failedRoles++
          roleErrors.push(`${rr.roleName || rr.roleId}: ${err.message}`)
        }
      }

      // Mark run completed only if no roles still running
      const finalStatus = runningRoles > 0 ? "running" : "completed"
      await supabase.from("pipeline_runs").update({
        status: finalStatus,
        processed_items: totalProcessed,
        total_items: totalItems,
        completed_at: runningRoles > 0 ? null : new Date().toISOString(),
        ...(roleErrors.length > 0 ? { error_message: roleErrors.slice(0, 5).join(" | ") } : {}),
      }).eq("id", runId)

      summary.push({
        run_id: runId,
        ok: true,
        roles_total: allRoleRuns.length,
        succeeded: succeededRoles,
        running: runningRoles,
        failed: failedRoles,
        processed_items: totalProcessed,
        total_items: totalItems,
        final_status: finalStatus,
      })
    }

    return res.json({ summary })
  }

  // ==================== BULK BACKFILL (CHUNKED, RESUMABLE) ====================
  // POST /pipelines/jobs/bulk-backfill
  // Server-side resumable backfill. First call creates pipeline_runs for every
  // (country x city x experience) combo, tagged with _backfill_id and
  // _backfill_status='pending'. Then processes chunk_size combos synchronously
  // inside the request (waits for executeLinkedInJobs to finish each one) so we
  // never lose a run to Vercel timeout. Returns { backfill_id, processed, remaining }.
  // Re-call with the same backfill_id to drain more.
  if (path === "/pipelines/jobs/bulk-backfill" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return

    const {
      job_role_ids,
      countries,
      cities,
      experience_levels,
      date_posted = "past_month",
      fetch_description,
      chunk_size = 4,
      backfill_id: existingBackfillId,
    } = req.body || {}

    let backfillId = existingBackfillId as string | undefined

    // FIRST CALL: create all combos as pending pipeline_runs
    if (!backfillId) {
      if (!Array.isArray(job_role_ids) || job_role_ids.length === 0)
        return res.status(400).json({ error: "job_role_ids is required" })
      if (!Array.isArray(countries) || countries.length === 0)
        return res.status(400).json({ error: "countries is required" })
      if (!Array.isArray(experience_levels) || experience_levels.length === 0)
        return res.status(400).json({ error: "experience_levels is required" })

      backfillId = randomUUID()
      const insertErrors: string[] = []
      let created = 0

      for (const country of countries) {
        const citiesForCountry: string[] | undefined = cities?.[country]
        const locations: string[] = citiesForCountry && citiesForCountry.length > 0
          ? citiesForCountry
          : [country]

        for (const exp of experience_levels) {
          for (const location of locations) {
            const isCity = citiesForCountry && citiesForCountry.length > 0
            const config: Record<string, any> = {
              job_role_ids,
              experience_level: exp,
              location,
              date_posted,
              fetch_description: !!fetch_description,
              _backfill_id: backfillId,
              _backfill_status: "pending",
              _backfill_meta: { country, city: isCity ? location : null, exp },
            }

            const { error: insertErr } = await supabase
              .from("pipeline_runs")
              .insert({
                pipeline_type: "linkedin_jobs",
                trigger_type: "manual",
                status: "pending",
                config,
                started_at: new Date().toISOString(),
                triggered_by: "bulk_backfill",
              })

            if (insertErr) {
              insertErrors.push(`${country}/${location}/${exp}: ${insertErr.message}`)
            } else {
              created++
            }
          }
        }
      }

      return res.json({
        backfill_id: backfillId,
        created,
        phase: "queued",
        next: `POST /pipelines/jobs/bulk-backfill with backfill_id=${backfillId} to start draining`,
        ...(insertErrors.length > 0 ? { errors: insertErrors } : {}),
      })
    }

    // RESUME CALL: drain up to chunk_size pending combos
    const { data: pendingRuns, error: fetchErr } = await supabase
      .from("pipeline_runs")
      .select("id, config")
      .eq("config->>_backfill_id", backfillId)
      .eq("config->>_backfill_status", "pending")
      .order("started_at", { ascending: true })
      .limit(Math.max(1, Math.min(20, chunk_size)))

    if (fetchErr) return res.status(500).json({ error: fetchErr.message })

    const processed: any[] = []
    const failed: any[] = []

    for (const run of (pendingRuns || [])) {
      // Mark in-progress so a parallel call doesn't pick it up
      await supabase
        .from("pipeline_runs")
        .update({ config: { ...run.config, _backfill_status: "running" }, status: "running" })
        .eq("id", run.id)

      try {
        // Synchronously drive the full pipeline. executeLinkedInJobs will:
        //  - launch all 30 Apify runs for the role list
        //  - poll + harvest each
        //  - persist all jobs, role_match_score, last_seen_at, raw_data
        await executePipeline(run.id, "linkedin_jobs", run.config)

        // Re-read the now-final state to record processed_items
        const { data: finalRun } = await supabase
          .from("pipeline_runs")
          .select("processed_items, total_items, config, status")
          .eq("id", run.id)
          .single()

        await supabase
          .from("pipeline_runs")
          .update({ config: { ...(finalRun?.config || run.config), _backfill_status: "done" } })
          .eq("id", run.id)

        processed.push({
          run_id: run.id,
          location: run.config?.location,
          exp: run.config?.experience_level,
          processed_items: finalRun?.processed_items,
          total_items: finalRun?.total_items,
          status: finalRun?.status,
        })
      } catch (e: any) {
        await supabase
          .from("pipeline_runs")
          .update({
            config: { ...run.config, _backfill_status: "failed", _backfill_error: e?.message || String(e) },
            status: "failed",
            error_message: e?.message || String(e),
          })
          .eq("id", run.id)
        failed.push({ run_id: run.id, error: e?.message || String(e) })
      }
    }

    const { count: remaining } = await supabase
      .from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .eq("config->>_backfill_id", backfillId)
      .eq("config->>_backfill_status", "pending")

    return res.json({
      backfill_id: backfillId,
      processed_count: processed.length,
      failed_count: failed.length,
      remaining: remaining || 0,
      processed,
      ...(failed.length > 0 ? { failed } : {}),
      phase: (remaining || 0) > 0 ? "draining" : "complete",
    })
  }

  // ==================== DISCOVERY HARVEST ====================
  // POST /pipelines/jobs/discovery-harvest
  // Reads jobs collected by discovery sweep pipeline_runs, extracts titles not
  // covered by any known job_role or synonym, and upserts into discovered_titles.
  if (path === "/pipelines/jobs/discovery-harvest" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return

    const { discovery_run_id } = req.body || {}

    // Determine which discovery_runs to harvest
    let discRunsToHarvest: any[] = []

    if (discovery_run_id) {
      const { data, error } = await supabase
        .from("discovery_runs")
        .select("*")
        .eq("id", discovery_run_id)
        .single()
      if (error || !data) return res.status(404).json({ error: "discovery_run not found" })
      discRunsToHarvest = [data]
    } else {
      // Harvest all running discovery_runs whose linked pipeline_run is completed
      const { data: running } = await supabase
        .from("discovery_runs")
        .select("*, pipeline_runs!pipeline_run_id(status)")
        .eq("status", "running")
      if (running && running.length > 0) {
        discRunsToHarvest = running.filter((dr: any) => {
          const pRun = dr.pipeline_runs
          return pRun && (pRun.status === "completed" || pRun.status === "succeeded")
        })
      }
    }

    if (discRunsToHarvest.length === 0)
      return res.json({ harvested: 0, new_titles_total: 0, errors: [] })

    // Build set of all known role strings (names + synonyms) once
    const { data: roleRows } = await supabase
      .from("job_roles")
      .select("name, synonyms")

    const knownStrings = new Set<string>()
    for (const r of (roleRows || [])) {
      if (r.name) knownStrings.add(r.name.toLowerCase())
      if (Array.isArray(r.synonyms)) {
        for (const s of r.synonyms) {
          if (s) knownStrings.add(s.toLowerCase())
        }
      }
    }

    let harvestedCount = 0
    let newTitlesTotal = 0
    const harvestErrors: string[] = []

    for (const discRun of discRunsToHarvest) {
      try {
        // Find the linked pipeline_run via discovery_runs.pipeline_run_id or config fallback
        let pipelineRunId: string | null = discRun.pipeline_run_id || null
        if (!pipelineRunId) {
          // Fallback: search pipeline_runs by config._discovery_run_id
          const { data: fallback } = await supabase
            .from("pipeline_runs")
            .select("id")
            .filter("config->>_discovery_run_id", "eq", discRun.id)
            .maybeSingle()
          pipelineRunId = fallback?.id || null
        }

        if (!pipelineRunId) {
          harvestErrors.push(`${discRun.id}: no linked pipeline_run found`)
          continue
        }

        // Fetch location from the pipeline_run config
        const { data: pRunRow } = await supabase
          .from("pipeline_runs")
          .select("config")
          .eq("id", pipelineRunId)
          .single()
        const locationFromConfig: string = pRunRow?.config?.location || discRun.country || ""

        // Fetch all jobs inserted by this pipeline_run.
        // jobs has no FK to pipeline_runs; we store the linkage in raw_data._pipeline_run_id
        // (written by processLinkedInResults / executeGoogleJobs at insert time).
        const { data: jobs } = await supabase
          .from("jobs")
          .select("title, title_normalized")
          .filter("raw_data->>_pipeline_run_id", "eq", pipelineRunId)

        let jobsFound = 0
        let newTitles = 0

        for (const job of (jobs || [])) {
          jobsFound++
          const rawTitle: string = job.title || ""
          const normTitle: string = job.title_normalized || rawTitle
          const checkStr = (normTitle + " " + rawTitle).toLowerCase()

          // Check if any known string appears in the job title
          let matched = false
          for (const known of knownStrings) {
            if (checkStr.includes(known)) {
              matched = true
              break
            }
          }

          if (!matched) {
            // Upsert into discovered_titles
            const { error: upsertErr } = await supabase
              .from("discovered_titles")
              .upsert(
                {
                  title: rawTitle,
                  normalized_title: normTitle,
                  country: locationFromConfig,
                  source: "linkedin",
                  run_id: discRun.id,
                  observed_count: 1,
                  last_seen_at: new Date().toISOString(),
                },
                {
                  onConflict: "normalized_title,country,source",
                  ignoreDuplicates: false,
                }
              )
            if (upsertErr) {
              harvestErrors.push(`upsert ${normTitle}: ${upsertErr.message}`)
            } else {
              newTitles++
            }
          }
        }

        // For upserts that were updates (conflict), increment observed_count
        // Supabase upsert merges — handle count increment via RPC or separate update
        // Using a targeted update: increment observed_count for rows that already exist
        // (they were touched above; now bump count for existing ones only via updated_at heuristic)
        // Simpler: do a raw increment update on all rows for this location/source just touched
        await supabase.rpc("increment_discovered_title_counts", {
          p_run_id: discRun.id,
          p_country: locationFromConfig,
          p_source: "linkedin",
        }).then(() => {}).catch(() => {
          // RPC may not exist yet — safe to ignore, observed_count starts at 1 on insert
        })

        // Mark discovery_run as succeeded
        await supabase
          .from("discovery_runs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            jobs_found: jobsFound,
            new_titles: newTitles,
          })
          .eq("id", discRun.id)

        harvestedCount++
        newTitlesTotal += newTitles
      } catch (err: any) {
        harvestErrors.push(`${discRun.id}: ${err.message}`)
        await supabase
          .from("discovery_runs")
          .update({ status: "failed", error_message: err.message, finished_at: new Date().toISOString() })
          .eq("id", discRun.id)
      }
    }

    return res.json({ harvested: harvestedCount, new_titles_total: newTitlesTotal, errors: harvestErrors })
  }

  if (path.match(/^\/pipelines\/[^/]+$/) && !path.includes("run") && !path.includes("execute") && !path.includes("cancel") && req.method === "GET") {
    const id = path.split("/").pop();
    const { data, error } = await supabase.from("pipeline_runs").select("*").eq("id", id).single();
    if (error) return res.status(404).json({ error: "Pipeline run not found" });
    return res.json(data);
  }

  if (path.match(/^\/pipelines\/[^/]+\/cancel$/) && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return;
    const id = path.split("/")[2];
    const { error } = await supabase
      .from("pipeline_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // ==================== MONITORING ====================
  if (path === "/monitoring/queue-stats" && req.method === "GET") {
    const [{ count: pendingCount }, { count: processingCount }, { count: deadLetterCount }] = await Promise.all([
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "processing"),
      supabase.from("job_queue").select("*", { count: "exact", head: true }).eq("status", "dead_letter"),
    ]);

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

  // Settings routes handled in api/routes/settings.ts

  // ==================== DISCOVERED TITLES ====================
  // Surfaces titles found during discovery sweeps that didn't match any existing job_role.
  // Admin can promote (create a new job_role) or ignore them.

  // GET /discovered-titles?status=&country=&search=&page=&limit=
  if (path === "/discovered-titles" && req.method === "GET") {
    if (!requireReader(auth, "pipelines", res)) return
    const status = (req.query.status as string) || ""
    const country = (req.query.country as string) || ""
    const search = (req.query.search as string) || ""
    const page = parseInt((req.query.page as string) || "1")
    const limit = Math.min(200, parseInt((req.query.limit as string) || "50"))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let q = supabase
      .from("discovered_titles")
      .select("*, promoted_role:job_roles!promoted_role_id(id, name)", { count: "exact" })
      .order("observed_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .range(from, to)

    if (status) q = q.eq("status", status)
    if (country) q = q.eq("country", country)
    if (search) q = q.ilike("normalized_title", `%${search.toLowerCase()}%`)

    const { data, error, count } = await q
    if (error) return res.status(500).json({ error: error.message })

    // Resolve reviewer names in a second query (no FK between reviewed_by and nexus_users)
    const items = data || []
    const reviewerIds = Array.from(new Set(items.map((r: any) => r.reviewed_by).filter(Boolean))) as string[]
    if (reviewerIds.length > 0) {
      const { data: users } = await supabase.from("nexus_users").select("id, name, email").in("id", reviewerIds)
      const userMap = new Map((users || []).map((u: any) => [u.id, u]))
      for (const it of items as any[]) {
        if (it.reviewed_by) it.reviewer = userMap.get(it.reviewed_by) || null
      }
    }

    return res.json({ items, total: count || 0, page, limit })
  }

  // POST /discovered-titles/:id/promote { role_name?, role_id? }
  // If role_id provided: link to that existing role. Else create a new job_role from role_name (or title).
  const promoteMatch = path.match(/^\/discovered-titles\/([^/]+)\/promote$/)
  if (promoteMatch && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return
    const titleId = promoteMatch[1]
    const body = req.body || {}

    const { data: dt, error: dtErr } = await supabase
      .from("discovered_titles").select("*").eq("id", titleId).single()
    if (dtErr || !dt) return res.status(404).json({ error: "discovered_title not found" })

    let roleId: string | null = body.role_id || null
    const roleName: string = body.role_name || dt.title
    const family: string = body.family || "Others"

    if (!roleId) {
      // Create a new job_role. job_roles schema: id, name, family (NOT NULL), synonyms, airtable_id, created_at
      const { data: created, error: createErr } = await supabase
        .from("job_roles")
        .insert({ name: roleName, family, synonyms: [dt.title] })
        .select()
        .single()
      if (createErr) return res.status(500).json({ error: `Failed to create job_role: ${createErr.message}` })
      roleId = created.id
    }

    const { error: updErr } = await supabase
      .from("discovered_titles")
      .update({
        status: "promoted",
        promoted_role_id: roleId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth?.nexusUser?.id || null,
      })
      .eq("id", titleId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({ ok: true, discovered_title_id: titleId, job_role_id: roleId, role_name: roleName })
  }

  // POST /discovered-titles/:id/merge { role_id }
  // Append discovered title to an existing role's synonyms; mark as merged.
  const mergeMatch = path.match(/^\/discovered-titles\/([^/]+)\/merge$/)
  if (mergeMatch && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return
    const titleId = mergeMatch[1]
    const roleId = (req.body || {}).role_id
    if (!roleId) return res.status(400).json({ error: "role_id is required" })

    const { data: dt, error: dtErr } = await supabase
      .from("discovered_titles").select("*").eq("id", titleId).single()
    if (dtErr || !dt) return res.status(404).json({ error: "discovered_title not found" })

    const { data: role, error: roleErr } = await supabase
      .from("job_roles").select("id, name, synonyms").eq("id", roleId).single()
    if (roleErr || !role) return res.status(404).json({ error: "job_role not found" })

    const existing: string[] = Array.isArray(role.synonyms) ? role.synonyms : []
    const lower = new Set(existing.map((s: string) => String(s).toLowerCase()))
    // Only append the raw title (preserves casing). normalized_title is for internal matching, not display.
    const toAdd = dt.title && !lower.has(String(dt.title).toLowerCase()) ? [dt.title] : []
    const merged = [...existing, ...toAdd]

    if (toAdd.length > 0) {
      const { error: synErr } = await supabase
        .from("job_roles").update({ synonyms: merged }).eq("id", roleId)
      if (synErr) return res.status(500).json({ error: `Failed to update synonyms: ${synErr.message}` })
    }

    const { error: updErr } = await supabase
      .from("discovered_titles")
      .update({
        status: "merged",
        promoted_role_id: roleId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth?.nexusUser?.id || null,
      })
      .eq("id", titleId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({
      ok: true,
      discovered_title_id: titleId,
      job_role_id: roleId,
      role_name: role.name,
      synonyms_added: toAdd,
      synonyms_total: merged.length,
    })
  }

  // POST /discovered-titles/:id/ignore { reason? }
  const ignoreMatch = path.match(/^\/discovered-titles\/([^/]+)\/ignore$/)
  if (ignoreMatch && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return
    const titleId = ignoreMatch[1]
    const reason = (req.body || {}).reason || null

    const { error: updErr } = await supabase
      .from("discovered_titles")
      .update({
        status: "ignored",
        notes: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth?.nexusUser?.id || null,
      })
      .eq("id", titleId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({ ok: true, discovered_title_id: titleId })
  }

  return undefined;
}

// ==================== DEDUPLICATION PIPELINE ====================

export async function executeDeduplication(runId: string, _config: any) {
  // Step 1: Recompute quality scores
  await supabase.from("pipeline_runs").update({ status: "running", total_items: 0 }).eq("id", runId);

  // Compute quality scores inline (RPC has cache issues with RLS)
  const { error: qErr } = await supabase.rpc("recompute_quality_scores");
  if (qErr) {
    console.warn("RPC recompute_quality_scores failed, skipping quality score step:", qErr.message);
    // Continue with dedup even if quality scores fail — don't block the whole pipeline
  }

  // Step 2: Normalize fields
  const { error: nErr } = await supabase.rpc("normalize_job_fields");
  if (nErr) {
    console.warn("RPC normalize_job_fields failed, skipping:", nErr.message);
    // Continue — normalization is nice-to-have, not blocking
  }

  // Step 3: Find duplicate groups
  const { data: groups, error: gErr } = await supabase.rpc("find_duplicate_groups");
  if (gErr) throw new Error(`Duplicate detection failed: ${gErr.message}`);

  const dupGroups = groups || [];
  let totalDuplicates = 0;

  // Step 4: Bulk mark duplicates (group by canonical_id, one UPDATE per canonical)
  const dupsByCanonical = new Map<string, string[]>();
  for (const group of dupGroups) {
    const jobIds: string[] = group.job_ids;
    if (jobIds.length < 2) continue;
    const bestId = jobIds[0]; // Sorted by quality_score DESC
    const dupeIds = jobIds.slice(1);
    totalDuplicates += dupeIds.length;
    dupsByCanonical.set(bestId, (dupsByCanonical.get(bestId) || []).concat(dupeIds));
  }

  // Single bulk UPDATE per canonical_id (chunked at 500 to avoid query size limits)
  for (const [bestId, dupeIds] of dupsByCanonical) {
    const CHUNK = 500;
    for (let i = 0; i < dupeIds.length; i += CHUNK) {
      await supabase
        .from("jobs")
        .update({ is_duplicate: true, duplicate_of: bestId })
        .in("id", dupeIds.slice(i, i + CHUNK));
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

export async function executeCooccurrence(runId: string, _config: any) {
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

// ==================== PIPELINE EXECUTION ====================

export async function executePipeline(runId: string, pipelineType: string, config: any) {
  try {
    if (pipelineType === "linkedin_jobs") {
      await executeLinkedInJobs(runId, config);
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
    } else if (pipelineType === "jd_batch_submit") {
      await executeJDBatchSubmit(runId, config);
    } else if (pipelineType === "jd_batch_poll") {
      await executeJDBatchPoll(runId, config);
    } else if (pipelineType === "deduplication") {
      await executeDeduplication(runId, config);
    } else if (pipelineType === "cooccurrence") {
      await executeCooccurrence(runId, config);
    } else if (pipelineType === "bayt_jobs") {
      await executeBaytJobs(runId, config);
    } else if (pipelineType === "naukrigulf_jobs") {
      await executeNaukriGulfJobs(runId, config);
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
    throw err; // Re-throw so callers (scheduler) see the error
  }
}

// Process LinkedIn job results from Apify dataset (called by /poll endpoint)
// runMeta carries the searched role context (id, name, keywords) so we can
// persist job_role_id and compute role_match_score at insert time.
async function processLinkedInResults(runId: string, datasetId: string, config: any, runMeta?: { roleId?: string; roleName?: string; keywords?: string; synonyms?: string[] }) {
  // Fetch results from Apify dataset
  // Paginate through ALL dataset items (remove old limit=1000 hardcode)
  const jobs: any[] = [];
  const PAGE_SIZE = 1000;
  let dsOffset = 0;
  while (true) {
    const pageRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=${PAGE_SIZE}&offset=${dsOffset}`
    );
    const page = await pageRes.json();
    if (!Array.isArray(page) || page.length === 0) break;
    for (const item of page) {
      if (Array.isArray(item.jobs)) jobs.push(...item.jobs);
      else jobs.push(item);
    }
    if (page.length < PAGE_SIZE) break;
    dsOffset += PAGE_SIZE;
  }

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  await supabase.from("pipeline_runs").update({ total_items: jobs.length }).eq("id", runId);

  // Pre-fetch existing job external_ids in batch to avoid N+1 duplicate checks
  const externalIds = jobs.map((item, i) =>
    String(item.jobId || item.id || item.url || `li-${Date.now()}-${i}`)
  );
  const { data: existingJobs } = await supabase
    .from("jobs")
    .select("external_id")
    .eq("source", "linkedin")
    .in("external_id", externalIds);
  const existingIdSet = new Set((existingJobs || []).map((j: any) => j.external_id));

  // Pre-fetch existing companies by name in batch
  const companyNames = [...new Set(jobs.map(item => item.company || item.companyName).filter(Boolean))];
  const companyMap = new Map<string, string>();
  if (companyNames.length > 0) {
    const { data: existingCompanies } = await supabase
      .from("companies")
      .select("id, name")
      .in("name", companyNames);
    for (const c of existingCompanies || []) {
      companyMap.set(c.name, c.id);
    }
  }

  // Batch insert new companies (only those not in DB yet)
  const newCompanyNames = companyNames.filter(name => !companyMap.has(name));
  if (newCompanyNames.length > 0) {
    const companyRows = newCompanyNames.map(name => {
      const item = jobs.find(j => (j.company || j.companyName) === name);
      return {
        name,
        name_normalized: normalizeText(name),
        linkedin_url: item?.companyUrl || null,
        domain: item?.companyDomain || null,
        enrichment_status: "pending",
      };
    });
    // Batch insert in chunks of 100
    for (let i = 0; i < companyRows.length; i += 100) {
      const batch = companyRows.slice(i, i + 100);
      const { data: inserted } = await supabase
        .from("companies")
        .upsert(batch, { onConflict: "name" })
        .select("id, name");
      for (const c of inserted || []) {
        companyMap.set(c.name, c.id);
      }
    }
  }

  // COALESCE backfill: for existing companies, fill nullable URL/domain fields when this batch carries them
  // (no overwrite; only fills NULLs)
  const existingCompanyBackfill = companyNames
    .filter(name => companyMap.has(name))
    .map(name => {
      const item = jobs.find(j => (j.company || j.companyName) === name);
      return { id: companyMap.get(name)!, name, linkedinUrl: item?.companyUrl || null, domain: item?.companyDomain || null };
    })
    .filter(r => r.linkedinUrl || r.domain);
  if (existingCompanyBackfill.length > 0) {
    // Fetch current null-status to avoid unnecessary writes
    const ids = existingCompanyBackfill.map(r => r.id);
    const { data: currentRows } = await supabase
      .from("companies")
      .select("id, linkedin_url, domain")
      .in("id", ids);
    const currentMap = new Map((currentRows || []).map((r: any) => [r.id, r]));
    for (const r of existingCompanyBackfill) {
      const cur: any = currentMap.get(r.id);
      const patch: any = {};
      if (cur && !cur.linkedin_url && r.linkedinUrl) patch.linkedin_url = r.linkedinUrl;
      if (cur && !cur.domain && r.domain) patch.domain = r.domain;
      if (Object.keys(patch).length > 0) {
        await supabase.from("companies").update(patch).eq("id", r.id);
      }
    }
  }

  // Batch insert jobs (skip existing)
  const BATCH_SIZE = 100;
  const newJobs: any[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const item = jobs[i];
    const externalId = externalIds[i];

    if (existingIdSet.has(externalId)) {
      skipped++;
      continue;
    }

    const companyName = item.company || item.companyName || null;
    const companyId = companyName ? (companyMap.get(companyName) || null) : null;

    // Apply URL: actor returns under different keys depending on actor version
    const applyUrl = item.applyUrl || item.applicationUrl || item.applyLink || item.jobApplyLink || item.applyUrlLI || null;
    // Description: prefer descriptionHtml (richer) then plain description
    const description = item.descriptionHtml || item.description || item.jobDescription || null;
    // Salary: actor sometimes returns range strings, sometimes structured fields
    const salaryMin = item.salaryMin || item.salary?.min || null;
    const salaryMax = item.salaryMax || item.salary?.max || null;
    const salaryText = item.salary?.text || item.salaryText || (typeof item.salary === "string" ? item.salary : null) || null;

    // Role match score computed and persisted to the column (migration 040 — May 2026).
    // Mirror copy retained in raw_data._role_match_score for traceability.
    let roleMatchScore: number | null = null;
    if (runMeta?.synonyms && runMeta.synonyms.length > 0 && item.title) {
      roleMatchScore = computeRoleMatchScore(item.title, runMeta.synonyms);
    }

    newJobs.push({
      external_id: externalId,
      source: "linkedin",
      title: item.title || "Unknown",
      title_normalized: item.title ? normalizeText(item.title) : null,
      company_name_normalized: companyName ? normalizeText(companyName) : null,
      description,
      company_id: companyId,
      company_name: companyName,
      location_raw: item.location || item.formattedLocation || null,
      location_city: item.city || null,
      location_state: item.state || null,
      location_country: item.country || config.location || null,
      employment_type: mapEmploymentType(item.employmentType || item.jobType || item.workType),
      seniority_level: mapSeniority(item.seniorityLevel || item.experienceLevel),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: item.salaryCurrency || item.salary?.currency || null,
      salary_text: salaryText,
      posted_at: item.datePosted || item.postedAt || item.publishedAt || null,
      application_url: applyUrl,
      source_url: item.url || item.link || item.jobUrl || null,
      is_remote: typeof item.isRemote === "boolean" ? item.isRemote : (item.workLocation === "remote" ? true : null),
      qualifications: item.qualifications || null,
      responsibilities: item.responsibilities || null,
      benefits: item.benefits || item.benefitsList || null,
      recruiter_name: item.recruiterName || item.poster?.name || null,
      recruiter_url: item.recruiterUrl || item.poster?.linkedinUrl || null,
      job_role_id: runMeta?.roleId || null,
      role_match_score: roleMatchScore,
      last_seen_at: new Date().toISOString(),
      discovery_source: (runMeta as any)?.discoverySource || (config as any)?.discovery_source || null,
      enrichment_status: description ? "partial" : "pending",
      raw_data: { ...item, _role_match_score: roleMatchScore, _role_id: runMeta?.roleId, _role_name: runMeta?.roleName, _pipeline_run_id: runId },
    });
  }

  // Batch insert new jobs in chunks
  for (let i = 0; i < newJobs.length; i += BATCH_SIZE) {
    const batch = newJobs.slice(i, i + BATCH_SIZE);
    try {
      const { data: inserted, error } = await supabase.from("jobs").insert(batch).select("id");
      if (error) {
        // Fallback to individual inserts for this batch on error
        for (const job of batch) {
          try {
            await supabase.from("jobs").insert(job);
            processed++;
          } catch { failed++; }
        }
      } else {
        processed += (inserted || []).length;
      }
    } catch {
      failed += batch.length;
    }

    await supabase.from("pipeline_runs").update({
      processed_items: processed,
      failed_items: failed,
      skipped_items: skipped,
    }).eq("id", runId);
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

async function executeLinkedInJobs(runId: string, config: any) {
  if (!APIFY_API_KEY) throw new Error("Apify API key not configured");

  const timePostedMap: Record<string, string> = {
    "past_24h": "r86400", "24hr": "r86400",
    "past_week": "r604800", "past week": "r604800",
    "past_month": "r2592000", "past month": "r2592000",
  };

  const commonInput: Record<string, any> = {
    location: config?.location || "India",
    maxPages: Math.ceil((parseInt(config?.limit) || 100) / 10),
  };
  if (config?.date_posted && timePostedMap[config.date_posted]) commonInput.timePosted = timePostedMap[config.date_posted];
  if (config?.experience_level) commonInput.experienceLevel = config.experience_level.split(",").filter(Boolean);
  if (config?.work_type) commonInput.workType = config.work_type.split(",").filter(Boolean);
  if (config?.work_location) commonInput.workLocation = config.work_location.split(",").filter(Boolean);
  if (config?.industry_ids) commonInput.industryIds = config.industry_ids.split(",").filter(Boolean);
  if (config?.company_names) commonInput.companyNames = config.company_names.split(",").filter(Boolean);
  if (config?.fetch_description !== undefined) commonInput.fetchDescription = !!config.fetch_description;
  if (config?.easy_apply_only) commonInput.easyApplyOnly = true;
  if (config?.sort_by) commonInput.sortBy = config.sort_by;

  // Build keyword queries: one Apify run per role (synonyms OR-joined).
  // LinkedIn enforces a ~1000 char hard limit on keyword field; we cap conservatively at 600.
  // If a role's combined OR-query exceeds the cap, split synonyms across multiple runs (per-synonym for that role).
  const KEYWORD_CAP = 600;
  const jobRoleIds = config?.job_role_ids as string[] | undefined;
  let runs: { keywords: string; roleId?: string; roleName?: string; synonyms?: string[]; split?: boolean }[] = [];
  const overflowWarnings: any[] = [];

  if (jobRoleIds && jobRoleIds.length > 0) {
    const { data: roles } = await supabase.from("job_roles").select("id, name, synonyms").in("id", jobRoleIds);
    if (roles && roles.length > 0) {
      for (const r of roles) {
        const syns = ((r.synonyms as string[]) || []).filter(Boolean);
        const joined = syns.map(s => `"${s}"`).join(" OR ");
        if (joined.length <= KEYWORD_CAP) {
          runs.push({ keywords: joined || `"${r.name}"`, roleId: r.id, roleName: r.name, synonyms: syns.length ? syns : [r.name] });
        } else {
          // Split synonyms into multiple chunks, each under KEYWORD_CAP
          overflowWarnings.push({ roleId: r.id, roleName: r.name, totalLen: joined.length, synonymCount: syns.length });
          const chunks: string[][] = [];
          let cur: string[] = [];
          let curLen = 0;
          for (const s of syns) {
            const piece = `"${s}"`;
            const add = (cur.length ? " OR " : "").length + piece.length;
            if (curLen + add > KEYWORD_CAP && cur.length > 0) {
              chunks.push(cur); cur = []; curLen = 0;
            }
            cur.push(s); curLen += add;
          }
          if (cur.length > 0) chunks.push(cur);
          for (const chunk of chunks) {
            runs.push({
              keywords: chunk.map(s => `"${s}"`).join(" OR "),
              roleId: r.id, roleName: r.name, synonyms: chunk, split: true,
            });
          }
          console.warn(`[executeLinkedInJobs] OR-query overflow for role ${r.name}: ${joined.length} chars, split into ${chunks.length} runs`);
        }
      }
    }
  }
  if (runs.length === 0) {
    runs = [{ keywords: config?.search_keywords || config?.keywords || "software engineer" }];
  }

  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _job_roles: runs.map(r => ({ id: r.roleId, name: r.roleName, split: r.split || false })),
      _provider: "apify",
      _overflow_warnings: overflowWarnings.length ? overflowWarnings : undefined,
    },
  }).eq("id", runId);

  // Launch all Apify runs in parallel
  const apifyRuns: { runId?: string; datasetId?: string; keywords: string; roleId?: string; roleName?: string; synonyms?: string[] }[] = [];
  const launchPromises = runs.map(async (run) => {
    try {
      const apifyUrl = `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs?token=${APIFY_API_KEY}`;
      const body = JSON.stringify({ ...commonInput, keywords: run.keywords });
      const res = await fetch(apifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) {
        const d = await res.json();
        return { runId: d.data?.id, datasetId: d.data?.defaultDatasetId, keywords: run.keywords, roleId: run.roleId, roleName: run.roleName, synonyms: run.synonyms };
      } else {
        const errText = await res.text();
        console.error(`[executeLinkedInJobs] Apify error: ${res.status} ${errText.substring(0, 200)}`);
      }
    } catch (err: any) {
      console.error(`[executeLinkedInJobs] Fetch failed: ${err.message}`);
    }
    return { keywords: run.keywords, roleId: run.roleId, roleName: run.roleName, synonyms: run.synonyms };
  });
  apifyRuns.push(...(await Promise.all(launchPromises)));

  // Poll until all runs complete (max 10 minutes — supports up to 30 roles)
  const MAX_WAIT = 600000;
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT) {
    let allDone = true;
    for (const r of apifyRuns) {
      if (!r.runId || (r as any)._done) continue;
      try {
        const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${r.runId}?token=${APIFY_API_KEY}`);
        const d = await pollRes.json();
        const st = d.data?.status;
        if (st === "SUCCEEDED" || st === "FAILED" || st === "ABORTED") {
          (r as any)._done = true; (r as any)._status = st;
        } else { allDone = false; }
      } catch { allDone = false; }
    }
    if (allDone) break;
    await new Promise(r => setTimeout(r, 5000));
  }

  // Process results from all succeeded runs — pass per-run role context for tagging
  let processedCount = 0;
  for (const r of apifyRuns) {
    if ((r as any)._status === "SUCCEEDED" && r.datasetId) {
      await processLinkedInResults(runId, r.datasetId, config, {
        roleId: r.roleId, roleName: r.roleName, keywords: r.keywords, synonyms: r.synonyms,
        discoverySource: config?.discovery_source || null,
      } as any);
      processedCount++;
    }
  }

  // If no Apify runs launched at all, mark as failed with debug info
  const launchedRuns = apifyRuns.filter(r => r.runId);
  if (launchedRuns.length === 0) {
    const debugInfo = `No Apify runs launched. Roles: ${runs.length}, Keywords sample: ${runs[0]?.keywords?.substring(0, 100)}`;
    console.error(`[executeLinkedInJobs] ${debugInfo}`);
    throw new Error(debugInfo);
  }

}

async function executeGoogleJobs(runId: string, config: any) {
  if (!APIFY_API_KEY) throw new Error("Apify API key not configured");

  // Build individual search queries from role synonyms or free text.
  // Each query carries its roleId so the resulting jobs are tagged at insert time.
  type GoogleQuery = { query: string; roleId?: string; roleName?: string; synonyms?: string[] };
  let queries: GoogleQuery[] = [];
  let roleSynonymMap = new Map<string, string[]>(); // roleId -> synonyms (for match scoring)

  const jobRoleIds = config.job_role_ids as string[] | undefined;
  if (jobRoleIds && jobRoleIds.length > 0) {
    const { data: roles } = await supabase
      .from("job_roles")
      .select("id, name, synonyms")
      .in("id", jobRoleIds);
    if (roles && roles.length > 0) {
      for (const role of roles) {
        const synonyms = ((role.synonyms as string[]) || [role.name]).filter(Boolean);
        roleSynonymMap.set(role.id, synonyms);
        for (const syn of synonyms) {
          queries.push({ query: syn, roleId: role.id, roleName: role.name, synonyms });
        }
      }
    }
  }

  if (Array.isArray(config.queries) && config.queries.length > 0) {
    for (const q of config.queries) {
      if (typeof q === "string" && q.trim()) queries.push({ query: q.trim() });
    }
  }
  if (!queries.length) queries = [{ query: config.query || "software engineer" }];

  // Cap at 20 queries to stay within Vercel 300s timeout
  const MAX_QUERIES = 20;
  if (queries.length > MAX_QUERIES) queries = queries.slice(0, MAX_QUERIES);

  // Country mapping for igview-owner actor (uses ISO codes)
  const countryCode = (config.country || "in").toLowerCase();
  const COUNTRY_FULL: Record<string, string> = {
    in: "India", ae: "United Arab Emirates", us: "United States", gb: "United Kingdom",
    sg: "Singapore", au: "Australia", ca: "Canada", de: "Germany",
    nl: "Netherlands", sa: "Saudi Arabia", qa: "Qatar", om: "Oman",
    bh: "Bahrain", kw: "Kuwait", my: "Malaysia", hk: "Hong Kong",
    jp: "Japan", kr: "South Korea", fr: "France", ch: "Switzerland",
    ie: "Ireland", se: "Sweden",
  };
  const locationName = COUNTRY_FULL[countryCode] || config.country || "India";
  const datePosted = config.date_posted && config.date_posted !== "all" ? config.date_posted : "month";

  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _resolved_queries: queries.map(q => ({ query: q.query, roleId: q.roleId, roleName: q.roleName })),
      _query_count: queries.length,
      _provider: "apify",
      _actor: "igview-owner/google-jobs-scraper",
    },
  }).eq("id", runId);

  let allProcessed = 0, allFailed = 0, allSkipped = 0, allTotal = 0;

  // Fire ALL queries to Apify in parallel
  const launchPromises = queries.map(async (q) => {
    try {
      const actorInput: Record<string, any> = {
        query: q.query,
        location: locationName,
        country: countryCode,
        maxResults: 10,
      };

      const startRes = await fetch(
        `https://api.apify.com/v2/acts/igview-owner~google-jobs-scraper/runs?token=${APIFY_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
      );
      if (startRes.ok) {
        const d = await startRes.json();
        return { query: q.query, roleId: q.roleId, roleName: q.roleName, synonyms: q.synonyms, runId: d.data?.id, datasetId: d.data?.defaultDatasetId };
      }
    } catch {}
    return { query: q.query, roleId: q.roleId, roleName: q.roleName, synonyms: q.synonyms };
  });

  const apifyRuns = (await Promise.all(launchPromises)).filter((r: any) => r.runId);

  // Poll all runs until done (max 10 minutes — supports 20 queries in parallel)
  const MAX_WAIT = 600000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < MAX_WAIT) {
    let allDone = true;
    for (const run of apifyRuns) {
      if ((run as any)._done) continue;
      try {
        const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.runId}?token=${APIFY_API_KEY}`);
        const pollData = await pollRes.json();
        const status = pollData.data?.status;
        if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED") {
          (run as any)._done = true;
          (run as any)._status = status;
        } else { allDone = false; }
      } catch { allDone = false; }
    }
    if (allDone) break;
    await new Promise(r => setTimeout(r, 5000));
  }

  // Collect results from all completed runs
  for (const run of apifyRuns) {
    if (!(run as any)._done || (run as any)._status !== "SUCCEEDED" || !run.datasetId) continue;
    try {
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${run.datasetId}/items?token=${APIFY_API_KEY}`);
      const items = await itemsRes.json();

      if (Array.isArray(items)) {
        allTotal += items.length;

        for (const item of items) {
          try {
            const externalId = item.jobId || `gj-${(item.jobTitle||"").replace(/[^a-z0-9]/gi,"").substring(0,60)}-${(item.employerName||"").replace(/[^a-z0-9]/gi,"").substring(0,40)}`;

            const { data: existing } = await supabase.from("jobs").select("id")
              .eq("external_id", externalId).eq("source", "google_jobs").maybeSingle();
            if (existing) { allSkipped++; continue; }

            let companyId = null;
            if (item.employerName) {
              companyId = await upsertCompanyByName(item.employerName, item.employerWebsite, item.employerLogo);
            }

            const desc = item.jobDescription || null;
            const titleNorm = normalizeText(item.jobTitle || "");
            const companyNorm = normalizeText(item.employerName || "");

            // Role match score computed and persisted to the column (migration 040 — May 2026).
            let roleMatchScore: number | null = null;
            if ((run as any).synonyms && (run as any).synonyms.length > 0 && item.jobTitle) {
              roleMatchScore = computeRoleMatchScore(item.jobTitle, (run as any).synonyms);
            }

            await supabase.from("jobs").insert({
              external_id: externalId,
              source: "google_jobs",
              title: item.jobTitle || "Unknown",
              title_normalized: titleNorm || null,
              company_name_normalized: companyNorm || null,
              description: desc,
              company_id: companyId,
              company_name: item.employerName || null,
              location_raw: item.jobLocation || [item.jobCity, item.jobState, item.jobCountry].filter(Boolean).join(", "),
              location_city: item.jobCity || null,
              location_state: item.jobState || null,
              location_country: (item.jobCountry || countryCode).toUpperCase(),
              employment_type: mapEmploymentTypeExtended(item.employmentType),
              seniority_level: item.jobOnetJobZone ? mapOnetJobZone(item.jobOnetJobZone) : null,
              salary_min: item.minSalary || null,
              salary_max: item.maxSalary || null,
              salary_unit: item.salaryPeriod || null,
              salary_text: item.salary || null,
              posted_at: item.jobPostedAtDatetime || null,
              application_url: item.jobApplyLink || null,
              source_url: item.jobGoogleLink || null,
              is_remote: item.isRemote || null,
              job_publisher: item.jobPublisher || null,
              apply_platforms: item.applyPlatforms || null,
              qualifications: item.qualifications || null,
              responsibilities: item.responsibilities || null,
              benefits: item.benefitsList || item.benefits || null,
              job_role_id: (run as any).roleId || null,
              role_match_score: roleMatchScore,
              last_seen_at: new Date().toISOString(),
              discovery_source: (run as any).discoverySource || config?.discovery_source || null,
              enrichment_status: (desc && desc.length > 100) ? "partial" : "pending",
              raw_data: { ...item, search_query: (run as any).query, _role_id: (run as any).roleId, _role_name: (run as any).roleName, _role_match_score: roleMatchScore, _pipeline_run_id: runId },
            });
            allProcessed++;
          } catch (e) { allFailed++; }
        }
      }
    } catch {}
  }

  await supabase.from("pipeline_runs").update({ total_items: allTotal }).eq("id", runId);

  await supabase.from("enrichment_logs").insert({
    entity_type: "job", entity_id: runId, provider: "apify",
    operation: "google_jobs_search", status: "success", credits_used: allTotal,
  });

  await supabase.from("pipeline_runs").update({
    status: "completed", completed_at: new Date().toISOString(),
    total_items: allTotal, processed_items: allProcessed,
    failed_items: allFailed, skipped_items: allSkipped,
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

// ==================== JD FETCH PIPELINE (Feature 4) ====================

async function executeJDFetch(runId: string, config: any) {
  const batchSize = Math.min(parseInt(config.batch_size) || 10, 50);
  const jobIds: string[] = config.job_ids || [];

  // If specific job IDs provided (e.g. from single-job "Fetch JD" button), use those.
  // Otherwise fall back to queue-based fetch (jd_fetch_status = pending).
  let query = supabase
    .from("jobs")
    .select("id, title, company_name, source, source_url, description");

  if (jobIds.length > 0) {
    query = query.in("id", jobIds);
  } else {
    query = query
      .eq("jd_fetch_status", "pending")
      .or("description.is.null,description.lt.100")
      .order("created_at", { ascending: false })
      .limit(batchSize);
  }

  const { data: jobs, error } = await query;

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
              model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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

// ==================== TAXONOMY CACHE ====================

// In-memory taxonomy cache (~8,888 rows, ~1MB) with 10-minute TTL
let taxonomyCache: Map<string, { id: string; category: string }> | null = null;
let taxonomyCacheTime = 0;
const TAXONOMY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getTaxonomyMap(): Promise<Map<string, { id: string; category: string }>> {
  if (taxonomyCache && Date.now() - taxonomyCacheTime < TAXONOMY_CACHE_TTL) {
    return taxonomyCache;
  }
  const { data } = await supabase.from("taxonomy_skills").select("id, name, category");
  const map = new Map<string, { id: string; category: string }>();
  for (const row of data || []) {
    // Store both exact name and lowercase for matching
    map.set(row.name.toLowerCase(), { id: row.id, category: row.category });
  }
  taxonomyCache = map;
  taxonomyCacheTime = Date.now();
  return map;
}

// ==================== JD ANALYSIS PIPELINE (v2 — routes through canonical runAnalyzeJd) ====================
// Replaces the old gpt-4o-mini multi-JD batch approach.
// Every job now goes through the same runAnalyzeJd() pipeline as the manual /jd-analyzer page:
//   - Prompt v2.2 (function/family/industry/seniority/bucket/skills with L1+L2)
//   - Model: gpt-4.1-mini
//   - upsert_skill() RPC + fuzzy match (pg_trgm similarity ≥ 0.7 + Levenshtein ≤ 2)
//   - Bucket resolver (auto_assign at ≥0.80 confidence)
//   - Instrumentation written to analyze_jd_runs (per-job run log)
//   - jobs.analysis_version set to 'v2' on success
//
// Vercel budget: 300s max. At ~6s/job, 40 jobs ≈ 240s — safe ceiling per invocation.
// UI can re-trigger to drain the queue in subsequent runs.

async function executeJDEnrichment(runId: string, config: any) {
  // Hard cap at 40 per invocation (Vercel 300s budget: ~6s/job × 40 = 240s)
  const PER_INVOCATION_CAP = 40;
  const requestedBatch = Math.min(parseInt(config.batch_size) || 50, PER_INVOCATION_CAP);
  const CONCURRENCY = 3; // parallel runAnalyzeJd() calls

  const jobIds: string[] = config.job_ids || [];

  // ── 1. Fetch jobs to process ────────────────────────────────────────────────
  // Default queue: jobs that have never been v2-analyzed.
  // Includes 'partial', 'imported', 'pending' — skips already complete v2 jobs.
  let jobQuery = supabase
    .from("jobs")
    .select("id, title, company_name, description")
    .not("description", "is", null)
    .filter("description", "neq", "");

  if (jobIds.length > 0) {
    // Explicit job_ids override (e.g. from a re-run trigger)
    jobQuery = jobQuery.in("id", jobIds);
  } else {
    // Queue: not yet v2-analyzed, description present.
    // .or() handles NULL correctly — .not("analysis_version","eq","v2") would
    // silently exclude NULL rows because NULL != 'v2' evaluates to NULL (falsy).
    jobQuery = jobQuery
      .or("analysis_version.is.null,analysis_version.neq.v2")
      .in("enrichment_status", ["pending", "partial", "imported"])
      .order("created_at", { ascending: false })
      .limit(requestedBatch);
  }

  const { data: fetchedJobs, error: fetchError } = await jobQuery;
  if (fetchError) throw fetchError;

  // Filter out stubs with very short descriptions (< 100 chars)
  const validJobs = (fetchedJobs || []).filter(
    j => j.description && j.description.length > 100
  );

  // Count total remaining in queue (for progress reporting)
  const { count: remaining } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .not("description", "is", null)
    .or("analysis_version.is.null,analysis_version.neq.v2")
    .in("enrichment_status", ["pending", "partial", "imported"]);

  if (!validJobs.length) {
    await supabase.from("pipeline_runs").update({
      status: "completed",
      total_items: 0,
      processed_items: 0,
      failed_items: 0,
      error_message: `Queue empty — no jobs pending v2 analysis. Total remaining: 0.`,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return;
  }

  await supabase.from("pipeline_runs").update({
    total_items: validJobs.length,
    error_message: `Remaining in queue after this run: ~${Math.max(0, (remaining ?? 0) - validJobs.length)}`,
  }).eq("id", runId);

  let processed = 0;
  let failed = 0;

  // ── 2. Process jobs in concurrency-3 waves ──────────────────────────────────
  // Each job goes through the canonical runAnalyzeJd() — same as /jd-analyzer manual path.
  for (let i = 0; i < validJobs.length; i += CONCURRENCY) {
    const wave = validJobs.slice(i, i + CONCURRENCY);

    const waveResults = await Promise.allSettled(
      wave.map(job =>
        runAnalyzeJd({
          text: job.description!,
          job_id: job.id,
          batch_id: runId, // group all runs for this pipeline invocation
          source: "async_batch",
          created_by: undefined,
        })
      )
    );

    for (const r of waveResults) {
      if (r.status === "fulfilled") {
        const result = r.value;
        if (result.status === "failed") {
          failed++;
          console.error("[jd_enrichment] runAnalyzeJd failed for job:", result.error);
        } else {
          processed++;
        }
      } else {
        failed++;
        console.error("[jd_enrichment] wave error:", r.reason?.message || r.reason);
      }
    }

    // Live progress update
    await supabase.from("pipeline_runs").update({
      processed_items: processed,
      failed_items: failed,
    }).eq("id", runId);
  }

  // ── 3. Final pipeline_run update ────────────────────────────────────────────
  const queueAfter = Math.max(0, (remaining ?? 0) - processed);
  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    completed_at: new Date().toISOString(),
    error_message: queueAfter > 0
      ? `✓ ${processed} jobs analyzed with v2.2 prompt. ${queueAfter} jobs still in queue — trigger again to continue.`
      : `✓ ${processed} jobs analyzed with v2.2 prompt. Queue is now empty.`,
  }).eq("id", runId);
}

// Maximum number of profiles to process per /poll call. Sized to fit comfortably
// within Vercel's 300s function budget (see vercel.json). At ~5-10 profiles/sec
// (1 person insert + 1 alumni insert + occasional company upsert per profile),
// 500 takes ~50-100s, leaving headroom for prefetch and dataset fetch.
// Sized so the full chunk finishes in well under Vercel's 300s maxDuration,
// leaving headroom for the fire-and-forget self-chain at line ~417 to actually fire.
// Empirically: ~330 profiles take ~280s synchronously (88-115 inserts/min),
// so 250 should land at ~210s, giving a 90s safety margin.
const ALUMNI_CHUNK_SIZE = 250;

// Process Alumni results from Apify dataset (called by /poll endpoint).
// CHUNKED: processes at most `maxItemsThisCall` profiles per invocation, then returns.
// Caller is responsible for re-invoking until done=true. State is recovered from the
// `people` and `alumni` tables on each call (idempotent), so chunking survives Vercel
// kills and concurrent polls without double-inserting.
async function processAlumniResults(
  runId: string,
  datasetId: string,
  config: any,
  maxItemsThisCall: number = ALUMNI_CHUNK_SIZE
): Promise<{ done: boolean; remaining: number }> {
  // Paginate through ALL dataset items — Apify caps single-response size, so loop until empty page.
  // Mirrors processLinkedInResults pattern. Previous hardcoded ?limit=2500 silently truncated
  // large bulk uploads (e.g. 10K+ alumni) to the first 2500 results.
  const profiles: any[] = [];
  const PAGE_SIZE = 1000;
  let dsOffset = 0;
  while (true) {
    const pageRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=${PAGE_SIZE}&offset=${dsOffset}`
    );
    if (!pageRes.ok) {
      throw new Error(`[alumni] Apify dataset fetch failed at offset=${dsOffset}: ${pageRes.status} ${pageRes.statusText}`);
    }
    const page = await pageRes.json();
    if (!Array.isArray(page) || page.length === 0) break;
    profiles.push(...page);
    if (page.length < PAGE_SIZE) break;
    dsOffset += PAGE_SIZE;
  }
  console.log(`[alumni] Fetched ${profiles.length} profiles from Apify dataset ${datasetId}`);

  // Read existing counters so we resume from where the prior chunk left off.
  // We track totals in pipeline_runs.{processed_items,failed_items,skipped_items}
  // and incrementally update them within this call.
  const { data: runRow } = await supabase
    .from("pipeline_runs")
    .select("processed_items, failed_items, skipped_items")
    .eq("id", runId)
    .single();
  let processed = runRow?.processed_items ?? 0;
  let failed = runRow?.failed_items ?? 0;
  let skipped = runRow?.skipped_items ?? 0;
  const startProcessed = processed;
  const startFailed = failed;
  const startSkipped = skipped;

  await supabase.from("pipeline_runs").update({ total_items: profiles.length }).eq("id", runId);

  const universityName = config?.university_name || config?.university_slug || "Unknown University";
  
  // Education validation: filter profiles to only those who actually attended the target college
  const collegeConfig = config?._colleges || [];
  const collegeNames = config?._college_names || [universityName];
  const validationEnabled = config?._validation_enabled !== false;
  
  let validatedProfiles = profiles;
  let filteredOut = 0;
  
  if (validationEnabled && collegeNames.length > 0) {
    // Normalize a string for matching: lowercase, strip punctuation, collapse whitespace.
    // This is critical because LinkedIn schoolName values vary wildly:
    //   "University of Wollongong, Dubai" vs "University of Wollongong in Dubai"
    //   vs "University of Wollongong - Dubai" vs "University Of Wollongong (Dubai)"
    const normalize = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/[\u2010-\u2015\-_,.()\[\]{}\/\\:;]/g, ' ') // strip punctuation
        .replace(/\b(in|at|the|of)\b/g, ' ')                  // drop stopwords for matching
        .replace(/\s+/g, ' ')
        .trim();

    // Build match patterns from college names. Each pattern is a normalized token sequence;
    // we match if a normalized schoolName CONTAINS any pattern (substring match on normalized text).
    const patternSet = new Set<string>();
    for (const rawName of collegeNames) {
      const lower = (rawName || '').toLowerCase().replace(/\s+(mba|engineering|medical|law)$/i, '').trim();
      if (!lower) continue;

      // 1. Full normalized name (e.g. "university wollongong dubai")
      patternSet.add(normalize(lower));

      // 2. If name has a ", Qualifier" suffix (e.g. ", Dubai"), generate explicit variants
      // so we still match "University of Wollongong in Dubai", "University of Wollongong - Dubai",
      // "University Of Wollongong (Dubai)", etc. We keep the qualifier required — we do NOT add
      // the bare base name alone, because that would let a different campus through (e.g. the
      // Australia main campus). The normalize() step already strips punctuation/stopwords,
      // so "university wollongong dubai" matches all comma/hyphen/"in" variants in one pattern.
      // No additional patterns needed beyond #1 — left as a no-op for clarity.

      // 3. IIM / IIT special abbreviations
      if (lower.includes('indian institute of management')) {
        const city = lower.replace('indian institute of management', '').replace(/,/g, '').trim();
        if (city) {
          patternSet.add(normalize('iim ' + city));
          patternSet.add('iim' + city.charAt(0)); // iima, iimb, iimc
        }
      }
      if (lower.includes('indian institute of technology')) {
        const city = lower.replace('indian institute of technology', '').replace(/,/g, '').trim();
        if (city) {
          patternSet.add(normalize('iit ' + city));
          patternSet.add('iit' + city.charAt(0));
        }
      }

      // 4. short_name from college config — only if reasonably distinctive (>=3 chars)
      // to avoid false positives from generic 2-char abbreviations.
      const college = collegeConfig.find((c: any) =>
        c.name?.toLowerCase().includes(lower) || lower.includes(c.name?.toLowerCase())
      );
      if (college?.short_name) {
        const sn = (college.short_name as string).toLowerCase().trim();
        if (sn.length >= 3) patternSet.add(sn);
      }
    }
    const patterns = [...patternSet].filter(Boolean);
    console.log(`[alumni] Validation patterns:`, patterns);

    validatedProfiles = profiles.filter((p: any) => {
      const edu = p.education || [];
      const normalizedSchools: string[] = edu.map((e: any) => normalize(e.schoolName || ''));
      const match = patterns.some((pattern: string) =>
        normalizedSchools.some((school: string) => school.length > 0 && school.includes(pattern))
      );
      if (!match) filteredOut++;
      return match;
    });

    console.log(`[alumni] Education validation: ${validatedProfiles.length}/${profiles.length} matched (${filteredOut} filtered out)`);
  }
  
  // Update total_items to show both scraped and validated counts
  await supabase.from("pipeline_runs").update({ 
    total_items: profiles.length,
    config: { ...config, _scraped_count: profiles.length, _validated_count: validatedProfiles.length, _filtered_out: filteredOut },
  }).eq("id", runId);
  
  // Use validated profiles for the rest of processing
  const profilesToProcess = validatedProfiles;

  // Pre-fetch existing people by LinkedIn URL in batch.
  // CRITICAL: PostgREST .in() builds the filter into the URL query string. With 9K+
  // LinkedIn URLs averaging ~46 chars, batches of 500 produce ~23KB query strings
  // that silently truncate or get rejected by upstream proxies (CloudFront, Vercel),
  // returning EMPTY results instead of an error. Symptom: existingPeopleMap is empty,
  // every insert collides with the unique index, every profile counted as failed.
  // Use IN_BATCH_SIZE=80 → ~3.7KB per query, comfortably under all proxy limits.
  const IN_BATCH_SIZE = 80;
  const linkedinUrls = profilesToProcess
    .map(p => p.linkedinUrl || p.profileUrl)
    .filter(Boolean) as string[];
  const existingPeopleMap = new Map<string, string>();
  if (linkedinUrls.length > 0) {
    for (let i = 0; i < linkedinUrls.length; i += IN_BATCH_SIZE) {
      const batch = linkedinUrls.slice(i, i + IN_BATCH_SIZE);
      const { data: existingPeople, error: lookupErr } = await supabase
        .from("people")
        .select("id, linkedin_url")
        .in("linkedin_url", batch);
      if (lookupErr) {
        console.error(`[alumni] people lookup failed at batch ${i}:`, lookupErr.message);
      }
      for (const p of existingPeople || []) {
        if (p.linkedin_url) existingPeopleMap.set(p.linkedin_url, p.id);
      }
    }
    console.log(`[alumni] Pre-fetched ${existingPeopleMap.size}/${linkedinUrls.length} existing people`);
  }

  // Pre-fetch existing alumni records for these people. UUIDs are 36 chars so
  // we can use a slightly larger batch, but keep it conservative.
  const existingPersonIds = [...existingPeopleMap.values()];
  const existingAlumniSet = new Set<string>();
  if (existingPersonIds.length > 0) {
    for (let i = 0; i < existingPersonIds.length; i += 100) {
      const batch = existingPersonIds.slice(i, i + 100);
      const { data: existingAlumni, error: alErr } = await supabase
        .from("alumni")
        .select("person_id")
        .in("person_id", batch);
      if (alErr) {
        console.error(`[alumni] alumni lookup failed at batch ${i}:`, alErr.message);
      }
      for (const a of existingAlumni || []) {
        existingAlumniSet.add(a.person_id);
      }
    }
    console.log(`[alumni] Pre-fetched ${existingAlumniSet.size}/${existingPersonIds.length} existing alumni`);
  }

  // Pre-fetch existing companies by name in batch
  const companyNames = [...new Set(
    profilesToProcess
      .map(p => Array.isArray(p.experience) ? p.experience[0]?.companyName : null)
      .filter(Boolean)
  )];
  const companyMap = new Map<string, string>();
  if (companyNames.length > 0) {
    for (let i = 0; i < companyNames.length; i += 500) {
      const batch = companyNames.slice(i, i + 500);
      const { data: existingCompanies } = await supabase
        .from("companies")
        .select("id, name")
        .in("name", batch);
      for (const c of existingCompanies || []) {
        companyMap.set(c.name, c.id);
      }
    }
  }

  // Batch insert new companies
  const newCompanyNames = companyNames.filter(name => !companyMap.has(name));
  if (newCompanyNames.length > 0) {
    for (let i = 0; i < newCompanyNames.length; i += 100) {
      const batch = newCompanyNames.slice(i, i + 100).map(name => {
        const profile = profiles.find(p =>
          Array.isArray(p.experience) && p.experience[0]?.companyName === name
        );
        return {
          name,
          linkedin_url: profile?.experience?.[0]?.companyUrl || null,
          enrichment_status: "pending",
        };
      });
      const { data: inserted } = await supabase
        .from("companies")
        .upsert(batch, { onConflict: "name" })
        .select("id, name");
      for (const c of inserted || []) {
        companyMap.set(c.name, c.id);
      }
    }
  }

  // Chunk budget: how many profiles we can attempt this call before yielding
  // back to the /poll handler. We count both successes and failures toward the
  // budget so we don't get stuck retrying the same bad batch every call.
  let attemptedThisCall = 0;

  // Wall-clock budget: yield back to the /poll handler after this many ms so
  // that the caller has time to fire the self-chain before Vercel's 300s SIGKILL.
  // Vercel maxDuration is 300s; pre-fetch eats some, dispatch eats some, leave
  // 60s safety margin for both → budget the actual insert loop at 200s.
  const CHUNK_WALL_MS = 200_000;
  const chunkStart = Date.now();

  // Process validated profiles — sequential for person inserts (need IDs for alumni records)
  // but company and duplicate lookups are now O(1) via pre-fetched maps
  for (const profile of profilesToProcess) {
    // Stop if we've used our chunk budget; remaining profiles will be picked up
    // on the next /poll call (resumability via existingPeopleMap/existingAlumniSet).
    if (attemptedThisCall >= maxItemsThisCall) break;
    if (Date.now() - chunkStart > CHUNK_WALL_MS) break;

    // Skip profiles already fully processed (person + alumni both exist).
    // This is the resumability mechanism — on the second/third/Nth chunk call we
    // walk the same profilesToProcess array but skip past previously-handled ones
    // in O(1) via the pre-fetched maps.
    const lkUrl = profile.linkedinUrl || profile.profileUrl || null;
    if (lkUrl && existingPeopleMap.has(lkUrl)) {
      const pid = existingPeopleMap.get(lkUrl)!;
      if (existingAlumniSet.has(pid)) continue; // already done — no work, no budget hit
    }

    attemptedThisCall++;
    try {
      const linkedinUrl = profile.linkedinUrl || profile.profileUrl || null;
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.fullName || "Unknown";

      // Check for duplicate person using pre-fetched map
      if (linkedinUrl && existingPeopleMap.has(linkedinUrl)) {
        const existingPersonId = existingPeopleMap.get(linkedinUrl)!;

        if (!existingAlumniSet.has(existingPersonId)) {
          const eduEntry = findEducationEntry(profile.education, universityName);
          await supabase.from("alumni").insert({
            person_id: existingPersonId,
            university_name: eduEntry?.schoolName || formatUniversityName(universityName),
            degree: eduEntry?.degree || null,
            field_of_study: eduEntry?.fieldOfStudy || null,
            graduation_year: eduEntry?.endYear || null,
            start_year: eduEntry?.startYear || null,
            current_status: profile.headline || "unknown",
          });
          existingAlumniSet.add(existingPersonId);
          processed++;
        } else {
          skipped++;
        }
        continue;
      }

      // Resolve company from pre-fetched map
      let companyId = null;
      const currentExp = Array.isArray(profile.experience) ? profile.experience[0] : null;
      if (currentExp?.companyName) {
        companyId = companyMap.get(currentExp.companyName) || null;
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

      let resolvedPersonId: string | null = newPerson?.id || null;

      // Recover from duplicate-key collisions. The pre-fetch can miss records when:
      //   1. A previous chunk inserted them moments ago (race window across calls)
      //   2. The PostgREST .in() filter silently dropped this URL from a prior batch
      // In either case, the row already exists — fetch its id and continue as if pre-fetched.
      if (personError && (personError.code === "23505" || /duplicate key/i.test(personError.message)) && linkedinUrl) {
        const { data: existing } = await supabase
          .from("people")
          .select("id")
          .eq("linkedin_url", linkedinUrl)
          .maybeSingle();
        if (existing?.id) {
          resolvedPersonId = existing.id;
          existingPeopleMap.set(linkedinUrl, existing.id);
        }
      }

      if (!resolvedPersonId) {
        failed++;
        continue;
      }

      // Track in-memory map so subsequent profiles in this chunk find it
      if (linkedinUrl) existingPeopleMap.set(linkedinUrl, resolvedPersonId);

      // Skip alumni insert if this person already has one (recovered duplicate path)
      if (existingAlumniSet.has(resolvedPersonId)) {
        skipped++;
      } else {
        // Insert alumni record
        const eduEntry = findEducationEntry(profile.education, universityName);
        const { error: alumniErr } = await supabase.from("alumni").insert({
          person_id: resolvedPersonId,
          university_name: eduEntry?.schoolName || formatUniversityName(universityName),
          degree: eduEntry?.degree || null,
          field_of_study: eduEntry?.fieldOfStudy || null,
          graduation_year: eduEntry?.endYear || null,
          start_year: eduEntry?.startYear || null,
          current_status: profile.headline || "unknown",
        });
        if (alumniErr) {
          // Treat alumni-insert failures as failed too, but don't count the person again.
          failed++;
          continue;
        }
        existingAlumniSet.add(resolvedPersonId);
        processed++;
      }
    } catch (e) {
      failed++;
    }

    // Flush counters every 10 ops so progress survives a Vercel SIGKILL.
    // (The previous flush-every-50 lost up to 49 profiles of progress per kill.)
    if (attemptedThisCall % 10 === 0) {
      await supabase.from("pipeline_runs").update({
        processed_items: processed,
        failed_items: failed,
        skipped_items: skipped,
      }).eq("id", runId);
    }
  }

  // Final flush for this chunk
  await supabase.from("pipeline_runs").update({
    processed_items: processed,
    failed_items: failed,
    skipped_items: skipped,
  }).eq("id", runId);

  // Determine whether we're truly done. We're done when every validated profile
  // either has a person+alumni pair already, OR we attempted it (success/fail/skip)
  // in this loop. The simplest reliable check: count alumni for these linkedin URLs.
  // If processed+failed+skipped >= profilesToProcess.length, we're done.
  // BUT we must use a stable measure: re-query the DB for actual coverage.
  const totalDone = processed + failed + skipped;
  const isComplete = totalDone >= profilesToProcess.length;

  if (isComplete) {
    // Update Apify credits (only on final completion to avoid double-charging on chunk retries)
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

  console.log(
    `[alumni] chunk done: attempted=${attemptedThisCall} | run totals: processed=${processed} (+${processed - startProcessed}), failed=${failed} (+${failed - startFailed}), skipped=${skipped} (+${skipped - startSkipped}) | total=${totalDone}/${profilesToProcess.length} | complete=${isComplete}`
  );

  return {
    done: isComplete,
    remaining: Math.max(0, profilesToProcess.length - totalDone),
  };
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

// ==================== JD BATCH API PIPELINE ====================

async function executeJDBatchSubmit(runId: string, config: any) {
  const batchSize = Math.min(parseInt(config.batch_size) || 2000, 5000);
  
  // Fetch jobs needing enrichment
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, company_name, description")
    .or("analysis_version.is.null,analysis_version.neq.v2")
    .not("description", "is", null)
    .limit(batchSize);

  if (error) throw error;
  if (!jobs?.length) {
    await supabase.from("pipeline_runs").update({ status: "completed", total_items: 0, processed_items: 0, completed_at: new Date().toISOString() }).eq("id", runId);
    return;
  }

  await supabase.from("pipeline_runs").update({ status: "running", total_items: jobs.length }).eq("id", runId);

  const validJobs = jobs.filter(j => j.description && j.description.length >= 100);
  const result = await submitJDBatch(validJobs);

  // Store batch_id in run config for polling
  await supabase.from("pipeline_runs").update({
    config: { ...config, _batch_id: result.batch_id, _job_count: result.request_count },
    status: "running",
    processed_items: 0,
  }).eq("id", runId);

  console.log(`[jd_batch_submit] Submitted ${result.request_count} jobs, batch_id: ${result.batch_id}`);
}

async function executeJDBatchPoll(runId: string, config: any) {
  const batchId = config._batch_id || config.batch_id;
  if (!batchId) throw new Error("batch_id required in config");

  const status = await pollBatch(batchId);
  
  await supabase.from("pipeline_runs").update({
    config: { ...config, _batch_status: status.status, _completed: status.completed, _total: status.total },
    processed_items: status.completed,
    failed_items: status.failed,
  }).eq("id", runId);

  if (status.status === "completed" && status.output_file_id) {
    const result = await processBatchResults(status.output_file_id, runId);
    await supabase.from("pipeline_runs").update({
      status: "completed",
      processed_items: result.processed,
      failed_items: result.failed,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
  } else if (["failed","expired","cancelled"].includes(status.status)) {
    await supabase.from("pipeline_runs").update({
      status: "failed",
      error_message: `Batch API ${status.status}`,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
  } else {
    // Still in progress — mark as running with progress
    await supabase.from("pipeline_runs").update({ status: "running" }).eq("id", runId);
  }
}


// MIDDLE EAST JOB PIPELINES
// Bayt.com (blackfalcondata/bayt-scraper) and NaukriGulf (blackfalcondata/naukrigulf-scraper)
// Pattern mirrors executeLinkedInJobs: role-driven keyword expansion, parallel Apify
// launches, poll loop, mapper, batch upsert into jobs table.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared helper: batch upsert a set of mapped job rows into `jobs`,
 * handling company resolution and incremental deduplification.
 * Used by both executeBaytJobs and executeNaukriGulfJobs.
 */
async function processMEJobResults(
  runId: string,
  datasetId: string,
  source: "bayt.com" | "naukrigulf.com",
  config: any,
  runMeta: { roleId?: string; roleName?: string; synonyms?: string[]; runId?: string }
): Promise<void> {
  // Paginate ALL dataset items (avoids the 2,500-item truncation bug)
  const rawItems: any[] = [];
  const PAGE_SIZE = 1000;
  let dsOffset = 0;
  while (true) {
    const pageRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=${PAGE_SIZE}&offset=${dsOffset}`
    );
    const page = await pageRes.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rawItems.push(...page);
    if (page.length < PAGE_SIZE) break;
    dsOffset += PAGE_SIZE;
  }

  if (rawItems.length === 0) return;
  await supabase.from("pipeline_runs").update({ total_items: rawItems.length }).eq("id", runId);

  // Build external_id set for dedup
  const externalIds = rawItems.map((item, i) =>
    String(item.jobId || item.jobKey || item.id || item.url || `${source}-${Date.now()}-${i}`)
  );
  const { data: existingJobs } = await supabase
    .from("jobs")
    .select("external_id")
    .eq("source", source)
    .in("external_id", externalIds);
  const existingIdSet = new Set((existingJobs || []).map((j: any) => j.external_id));

  // Batch-resolve / create companies
  const companyNames = [...new Set(rawItems.map(item => item.company).filter(Boolean))];
  const companyMap = new Map<string, string>();
  if (companyNames.length > 0) {
    const { data: existing } = await supabase
      .from("companies")
      .select("id, name")
      .in("name", companyNames);
    for (const c of existing || []) companyMap.set(c.name, c.id);

    const newNames = companyNames.filter(n => !companyMap.has(n));
    if (newNames.length > 0) {
      const rows = newNames.map(name => ({
        name,
        name_normalized: normalizeText(name),
        enrichment_status: "pending",
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { data: inserted } = await supabase
          .from("companies")
          .upsert(rows.slice(i, i + 100), { onConflict: "name" })
          .select("id, name");
        for (const c of inserted || []) companyMap.set(c.name, c.id);
      }
    }
  }

  // Map + filter
  const BATCH_SIZE = 100;
  const newJobs: any[] = [];
  let skipped = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const extId = externalIds[i];
    if (existingIdSet.has(extId)) { skipped++; continue; }

    const companyId = item.company ? (companyMap.get(item.company) || null) : null;
    let roleMatchScore: number | null = null;
    if (runMeta.synonyms && runMeta.synonyms.length > 0 && item.title) {
      roleMatchScore = computeRoleMatchScore(item.title, runMeta.synonyms);
    }

    const mapped = source === "bayt.com"
      ? mapBaytJob(item, { ...runMeta, runId }, companyId, roleMatchScore)
      : mapNaukriGulfJob(item, { ...runMeta, runId }, companyId, roleMatchScore);

    // Stamp correct external_id (mapper uses same logic, but let's be explicit)
    mapped.external_id = extId;
    newJobs.push(mapped);
  }

  // Batch insert
  let processed = 0, failed = 0;
  for (let i = 0; i < newJobs.length; i += BATCH_SIZE) {
    const batch = newJobs.slice(i, i + BATCH_SIZE);
    try {
      const { data: inserted, error } = await supabase.from("jobs").insert(batch).select("id");
      if (error) {
        for (const job of batch) {
          try { await supabase.from("jobs").insert(job); processed++; } catch { failed++; }
        }
      } else {
        processed += (inserted || []).length;
      }
    } catch { failed += batch.length; }

    await supabase.from("pipeline_runs").update({
      processed_items: processed, failed_items: failed, skipped_items: skipped,
    }).eq("id", runId);
  }

  // Credits
  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";
  await supabase.rpc("increment_credits_used", { p_provider: "apify", p_month: currentMonth, p_amount: processed });

  await supabase.from("pipeline_runs").update({
    status: "completed",
    processed_items: processed,
    failed_items: failed,
    skipped_items: skipped,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
}

/**
 * Execute a Bayt.com jobs collection run.
 * Actor: blackfalcondata/bayt-scraper
 * Supports: keywords, country, careerLevel, datePosted, maxResults, incrementalMode
 */
async function executeBaytJobs(runId: string, config: any): Promise<void> {
  if (!APIFY_API_KEY) throw new Error("Apify API key not configured");

  // Country mapping: UI passes full names, actor expects portal codes
  // Actor expects ISO-style portal codes: AE, SA, KW, QA, BH, OM, EG, JO, LB, IN, PK, IQ, MA, INTERNATIONAL
  const COUNTRY_TO_CODE: Record<string, string> = {
    "United Arab Emirates": "AE", "UAE": "AE", "AE": "AE",
    "Saudi Arabia": "SA", "KSA": "SA", "SA": "SA",
    "Kuwait": "KW", "KWT": "KW", "KW": "KW",
    "Qatar": "QA", "QAT": "QA", "QA": "QA",
    "Bahrain": "BH", "BHR": "BH", "BH": "BH",
    "Oman": "OM", "OMN": "OM", "OM": "OM",
    "Egypt": "EG", "EGY": "EG", "EG": "EG",
    "Jordan": "JO", "JOR": "JO", "JO": "JO",
    "Lebanon": "LB", "LBN": "LB", "LB": "LB",
    "India": "IN", "IN": "IN",
    "Pakistan": "PK", "PAK": "PK", "PK": "PK",
  };
  const countryCode = COUNTRY_TO_CODE[config?.country || ""] || "INTERNATIONAL";

  // Build keyword runs — one per job role (same synonym expansion as LinkedIn)
  const KEYWORD_CAP = 500;
  const jobRoleIds = config?.job_role_ids as string[] | undefined;
  let runs: { keywords: string; roleId?: string; roleName?: string; synonyms?: string[] }[] = [];

  if (jobRoleIds && jobRoleIds.length > 0) {
    const { data: roles } = await supabase.from("job_roles").select("id, name, synonyms").in("id", jobRoleIds);
    if (roles && roles.length > 0) {
      for (const r of roles) {
        const syns = ((r.synonyms as string[]) || []).filter(Boolean);
        const joined = syns.map(s => `"${s}"`).join(" OR ");
        if (joined.length <= KEYWORD_CAP) {
          runs.push({ keywords: joined || r.name, roleId: r.id, roleName: r.name, synonyms: syns.length ? syns : [r.name] });
        } else {
          // Split into chunks
          const chunks: string[][] = [];
          let cur: string[] = [], curLen = 0;
          for (const s of syns) {
            const add = (cur.length ? 4 : 0) + s.length + 2;
            if (curLen + add > KEYWORD_CAP && cur.length > 0) { chunks.push(cur); cur = []; curLen = 0; }
            cur.push(s); curLen += add;
          }
          if (cur.length > 0) chunks.push(cur);
          for (const chunk of chunks) {
            runs.push({ keywords: chunk.map(s => `"${s}"`).join(" OR "), roleId: r.id, roleName: r.name, synonyms: chunk });
          }
        }
      }
    }
  }
  if (runs.length === 0) {
    runs = [{ keywords: config?.keywords || config?.search_keywords || "software engineer" }];
  }

  // Persist run metadata (launch phase — apify run IDs added after launch)
  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _job_roles: runs.map(r => ({ id: r.roleId, name: r.roleName })),
      _provider: "apify",
      _actor: "blackfalcondata/bayt-scraper",
      _phase: "launched",
    },
  }).eq("id", runId);

  // Launch all Apify runs in parallel
  const apifyRuns: any[] = [];
  await Promise.all(runs.map(async (run) => {
    try {
      // Map days_old to actor's datePosted enum
      const daysOldMap: Record<string, string> = {
        "1": "past-24h", "24": "past-24h",
        "7": "past-week", "14": "past-week",
        "30": "past-month", "31": "past-month",
      };
      const datePosted = daysOldMap[String(config?.days_old || 7)] || "past-week";
      const input: Record<string, any> = {
        query: run.keywords,              // actor field is "query", not "keywords"
        country: countryCode,             // actor expects "AE", "SA", etc.
        maxResults: parseInt(config?.limit) || 200,
        datePosted,                       // actor field, not daysOld
        includeDetails: true,             // actor field is "includeDetails", not "fetchDetails"
        incrementalMode: config?.incremental === true,  // default false until baseline established
        stateKey: `bayt-${countryCode.toLowerCase()}-${(run.roleName || run.keywords).toLowerCase().replace(/[^a-z0-9]/g, "-").substring(0, 40)}`,
      };
      if (config?.career_level) input.careerLevel = config.career_level;
      if (config?.location) input.location = config.location;
      const apifyUrl = `https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/runs?token=${APIFY_API_KEY}`;
      const apifyRes = await fetch(apifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (apifyRes.ok) {
        const d = await apifyRes.json();
        apifyRuns.push({ runId: d.data?.id, datasetId: d.data?.defaultDatasetId, ...run, _done: false });
      } else {
        console.error(`[executeBaytJobs] Apify launch error: ${apifyRes.status} ${await apifyRes.text().then(t => t.substring(0, 200))}`);
      }
    } catch (err: any) {
      console.error(`[executeBaytJobs] Launch failed: ${err.message}`);
    }
  }));

  const launchedRuns = apifyRuns.filter(r => r.runId);
  if (launchedRuns.length === 0) {
    throw new Error(`[executeBaytJobs] No Apify runs launched. Roles: ${runs.length}, Sample keywords: ${runs[0]?.keywords?.substring(0, 100)}`);
  }

  // Store apifyRunIds so the scheduler tick can resolve them asynchronously.
  // This decouples the poll from the Vercel 300s function lifetime — critical for 20K scale.
  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _job_roles: runs.map(r => ({ id: r.roleId, name: r.roleName })),
      _provider: "apify",
      _actor: "blackfalcondata/bayt-scraper",
      _phase: "pending_resolve",
      _apify_run_ids: launchedRuns.map(r => ({
        runId: r.runId,
        datasetId: r.datasetId,
        roleId: r.roleId,
        roleName: r.roleName,
        synonyms: r.synonyms || [],
      })),
      _launched_at: new Date().toISOString(),
    },
  }).eq("id", runId);
  // Scheduler tick will call resolvePendingMEJobs() to poll + process results.
}

/**
 * Execute a NaukriGulf jobs collection run.
 * Actor: blackfalcondata/naukrigulf-scraper
 * Supports: query, location, maxResults, incrementalMode
 */
async function executeNaukriGulfJobs(runId: string, config: any): Promise<void> {
  if (!APIFY_API_KEY) throw new Error("Apify API key not configured");

  const location = config?.location || "UAE";

  // Build keyword runs — same role expansion pattern
  const KEYWORD_CAP = 400;
  const jobRoleIds = config?.job_role_ids as string[] | undefined;
  let runs: { keywords: string; roleId?: string; roleName?: string; synonyms?: string[] }[] = [];

  if (jobRoleIds && jobRoleIds.length > 0) {
    const { data: roles } = await supabase.from("job_roles").select("id, name, synonyms").in("id", jobRoleIds);
    if (roles && roles.length > 0) {
      for (const r of roles) {
        const syns = ((r.synonyms as string[]) || []).filter(Boolean);
        // NaukriGulf query: comma-separated works well (no boolean operator needed)
        const query = syns.length > 0 ? syns.slice(0, 8).join(", ") : r.name;
        runs.push({ keywords: query.substring(0, KEYWORD_CAP), roleId: r.id, roleName: r.name, synonyms: syns.length ? syns : [r.name] });
      }
    }
  }
  if (runs.length === 0) {
    runs = [{ keywords: config?.keywords || config?.search_keywords || "software engineer" }];
  }

  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _job_roles: runs.map(r => ({ id: r.roleId, name: r.roleName })),
      _provider: "apify",
      _actor: "blackfalcondata/naukrigulf-scraper",
      _phase: "launched",
    },
  }).eq("id", runId);

  const apifyRuns: any[] = [];
  await Promise.all(runs.map(async (run) => {
    try {
      const input = {
        mode: "search",
        query: run.keywords,
        location,
        maxResults: parseInt(config?.limit) || 200,
        includeDetails: true,
        incrementalMode: config?.incremental === true,  // default false until baseline established
        stateKey: `ng-${location.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${(run.roleName || run.keywords).toLowerCase().replace(/[^a-z0-9]/g, "-").substring(0, 40)}`,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      };
      const apifyUrl = `https://api.apify.com/v2/acts/blackfalcondata~naukrigulf-scraper/runs?token=${APIFY_API_KEY}`;
      const apifyRes = await fetch(apifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (apifyRes.ok) {
        const d = await apifyRes.json();
        apifyRuns.push({ runId: d.data?.id, datasetId: d.data?.defaultDatasetId, ...run, _done: false });
      } else {
        console.error(`[executeNaukriGulfJobs] Apify launch error: ${apifyRes.status} ${await apifyRes.text().then(t => t.substring(0, 200))}`);
      }
    } catch (err: any) {
      console.error(`[executeNaukriGulfJobs] Launch failed: ${err.message}`);
    }
  }));

  const launchedRuns = apifyRuns.filter(r => r.runId);
  if (launchedRuns.length === 0) {
    throw new Error(`[executeNaukriGulfJobs] No Apify runs launched. Roles: ${runs.length}, Sample query: ${runs[0]?.keywords?.substring(0, 100)}`);
  }

  // Store apifyRunIds for async resolution by scheduler tick.
  await supabase.from("pipeline_runs").update({
    config: {
      ...config,
      _job_roles: runs.map(r => ({ id: r.roleId, name: r.roleName })),
      _provider: "apify",
      _actor: "blackfalcondata/naukrigulf-scraper",
      _phase: "pending_resolve",
      _apify_run_ids: launchedRuns.map(r => ({
        runId: r.runId,
        datasetId: r.datasetId,
        roleId: r.roleId,
        roleName: r.roleName,
        synonyms: r.synonyms || [],
      })),
      _launched_at: new Date().toISOString(),
    },
  }).eq("id", runId);
  // Scheduler tick will call resolvePendingMEJobs() to poll + process results.
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC RESOLVE: Called by scheduler tick to poll + process pending ME runs.
// Handles both bayt_jobs and naukrigulf_jobs pipeline types.
// ─────────────────────────────────────────────────────────────────────────────

export async function resolvePendingMEJobs(): Promise<{ resolved: number; still_pending: number; errors: string[] }> {
  const APIFY_API_KEY = process.env.APIFY_API_KEY;
  if (!APIFY_API_KEY) return { resolved: 0, still_pending: 0, errors: ["No APIFY_API_KEY"] };

  // Find all ME pipeline runs in pending_resolve state (launched > 90s ago)
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const { data: pendingRuns, error } = await supabase
    .from("pipeline_runs")
    .select("id, pipeline_type, config, started_at")
    .in("pipeline_type", ["bayt_jobs", "naukrigulf_jobs"])
    .eq("status", "running")
    .lte("started_at", cutoff);

  if (error || !pendingRuns || pendingRuns.length === 0) {
    return { resolved: 0, still_pending: 0, errors: error ? [error.message] : [] };
  }

  const pendingPhase = pendingRuns.filter((r: any) => r.config?._phase === "pending_resolve");
  let resolved = 0, still_pending = 0;
  const errors: string[] = [];

  for (const run of pendingPhase) {
    const apifyRunIds: any[] = run.config?._apify_run_ids || [];
    if (apifyRunIds.length === 0) continue;

    let allDone = true;
    for (const r of apifyRunIds) {
      if (!r.runId || r._done) continue;
      try {
        const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${r.runId}?token=${APIFY_API_KEY}`);
        const d = await pollRes.json();
        const st = d.data?.status;
        if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(st)) {
          r._done = true; r._status = st;
        } else {
          allDone = false;
        }
      } catch (e: any) {
        allDone = false;
        errors.push(`Poll error for run ${run.id}: ${e.message}`);
      }
    }

    if (!allDone) {
      // Check if run has been pending too long (> 30 min = actor likely failed)
      const launchedAt = run.config?._launched_at ? new Date(run.config._launched_at) : new Date(run.started_at);
      const ageMins = (Date.now() - launchedAt.getTime()) / 60_000;
      if (ageMins > 30) {
        await supabase.from("pipeline_runs").update({
          status: "failed",
          error_message: `ME pipeline timed out: Apify runs still pending after ${Math.round(ageMins)} minutes`,
          completed_at: new Date().toISOString(),
        }).eq("id", run.id);
        errors.push(`Run ${run.id} timed out after ${Math.round(ageMins)} min`);
      } else {
        still_pending++;
      }
      continue;
    }

    // All Apify runs resolved — process the succeeded ones
    const source = run.pipeline_type === "bayt_jobs" ? "bayt.com" : "naukrigulf.com";
    for (const r of apifyRunIds) {
      if (r._status === "SUCCEEDED" && r.datasetId) {
        try {
          await processMEJobResults(run.id, r.datasetId, source as "bayt.com" | "naukrigulf.com", run.config, {
            roleId: r.roleId, roleName: r.roleName, synonyms: r.synonyms || [],
          });
        } catch (e: any) {
          errors.push(`processMEJobResults error for run ${run.id}: ${e.message}`);
        }
      }
    }

    // processMEJobResults marks the run completed — if none succeeded, mark failed
    const succeededCount = apifyRunIds.filter((r: any) => r._status === "SUCCEEDED").length;
    if (succeededCount === 0) {
      await supabase.from("pipeline_runs").update({
        status: "failed",
        error_message: `All ${apifyRunIds.length} Apify runs failed/aborted`,
        completed_at: new Date().toISOString(),
      }).eq("id", run.id);
    }

    resolved++;
  }

  return { resolved, still_pending, errors };
}
