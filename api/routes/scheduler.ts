import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { AuthResult, requireReader, requirePermission, verifyAuth } from "../lib/auth";
import { executePipeline } from "./pipelines";

// ── Compute next run time from frequency or cron expression ─────────────────
function calculateNextRun(frequency: string, cronExpression?: string): string {
  const now = new Date();

  // Prioritize cron expression — handles comma-separated hours, day-of-week, etc.
  if (cronExpression && cronExpression.trim()) {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [min, hour, _dom, _mon, dow] = parts;

      const minutes = min === "*" ? [now.getUTCMinutes()] : min.split(",").map(Number);
      const hours = hour === "*"
        ? Array.from({ length: 24 }, (_, i) => i)
        : hour.split(",").map(Number);
      const dows = dow === "*" ? null : dow.split(",").map(Number);

      // Search up to 8 days ahead for the next matching slot
      for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const candidate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        if (dows && !dows.includes(candidate.getUTCDay())) continue;

        for (const h of hours) {
          for (const m of minutes) {
            candidate.setUTCHours(h, m, 0, 0);
            if (candidate > now) return candidate.toISOString();
          }
        }
      }
    }
  }

  // Fallback to frequency string
  if (frequency === "hourly") return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (frequency === "daily") return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  if (frequency === "weekly") return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (frequency === "monthly") return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

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

    // Execute pipeline synchronously — Vercel kills the function after response,
    // so we must complete execution before returning.
    await executePipeline(run.id, schedule.pipeline_type, schedule.config || {}).catch((err) => {
      console.error(`Schedule ${schedule.name} failed:`, err.message);
      supabase.from("pipeline_runs").update({
        status: "failed", error_message: err.message, completed_at: new Date().toISOString(),
      }).eq("id", run.id);
    });

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

    // Process 1 schedule per tick — each takes 1-4 minutes to execute.
    // With cron every 5 minutes, all schedules clear within ~40 min.
    const MAX_PER_TICK = 1;
    const toProcess = (dueSchedules || []).slice(0, MAX_PER_TICK);

    const results: any[] = [];
    for (const schedule of toProcess) {
      const result = await triggerSchedule(schedule);

      // Advance next_run_at immediately so it's not re-triggered next tick
      const nextRunAt = calculateNextRun(schedule.frequency, schedule.cron_expression);
      await supabase.from("pipeline_schedules").update({
        last_run_at: new Date().toISOString(),
        last_run_status: result.success ? "triggered" : "failed",
        total_runs: (schedule.total_runs || 0) + 1,
        next_run_at: nextRunAt,
      }).eq("id", schedule.id);

      results.push({ schedule_name: schedule.name, ...result, next_run_at: nextRunAt });
    }

    // Auto-chain jd_enrichment if needed
    await checkAndChainEnrichment().catch(console.error);

    // If there are more due schedules, self-trigger another tick after a delay
    const remaining = (dueSchedules || []).length - toProcess.length;
    if (remaining > 0) {
      // Trigger another tick via fetch (fire-and-forget)
      const selfUrl = `https://${req.headers.host}/api/scheduler/tick`;
      fetch(selfUrl, {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET || "", "Content-Type": "application/json" },
      }).catch(() => {});
    }

    return res.json({
      triggered: results.length,
      remaining,
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
