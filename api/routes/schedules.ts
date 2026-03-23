import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CronExpressionParser } from "cron-parser";
import { AuthResult, requirePermission } from "../lib/auth";
import { supabase } from "../lib/supabase";

export function calculateNextRun(frequency: string, cronExpression?: string | null, from?: Date): string {
  const now = from || new Date();
  if (frequency === "custom" && cronExpression) {
    try {
      const interval = CronExpressionParser.parse(cronExpression, { currentDate: now });
      return interval.next().toISOString() || new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    } catch {
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

export async function handleScheduleRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
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
          name, pipeline_type, config: config || {}, frequency,
          cron_expression: frequency === "custom" ? cron_expression : null,
          max_runs: max_runs || null, credit_limit: credit_limit || null,
          next_run_at: nextRunAt, created_by: auth.email,
        })
        .select().single();
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
    const { data, error } = await supabase.from("pipeline_schedules").update(updates).eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (path.match(/^\/schedules\/[^/]+\/pause$/) && req.method === "POST") {
    const id = path.split("/")[2];
    const { data, error } = await supabase
        .from("pipeline_schedules")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (path.match(/^\/schedules\/[^/]+\/resume$/) && req.method === "POST") {
    const id = path.split("/")[2];
    const { data: schedule } = await supabase.from("pipeline_schedules").select("*").eq("id", id).single();
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    const nextRunAt = calculateNextRun(schedule.frequency, schedule.cron_expression);
    const { data, error } = await supabase
        .from("pipeline_schedules")
        .update({ is_active: true, next_run_at: nextRunAt, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (path.match(/^\/schedules\/[^/]+$/) && req.method === "DELETE") {
    if (!requirePermission("schedules", "full")(auth, res)) return;
    const id = path.split("/").pop();
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

  return undefined;
}
