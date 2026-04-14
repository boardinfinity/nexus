import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission, requireReader } from "../lib/auth";
import { supabase, APIFY_API_KEY, RAPIDAPI_KEY, OPENAI_API_KEY } from "../lib/supabase";
import { callGPT } from "../lib/openai";
import { submitJDBatch, pollBatch, processBatchResults } from "../lib/batch";
import { normalizeText, mapEmploymentType, mapEmploymentTypeExtended, mapSeniority, upsertCompanyByName, findEducationEntry, formatUniversityName, mapPersonSeniority, mapPersonFunction, generatePeopleSearchStub } from "../lib/helpers";

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

      // Build keywords: if job_role_ids provided, expand to synonym OR queries
      let keywords = config?.search_keywords || config?.keywords || "software engineer";
      const jobRoleIds = config?.job_role_ids as string[] | undefined;
      let jobRoleMeta: { id: string; name: string }[] = [];
      if (jobRoleIds && jobRoleIds.length > 0) {
        const { data: roles } = await supabase
          .from("job_roles")
          .select("id, name, synonyms")
          .in("id", jobRoleIds);
        if (roles && roles.length > 0) {
          // Combine all synonyms with OR for a single run
          const allSynonyms = roles.flatMap(r => (r.synonyms as string[]) || []);
          keywords = allSynonyms.map(s => `"${s}"`).join(" OR ");
          jobRoleMeta = roles.map(r => ({ id: r.id, name: r.name }));
        }
      }

      const actorInput: Record<string, any> = {
        keywords,
        location: config?.location || "India",
        maxPages: Math.ceil((parseInt(config?.limit) || 100) / 10),
      };
      // Time filter
      if (config?.date_posted && timePostedMap[config.date_posted]) {
        actorInput.timePosted = timePostedMap[config.date_posted];
      }
      // Experience level (array of strings: "1"-"6")
      if (config?.experience_level) {
        actorInput.experienceLevel = config.experience_level.split(",").filter(Boolean);
      }
      // Work type (array of strings: "1"-"6")
      if (config?.work_type) {
        actorInput.workType = config.work_type.split(",").filter(Boolean);
      }
      // Work location (array: "1" on-site, "2" remote, "3" hybrid)
      if (config?.work_location) {
        actorInput.workLocation = config.work_location.split(",").filter(Boolean);
      }
      // Industry IDs (array of strings)
      if (config?.industry_ids) {
        actorInput.industryIds = config.industry_ids.split(",").filter(Boolean);
      }
      // Company names (array)
      if (config?.company_names) {
        actorInput.companyNames = config.company_names.split(",").filter(Boolean);
      }
      // Fetch full job descriptions
      if (config?.fetch_description !== undefined) {
        actorInput.fetchDescription = !!config.fetch_description;
      }
      // Easy apply filter
      if (config?.easy_apply_only) {
        actorInput.easyApplyOnly = true;
      }
      // Sort: "R" relevance or "DD" date
      if (config?.sort_by) {
        actorInput.sortBy = config.sort_by;
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
      // Store role metadata in config for later tagging
      if (jobRoleMeta.length > 0) {
        config._job_roles = jobRoleMeta;
      }
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
    if (!requirePermission("pipelines", "full")(auth, res)) return;
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

export export async function executePipeline(runId: string, pipelineType: string, config: any) {
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
    } else if (pipelineType === "jd_batch_submit") {
      await executeJDBatchSubmit(runId, config);
    } else if (pipelineType === "jd_batch_poll") {
      await executeJDBatchPoll(runId, config);
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

  // Batch insert new companies
  const newCompanyNames = companyNames.filter(name => !companyMap.has(name));
  if (newCompanyNames.length > 0) {
    const companyRows = newCompanyNames.map(name => {
      const item = jobs.find(j => (j.company || j.companyName) === name);
      return {
        name,
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

    newJobs.push({
      external_id: externalId,
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

      // Rate limit: 300ms between API calls (was 1000ms)
      await new Promise(r => setTimeout(r, 300));
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

// ==================== JD ANALYSIS PIPELINE (Feature 5 — Enhanced jd_enrichment) ====================

async function executeJDEnrichment(runId: string, config: any) {
  const batchSize = Math.min(parseInt(config.batch_size) || 200, 2000);
  const GPT_BATCH = parseInt(config.gpt_batch_size) || 3; // jobs per GPT call (default 3, configurable)
  const CONCURRENCY = 3; // parallel GPT calls

  const jobIds: string[] = config.job_ids || [];

  // If specific job IDs passed (single-job "Analyze JD" button), fetch those directly.
  // Otherwise process queue: pending/partial enrichment status.
  let jobQuery = supabase
    .from("jobs")
    .select("id, title, company_name, description");

  if (jobIds.length > 0) {
    jobQuery = jobQuery.in("id", jobIds).not("description", "is", null);
  } else {
    jobQuery = jobQuery
      .in("enrichment_status", ["pending", "partial"])
      .not("description", "is", null)
      .order("created_at", { ascending: false })
      .limit(batchSize);
  }

  const { data: jobs, error } = await jobQuery;

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

  // Helper: process a batch of jobs in a single GPT call (batch skill + field extraction)
  async function processBatchGPT(batch: typeof validJobs) {
    const descriptions = batch.map(j =>
      `[JOB_ID:${j.id}]\nTitle: ${j.title}\nCompany: ${j.company_name || "Unknown"}\nDescription: ${j.description!.slice(0, 2000)}`
    ).join("\n\n===\n\n");

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
            content: `You are an expert job description analyst. Extract structured information from EACH job description below and return JSON.

Return a JSON object with:
{ "jobs": [
  {
    "job_id": "the JOB_ID from the input",
    "skills": [{ "name": string, "type": "technical"|"soft"|"domain"|"tool", "required": boolean, "confidence": number (0-1) }],
    "experience": { "min_years": number|null, "max_years": number|null, "level": "entry"|"mid"|"senior"|"lead"|"executive"|null },
    "education": string[],
    "certifications": string[],
    "industry": string|null,
    "tools_platforms": string[],
    "work_mode": "remote"|"hybrid"|"onsite"|null,
    "responsibilities": string[],
    "seniority": "intern"|"entry"|"mid"|"senior"|"lead"|"manager"|"director"|"executive"|null,
    "functions": string[]
  }
]}

Extract 10-40 skills per job. Be specific (e.g. "React.js" not "frontend", "PostgreSQL" not "database").`,
          },
          {
            role: "user",
            content: descriptions,
          },
        ],
        temperature: 0.2,
        max_completion_tokens: 4000,
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
    const parsed = JSON.parse(content);
    const jobResults: any[] = parsed.jobs || [];

    // Map results back to individual jobs
    const resultMap = new Map<string, any>();
    for (const jr of jobResults) {
      if (jr.job_id) resultMap.set(jr.job_id, jr);
    }

    // Pre-load taxonomy for in-memory matching
    const taxMap = await getTaxonomyMap();

    // Process each job's extracted data
    for (const job of batch) {
      const extracted = resultMap.get(job.id);
      if (!extracted) {
        failed++;
        continue;
      }

      // Match extracted skills against taxonomy using in-memory map
      const skills = extracted.skills || [];
      const skillRows: any[] = [];
      const unmatchedSkills: string[] = [];

      for (const skill of skills) {
        if (skill.confidence < 0.6) continue;

        const normalizedName = (skill.name || "").toLowerCase();
        const taxMatch = taxMap.get(normalizedName);
        let taxonomySkillId: string | null = taxMatch?.id || null;

        if (!taxonomySkillId) {
          unmatchedSkills.push(skill.name);
        }

        skillRows.push({
          job_id: job.id,
          skill_name: skill.name,
          skill_category: skill.type || "technical",
          confidence_score: skill.confidence,
          extraction_method: "ai_enhanced",
          taxonomy_skill_id: taxonomySkillId,
          is_required: skill.required ?? null,
        });
      }

      // Bulk auto-create unmatched skills as 'unverified' (replaces per-skill RPC N+1)
      if (unmatchedSkills.length > 0) {
        try {
          // Step 1: Bulk insert new skills (ON CONFLICT DO NOTHING = safe)
          await supabase.from("taxonomy_skills").upsert(
            unmatchedSkills.map(name => ({
              name: name.trim(),
              status: "unverified",
              is_auto_created: true,
              created_at: new Date().toISOString(),
            })),
            { onConflict: "name", ignoreDuplicates: true }
          );
          
          // Step 2: Fetch IDs for ALL unmatched skills in ONE query
          const { data: newSkillRows } = await supabase
            .from("taxonomy_skills")
            .select("id, name")
            .in("name", unmatchedSkills.map(n => n.trim()));
          
          // Step 3: Update skillRows with the fetched IDs
          for (const s of newSkillRows || []) {
            const row = skillRows.find(r => r.skill_name?.toLowerCase() === s.name?.toLowerCase());
            if (row) row.taxonomy_skill_id = s.id;
          }
        } catch (e) {
          // Skip if taxonomy_skills schema mismatch — skills still inserted without ID
        }
      }

      // Batch upsert all skills for this job
      if (skillRows.length > 0) {
        await supabase.from("job_skills").upsert(skillRows, { onConflict: "job_id,skill_name" });
      }

      // Update job record with structured fields
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

      await supabase.from("enrichment_logs").insert({
        entity_type: "job",
        entity_id: job.id,
        provider: "openai",
        operation: "jd_analysis",
        status: "success",
        credits_used: Math.round((tokenUsage.total_tokens || 0) / batch.length),
        details: { skills_extracted: skills.length, model: "gpt-4.1-mini", tokens: tokenUsage, batch_size: batch.length },
      });

      processed++;
    }
  }

  // Split jobs into GPT batches of 5, then run 3 GPT calls concurrently
  const gptBatches: (typeof validJobs)[] = [];
  for (let i = 0; i < validJobs.length; i += GPT_BATCH) {
    gptBatches.push(validJobs.slice(i, i + GPT_BATCH));
  }

  for (let i = 0; i < gptBatches.length; i += CONCURRENCY) {
    const concurrentBatches = gptBatches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      concurrentBatches.map(batch => processBatchGPT(batch))
    );

    for (const r of results) {
      if (r.status === "rejected") {
        // Count all jobs in the failed batch as failures
        failed += GPT_BATCH;
        console.error("[JD Analysis] Batch error:", r.reason?.message || r.reason);
      }
    }

    await supabase.from("pipeline_runs").update({
      processed_items: processed,
      failed_items: failed,
    }).eq("id", runId);

    // Rate limit: 2 second delay between concurrent rounds
    if (i + CONCURRENCY < gptBatches.length) {
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

  // Pre-fetch existing people by LinkedIn URL in batch
  const linkedinUrls = profiles
    .map(p => p.linkedinUrl || p.profileUrl)
    .filter(Boolean) as string[];
  const existingPeopleMap = new Map<string, string>();
  if (linkedinUrls.length > 0) {
    // Fetch in batches of 500 to avoid query limits
    for (let i = 0; i < linkedinUrls.length; i += 500) {
      const batch = linkedinUrls.slice(i, i + 500);
      const { data: existingPeople } = await supabase
        .from("people")
        .select("id, linkedin_url")
        .in("linkedin_url", batch);
      for (const p of existingPeople || []) {
        if (p.linkedin_url) existingPeopleMap.set(p.linkedin_url, p.id);
      }
    }
  }

  // Pre-fetch existing alumni records for these people
  const existingPersonIds = [...existingPeopleMap.values()];
  const existingAlumniSet = new Set<string>();
  if (existingPersonIds.length > 0) {
    for (let i = 0; i < existingPersonIds.length; i += 500) {
      const batch = existingPersonIds.slice(i, i + 500);
      const { data: existingAlumni } = await supabase
        .from("alumni")
        .select("person_id")
        .in("person_id", batch);
      for (const a of existingAlumni || []) {
        existingAlumniSet.add(a.person_id);
      }
    }
  }

  // Pre-fetch existing companies by name in batch
  const companyNames = [...new Set(
    profiles
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

  // Process profiles — still sequential for person inserts (need IDs for alumni records)
  // but company and duplicate lookups are now O(1) via pre-fetched maps
  for (const profile of profiles) {
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

      if (personError || !newPerson) {
        failed++;
        continue;
      }

      // Track newly inserted person in maps
      if (linkedinUrl) existingPeopleMap.set(linkedinUrl, newPerson.id);

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

    if ((processed + failed + skipped) % 50 === 0) {
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

