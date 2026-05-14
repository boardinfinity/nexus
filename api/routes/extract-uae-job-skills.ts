/**
 * Real-time UAE/GCC job-skill extraction — Vercel-friendly re-entrant worker.
 *
 * Why this exists:
 *   The local script (scripts/extract-uae-job-skills.ts) needs a 3-4h
 *   continuous process and a terminal. This route runs the same logic
 *   on Vercel in 25-job ticks (~3 min each) and self-schedules the next
 *   tick via fire-and-forget HTTP, so no cron is needed.
 *
 * Endpoints (all under /admin/extract-uae-job-skills/):
 *
 *   POST /start
 *     Admin-only. Creates a batch_jobs row and triggers the first tick.
 *     Returns: { batch_id, total_jobs, estimated_minutes }
 *
 *   POST /tick
 *     Cron-secret protected (so Vercel can call itself).
 *     Processes the next 25 jobs, updates batch_jobs counters, then if
 *     more remain, fires another /tick request and returns immediately.
 *     Body: { batch_id: uuid }
 *
 *   GET /status?batch_id=...
 *     Admin-only. Returns { processed, failed, total, percent, eta_min,
 *     status, started_at, last_tick_at }.
 *
 *   POST /stop
 *     Admin-only. Sets status='cancelled' on the batch row. The next
 *     tick will see this and exit without scheduling another tick.
 *     Body: { batch_id: uuid }
 *
 * Idempotency:
 *   runAnalyzeJd() flips jobs.analysis_version to 'v2' on persist.
 *   The job-selection query filters out v2 rows, so ticks are safe to
 *   double-run, crash, retry.
 *
 * Author: thread cd-uowd14
 * Date:   2026-05-14
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, CRON_SECRET } from "../lib/supabase";
import { runAnalyzeJd } from "../lib/analyze-jd";
import type { AuthResult } from "../lib/auth";
import { requireAdmin } from "../lib/auth";

const BATCH_TYPE = "uae_realtime_extraction";
const TICK_SIZE = 10;           // jobs per tick — small so counter updates reliably
const CONCURRENCY = 5;          // in-flight runAnalyzeJd calls per tick
const TICK_BUDGET_MS = 180_000; // 3 min budget — well under Vercel 5min cap
const MIN_JD_CHARS = 100;
const CHECKPOINT_EVERY = 5;     // persist progress every N completed jobs

const UAE_GCC_COUNTRIES = [
  "United Arab Emirates",
  "United Arab Emirates (UAE)",
  "UAE",
  "AE",
  "Dubai",
  "Saudi Arabia",
  "SA",
  "Riyadh",
  "Qatar",
  "QA",
  "Oman",
  "OM",
  "Bahrain",
  "BH",
  "Kuwait",
  "KW",
];

// ── Helpers ──────────────────────────────────────────────────────────
async function countCandidates(): Promise<number> {
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("location_country", UAE_GCC_COUNTRIES)
    .or("analysis_version.is.null,analysis_version.neq.v2");
  return count || 0;
}

async function fetchNextSlice(limit: number) {
  // Pull the next slice of UAE/GCC jobs that aren't at v2 yet.
  // Order by id so two parallel ticks (shouldn't happen, but safe) don't
  // collide on the exact same rows.
  // NOTE: the JD column on jobs is `description`, not `jd_text`.
  const { data, error } = await supabase
    .from("jobs")
    .select("id, description, title")
    .in("location_country", UAE_GCC_COUNTRIES)
    .or("analysis_version.is.null,analysis_version.neq.v2")
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).filter(
    (j: any) => typeof j.description === "string" && j.description.length >= MIN_JD_CHARS
  );
}

async function processOne(job: { id: string; description: string; title: string }) {
  // Three retries with exponential backoff.
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await runAnalyzeJd({
        text: job.description,
        job_id: job.id,
        source: "async_batch",
      });
      return { ok: true };
    } catch (e: any) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  return { ok: false, error: lastErr?.message || String(lastErr) };
}

async function processConcurrent(
  jobs: Array<{ id: string; description: string; title: string }>,
  deadlineMs: number,
  onCheckpoint?: (ok: number, fail: number) => Promise<void>
): Promise<{ ok: number; fail: number; failedIds: string[] }> {
  let idx = 0;
  let ok = 0;
  let fail = 0;
  let completedSinceCheckpoint = 0;
  const failedIds: string[] = [];

  async function worker() {
    while (idx < jobs.length) {
      if (Date.now() > deadlineMs) return; // budget guard
      const j = jobs[idx++];
      const r = await processOne(j);
      if (r.ok) ok++;
      else {
        fail++;
        failedIds.push(j.id);
      }
      completedSinceCheckpoint++;
      if (onCheckpoint && completedSinceCheckpoint >= CHECKPOINT_EVERY) {
        completedSinceCheckpoint = 0;
        // fire-and-forget; don't block the worker
        onCheckpoint(ok, fail).catch((e) =>
          console.error("[uae-extract] checkpoint failed:", e?.message || e)
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker());
  await Promise.all(workers);
  return { ok, fail, failedIds };
}

function getBaseUrl(req: VercelRequest): string {
  // Prefer VERCEL_URL but fall back to the request host
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return `${proto}://${host}`;
}

function fireNextTick(baseUrl: string, batchId: string): void {
  // Fire-and-forget POST to the PUBLIC tick endpoint (CRON_SECRET-protected).
  // We use the public path because the auth gate would otherwise reject
  // an anonymous self-call. If a tick dies the user can manually re-trigger
  // via /start with the existing batch_id (it picks up where it left off).
  fetch(`${baseUrl}/api/public/extract-uae-job-skills/tick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": CRON_SECRET || "",
    },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch((e) => {
    console.error("[uae-extract] fireNextTick failed:", e?.message || e);
  });
}

// ── Route handler ────────────────────────────────────────────────────
export async function handleExtractUaeJobSkillsRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {

  // POST /admin/extract-uae-job-skills/start
  if (path === "/admin/extract-uae-job-skills/start" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;

    // Re-use an existing 'running' or 'pending' batch if there is one.
    const { data: existing } = await supabase
      .from("batch_jobs")
      .select("id, status, job_count, processed_count, failed_count, created_at")
      .eq("batch_type", BATCH_TYPE)
      .in("status", ["pending", "submitted", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const total = await countCandidates();

    if (existing) {
      // Resume / re-trigger
      fireNextTick(getBaseUrl(req), existing.id);
      return res.json({
        batch_id: existing.id,
        status: existing.status,
        resumed: true,
        total_jobs: total,
        already_processed: existing.processed_count || 0,
        message: "Existing batch resumed. /tick fired.",
      });
    }

    if (total === 0) {
      return res.json({
        batch_id: null,
        total_jobs: 0,
        message: "Nothing to do — every UAE/GCC job is already at analysis_version='v2'.",
      });
    }

    const { data: created, error: createErr } = await supabase
      .from("batch_jobs")
      .insert({
        batch_type: BATCH_TYPE,
        status: "processing",
        job_count: total,
        processed_count: 0,
        failed_count: 0,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createErr || !created) {
      return res.status(500).json({ error: createErr?.message || "Failed to create batch row" });
    }

    fireNextTick(getBaseUrl(req), created.id);

    // Estimate: ~5s/job at concurrency=5 → 1s effective per job → total seconds
    const estimatedSeconds = Math.ceil(total * 1.0);
    return res.json({
      batch_id: created.id,
      total_jobs: total,
      tick_size: TICK_SIZE,
      concurrency: CONCURRENCY,
      estimated_minutes: Math.ceil(estimatedSeconds / 60),
      status_url: `/api/admin/extract-uae-job-skills/status?batch_id=${created.id}`,
      message: "Started. First tick fired. Poll /status for progress.",
    });
  }

  // POST /admin/extract-uae-job-skills/tick — authenticated admin manual trigger
  // (Public/cron-driven ticks come in via /public/extract-uae-job-skills/tick
  //  which is handled before the auth gate; both share runTick below.)
  if (path === "/admin/extract-uae-job-skills/tick" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;
    const body = (req.body || {}) as { batch_id?: string };
    const batchId = body.batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });
    return runTick(req, res, batchId);

  }

  // GET /admin/extract-uae-job-skills/status
  if (path === "/admin/extract-uae-job-skills/status" && req.method === "GET") {
    if (!requireAdmin(auth, res)) return;

    const batchId = (req.query?.batch_id as string) || undefined;

    const query = supabase
      .from("batch_jobs")
      .select("id, status, job_count, processed_count, failed_count, submitted_at, completed_at, created_at")
      .eq("batch_type", BATCH_TYPE)
      .order("created_at", { ascending: false });

    const { data } = batchId
      ? await query.eq("id", batchId).maybeSingle()
      : await query.limit(1).maybeSingle();

    if (!data) return res.json({ batch_id: null, message: "No batch found" });

    const total = data.job_count || 0;
    const done = data.processed_count || 0;
    const failed = data.failed_count || 0;
    const percent = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;

    // ETA — based on rate since submitted_at
    let etaMin: number | null = null;
    if (data.status === "processing" && data.submitted_at) {
      const elapsedMs = Date.now() - new Date(data.submitted_at).getTime();
      const ratePerMs = (done + failed) / Math.max(elapsedMs, 1);
      const remaining = total - done - failed;
      if (ratePerMs > 0 && remaining > 0) {
        etaMin = Math.round((remaining / ratePerMs) / 60_000);
      }
    }

    const remaining = await countCandidates();

    return res.json({
      batch_id: data.id,
      status: data.status,
      total_jobs: total,
      processed: done,
      failed,
      remaining_in_db: remaining, // live count from jobs table
      percent,
      eta_min: etaMin,
      submitted_at: data.submitted_at,
      completed_at: data.completed_at,
    });
  }

  // POST /admin/extract-uae-job-skills/stop
  if (path === "/admin/extract-uae-job-skills/stop" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;

    const body = (req.body || {}) as { batch_id?: string };
    const batchId = body.batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });

    const { error: updErr } = await supabase
      .from("batch_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("batch_type", BATCH_TYPE);

    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true, batch_id: batchId, status: "cancelled" });
  }

  return undefined;
}

// ── Shared tick worker ───────────────────────────────────────────────
async function runTick(req: VercelRequest, res: VercelResponse, batchId: string) {
  const { data: batch, error: batchErr } = await supabase
    .from("batch_jobs")
    .select("id, status, job_count, processed_count, failed_count")
    .eq("id", batchId)
    .eq("batch_type", BATCH_TYPE)
    .maybeSingle();

  if (batchErr || !batch) return res.status(404).json({ error: "Batch not found" });

  if (batch.status === "cancelled" || batch.status === "completed" || batch.status === "failed") {
    return res.json({ done: true, status: batch.status });
  }

  const startedTickAt = Date.now();
  const deadlineMs = startedTickAt + TICK_BUDGET_MS;

  const slice = await fetchNextSlice(TICK_SIZE);

  if (slice.length === 0) {
    const remaining = await countCandidates();
    await supabase
      .from("batch_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", batchId);
    return res.json({ done: true, remaining, processed: batch.processed_count, failed: batch.failed_count });
  }

  const baseProcessed = batch.processed_count || 0;
  const baseFailed = batch.failed_count || 0;

  // Mid-tick checkpoints so progress is visible even if the tick is killed.
  const onCheckpoint = async (okSoFar: number, failSoFar: number) => {
    await supabase
      .from("batch_jobs")
      .update({
        processed_count: baseProcessed + okSoFar,
        failed_count: baseFailed + failSoFar,
      })
      .eq("id", batchId);
  };

  const { ok, fail, failedIds } = await processConcurrent(slice, deadlineMs, onCheckpoint);

  const newProcessed = baseProcessed + ok;
  const newFailed = baseFailed + fail;
  const remaining = await countCandidates();
  const isDone = remaining === 0;

  await supabase
    .from("batch_jobs")
    .update({
      processed_count: newProcessed,
      failed_count: newFailed,
      status: isDone ? "completed" : "processing",
      completed_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", batchId);

  if (failedIds.length > 0) {
    console.error("[uae-extract] failed job ids this tick:", failedIds);
  }

  if (!isDone) {
    setTimeout(() => fireNextTick(getBaseUrl(req), batchId), 1000);
  }

  return res.json({
    ok,
    fail,
    processed_total: newProcessed,
    failed_total: newFailed,
    remaining,
    done: isDone,
    tick_ms: Date.now() - startedTickAt,
  });
}

// Public tick variant — CRON_SECRET-protected, handled before auth gate.
export async function handlePublicExtractUaeJobSkillsTick(
  path: string,
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse | undefined> {
  if (path === "/public/extract-uae-job-skills/tick" && req.method === "POST") {
    const providedSecret =
      (req.headers["x-cron-secret"] as string) ||
      (req.headers["authorization"] as string)?.replace("Bearer ", "");

    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = (req.body || {}) as { batch_id?: string };
    const batchId = body.batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });

    return runTick(req, res, batchId);
  }
  return undefined;
}
