import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, APIFY_API_KEY } from "../lib/supabase";
import { AuthResult, requireReader, requirePermission, verifyAuth } from "../lib/auth";
import { executePipeline } from "./pipelines";

// ── Compute next run time from frequency or cron expression ─────────────────
function calculateNextRun(frequency: string, cronExpression?: string): string {
  const now = new Date();
  if (frequency === "hourly") return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (frequency === "daily") return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  if (frequency === "weekly") return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (frequency === "monthly") return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Parse simple cron expressions: minute hour * * *
  if (cronExpression) {
    try {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length >= 2) {
        const [minute, hour] = parts;
        const next = new Date(now);
        next.setUTCSeconds(0, 0);
        const targetMin = minute === "*" ? now.getUTCMinutes() : parseInt(minute);
        const targetHour = hour === "*" ? now.getUTCHours() : (hour.startsWith("*/") ? now.getUTCHours() : parseInt(hour));
        
        if (hour === "*") {
          // Every hour at :minute
          next.setUTCMinutes(targetMin);
          if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
        } else if (hour.startsWith("*/")) {
          // Every N hours
          const n = parseInt(hour.slice(2));
          next.setUTCHours(next.getUTCHours() + n);
        } else {
          // Specific hour daily
          next.setUTCHours(targetHour, targetMin);
          if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
        }
        return next.toISOString();
      }
    } catch { /* fall through */ }
  }

  // Default: next day at midnight
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

// ── Trigger a single schedule ────────────────────────────────────────────────
async function triggerSchedule(schedule: any): Promise<{ success: boolean; run_id?: string; error?: string }> {
  try {
    const { data: run, error } = await supabase
      .from("pipeline_runs")
      .insert({
        pipeline_type: schedule.pipeline_type,
        trigger_type: "scheduled",
        config: schedule.config || {},
        status: "running",
        started_at: new Date().toISOString(),
        triggered_by: "scheduler",
        schedule_id: schedule.id,
      })
      .select()
      .single();

    if (error || !run) throw new Error(error?.message || "Failed to create run");

    // For async pipelines (LinkedIn, Alumni): start Apify actor inline
    if (schedule.pipeline_type === "linkedin_jobs" && APIFY_API_KEY) {
      const cfg = schedule.config || {};
      const actorInput = {
        keywords: cfg.search_keywords || cfg.keywords || "software engineer",
        location: cfg.location || "India",
        maxPages: Math.ceil((parseInt(cfg.limit) || 100) / 10),
      };
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/practicaltools~linkedin-jobs/runs?token=${APIFY_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput) }
      );
      if (startRes.ok) {
        const apifyData = await startRes.json();
        await supabase.from("pipeline_runs").update({
          config: { ...cfg, _provider_run_id: apifyData.data?.id, _provider_dataset_id: apifyData.data?.defaultDatasetId },
        }).eq("id", run.id);
      }
    } else {
      // Sync pipelines: execute directly
      await executePipeline(run.id, schedule.pipeline_type, schedule.config || {}).catch(console.error);
    }

    return { success: true, run_id: run.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Auto-chaining: if jd_enrichment has more jobs to process, queue another ──
async function checkAndChainEnrichment(): Promise<void> {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 5) return; // Only chain before 5 AM UTC to avoid next-day overlap

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .is("analysis_version", null)
    .not("description", "is", null);

  if ((count || 0) > 0) {
    console.log(`[scheduler] Auto-chaining jd_enrichment: ${count} jobs pending`);
    const { data: run } = await supabase
      .from("pipeline_runs")
      .insert({
        pipeline_type: "jd_enrichment",
        trigger_type: "auto_chain",
        config: { batch_size: 200 },
        status: "running",
        started_at: new Date().toISOString(),
        triggered_by: "scheduler_chain",
      })
      .select()
      .single();

    if (run) {
      await executePipeline(run.id, "jd_enrichment", { batch_size: 200 }).catch(console.error);
    }
  }
}

// ── Main scheduler route handler ─────────────────────────────────────────────
export async function handleSchedulerRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {

  // ── POST /scheduler/tick — nightly cron trigger ───────────────────────────
  if ((path === "/scheduler/tick" || path === "/scheduler/tick/") && (req.method === "POST" || req.method === "GET")) {
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret =
      (req.headers["x-cron-secret"] as string) ||
      (req.headers["authorization"] as string)?.replace("Bearer ", "") ||
      (req.query?.secret as string);

    const isVercelCron = req.headers["x-vercel-cron"] === "1";

    if (cronSecret && !isVercelCron && providedSecret !== cronSecret) {
      // Also allow authenticated admin users
      if (!auth.nexusUser) return res.status(401).json({ error: "Unauthorized" });
    }

    // Find all due schedules
    const { data: dueSchedules, error: schedErr } = await supabase
      .from("pipeline_schedules")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", new Date().toISOString())
      .order("next_run_at", { ascending: true });

    if (schedErr) return res.status(500).json({ error: schedErr.message });

    const results: any[] = [];
    for (const schedule of dueSchedules || []) {
      const result = await triggerSchedule(schedule);

      // Update schedule: advance next_run_at, update stats
      const nextRunAt = calculateNextRun(schedule.frequency, schedule.cron_expression);
      await supabase.from("pipeline_schedules").update({
        last_run_at: new Date().toISOString(),
        last_run_status: result.success ? "completed" : "failed",
        total_runs: (schedule.total_runs || 0) + 1,
        next_run_at: nextRunAt,
      }).eq("id", schedule.id);

      results.push({ schedule_name: schedule.name, ...result, next_run_at: nextRunAt });
    }

    // Auto-chain jd_enrichment if needed
    await checkAndChainEnrichment().catch(console.error);

    return res.json({
      triggered: results.length,
      timestamp: new Date().toISOString(),
      schedules: results,
    });
  }

  // All remaining routes require reader auth
  if (!requireReader(auth, "pipelines", res)) return;

  // ── GET /scheduler/schedules ─────────────────────────────────────────────
  if (path === "/scheduler/schedules" && req.method === "GET") {
    const { data, error } = await supabase
      .from("pipeline_schedules")
      .select("*")
      .order("next_run_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // ── POST /scheduler/schedules — create new schedule ──────────────────────
  if (path === "/scheduler/schedules" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return;
    const { name, pipeline_type, config, frequency, cron_expression, is_active } = req.body || {};
    if (!name || !pipeline_type || !frequency) {
      return res.status(400).json({ error: "name, pipeline_type, and frequency are required" });
    }
    const next_run_at = calculateNextRun(frequency, cron_expression);
    const { data, error } = await supabase
      .from("pipeline_schedules")
      .insert({ name, pipeline_type, config: config || {}, frequency, cron_expression, is_active: is_active !== false, next_run_at })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── PATCH /scheduler/schedules/:id ───────────────────────────────────────
  if (path.match(/^\/scheduler\/schedules\/[^/]+$/) && req.method === "PATCH") {
    if (!requirePermission("pipelines", "full")(auth, res)) return;
    const id = path.split("/").pop();
    const updates = req.body || {};
    if (updates.frequency || updates.cron_expression) {
      updates.next_run_at = calculateNextRun(updates.frequency, updates.cron_expression);
    }
    const { data, error } = await supabase
      .from("pipeline_schedules")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── POST /scheduler/run/:id — manual trigger ─────────────────────────────
  if (path.match(/^\/scheduler\/run\/[^/]+$/) && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return;
    const id = path.split("/").pop();
    const { data: schedule, error } = await supabase
      .from("pipeline_schedules")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !schedule) return res.status(404).json({ error: "Schedule not found" });

    const result = await triggerSchedule(schedule);
    await supabase.from("pipeline_schedules").update({
      last_run_at: new Date().toISOString(),
      last_run_status: result.success ? "completed" : "failed",
      total_runs: (schedule.total_runs || 0) + 1,
    }).eq("id", id);

    return res.json(result);
  }

  return undefined;
}
