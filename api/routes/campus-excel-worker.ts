/**
 * api/routes/campus-excel-worker.ts
 * ─────────────────────────────────────────────────────────────────────
 * Async tick worker for Campus Excel Upload Track A (full-JD Excels).
 *
 * Architecture mirrors api/routes/extract-uae-job-skills.ts exactly:
 *   - Work queue lives in `campus_excel_tasks` (status='queued' → 'processing'
 *     → 'succeeded'/'failed'). One row per Excel row to analyze.
 *   - Batch coordinator is `campus_upload_batches` (status='reviewing' while
 *     the worker runs, set by the enqueue endpoint).
 *   - Public tick (`/public/campus-excel-worker/tick`) takes CRON_SECRET in
 *     the `x-cron-secret` header and is wired before the main auth gate.
 *   - Admin tick / status / stop are auth-gated and live under
 *     `/admin/campus-excel-worker/*`.
 *   - Ticks self-recurse via fire-and-forget HTTP POST so we don't need cron.
 *
 * Endpoints:
 *   POST /admin/campus-excel-worker/tick     — manual admin re-trigger
 *   GET  /admin/campus-excel-worker/status   — { batch_id } → counters + ETA
 *   POST /admin/campus-excel-worker/stop     — cancel the batch (no more ticks)
 *   POST /public/campus-excel-worker/tick    — CRON_SECRET, self-recursion target
 *
 * Author: thread camjdbcab
 * Date:   2026-05-15
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, CRON_SECRET } from "../lib/supabase";
import { runAnalyzeJd } from "../lib/analyze-jd";
import type { AuthResult } from "../lib/auth";
import { requireAdmin } from "../lib/auth";

const TICK_SIZE = 5;             // tasks claimed per tick
const CONCURRENCY = 2;           // in-flight runAnalyzeJd calls
const TICK_BUDGET_MS = 180_000;  // 3 min — well under Vercel 5min cap
const MAX_ATTEMPTS = 3;

// ── Counters ─────────────────────────────────────────────────────────

async function countRemaining(batchId: string): Promise<number> {
  const { count } = await supabase
    .from("campus_excel_tasks")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("status", ["queued", "processing"]);
  return count || 0;
}

async function countByStatus(batchId: string): Promise<{ ok: number; fail: number; total: number }> {
  const { data } = await supabase
    .from("campus_excel_tasks")
    .select("status")
    .eq("batch_id", batchId);
  const rows = data || [];
  return {
    ok: rows.filter((r: any) => r.status === "succeeded").length,
    fail: rows.filter((r: any) => r.status === "failed").length,
    total: rows.length,
  };
}

// ── Claim + process a slice ──────────────────────────────────────────

interface Task {
  id: string;
  batch_id: string;
  excel_row_index: number;
  raw_title: string;
  raw_employer: string | null;
  raw_description: string;
  attempts: number;
}

/**
 * Claim up to TICK_SIZE queued tasks for this batch and flip them to
 * 'processing' atomically. Returns the claimed rows.
 *
 * Implementation: select candidate ids, then UPDATE ... WHERE id = ANY($ids)
 * AND status = 'queued'. Two parallel ticks claiming overlapping rows is
 * tolerated because the WHERE clause prevents double-claim.
 */
async function claimSlice(batchId: string, limit: number): Promise<Task[]> {
  // 1. Read candidate ids
  const { data: candidates, error: selErr } = await supabase
    .from("campus_excel_tasks")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "queued")
    .order("excel_row_index", { ascending: true })
    .limit(limit);
  if (selErr) throw selErr;
  const ids = (candidates || []).map((c: any) => c.id);
  if (ids.length === 0) return [];

  // 2. Claim — set status='processing' only where it's still 'queued'
  const { data: claimed, error: updErr } = await supabase
    .from("campus_excel_tasks")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "queued")
    .select("id, batch_id, excel_row_index, raw_title, raw_employer, raw_description, attempts");
  if (updErr) throw updErr;
  return (claimed || []) as Task[];
}

async function markSucceeded(task: Task, analyzeRunId: string | null): Promise<void> {
  await supabase
    .from("campus_excel_tasks")
    .update({
      status: "succeeded",
      analyze_run_id: analyzeRunId,
      attempts: (task.attempts || 0) + 1,
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", task.id);
}

async function markFailed(task: Task, errMsg: string, retryable: boolean): Promise<void> {
  const newAttempts = (task.attempts || 0) + 1;
  if (retryable && newAttempts < MAX_ATTEMPTS) {
    // Requeue for another attempt
    await supabase
      .from("campus_excel_tasks")
      .update({
        status: "queued",
        attempts: newAttempts,
        error_message: errMsg.slice(0, 1000),
      })
      .eq("id", task.id);
  } else {
    await supabase
      .from("campus_excel_tasks")
      .update({
        status: "failed",
        attempts: newAttempts,
        error_message: errMsg.slice(0, 1000),
        finished_at: new Date().toISOString(),
      })
      .eq("id", task.id);
  }
}

async function processOne(task: Task): Promise<void> {
  try {
    const result = await runAnalyzeJd({
      text: task.raw_description,
      filename: `excel-row-${task.excel_row_index}`,
      batch_id: task.batch_id,
      // Reuse the existing 'campus_upload' source. Track A rows go through the same
      // analyze → review → commit flow as paste-text JDs; the distinguishing info
      // lives in campus_upload_batches.batch_type + campus_excel_tasks. Avoids
      // mutating the shared AnalyzeSource union.
      source: "campus_upload",
    });
    await markSucceeded(task, result.run_id || null);
  } catch (e: any) {
    const msg = e?.message || String(e);
    // Treat all errors as retryable up to MAX_ATTEMPTS (matches UAE worker behavior).
    await markFailed(task, msg, true);
  }
}

async function processConcurrent(tasks: Task[], deadlineMs: number): Promise<{ ok: number; fail: number }> {
  let idx = 0;
  let ok = 0;
  let fail = 0;

  async function worker() {
    while (idx < tasks.length) {
      if (Date.now() > deadlineMs) return;
      const t = tasks[idx++];
      const before = t.attempts || 0;
      await processOne(t);
      // Re-read final status to count outcome
      const { data: after } = await supabase
        .from("campus_excel_tasks")
        .select("status, attempts")
        .eq("id", t.id)
        .maybeSingle();
      if (after?.status === "succeeded") ok++;
      else if (after?.status === "failed") fail++;
      // else: requeued — neither ok nor final-fail; will be picked up next tick
      void before;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker());
  await Promise.all(workers);
  return { ok, fail };
}

// ── Base URL + self-recursion ────────────────────────────────────────

function getBaseUrl(req: VercelRequest): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return `${proto}://${host}`;
}

function fireNextTick(baseUrl: string, batchId: string): void {
  fetch(`${baseUrl}/api/public/campus-excel-worker/tick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": CRON_SECRET || "",
    },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch((e) => {
    console.error("[campus-excel-worker] fireNextTick failed:", e?.message || e);
  });
}

// ── Shared tick implementation ───────────────────────────────────────

async function runTick(req: VercelRequest, res: VercelResponse, batchId: string) {
  // Verify the batch is in a runnable state
  const { data: batch, error: bErr } = await supabase
    .from("campus_upload_batches")
    .select("id, status, batch_type")
    .eq("id", batchId)
    .maybeSingle();
  if (bErr || !batch) return res.status(404).json({ error: "Batch not found" });

  if (batch.status === "cancelled" || batch.status === "committed") {
    return res.json({ done: true, status: batch.status });
  }
  if (batch.batch_type !== "excel_jd_analyze") {
    return res.status(400).json({ error: `Batch type '${batch.batch_type}' is not async-worker eligible` });
  }

  const tickStartedAt = Date.now();
  const deadlineMs = tickStartedAt + TICK_BUDGET_MS;

  const slice = await claimSlice(batchId, TICK_SIZE);

  if (slice.length === 0) {
    const remaining = await countRemaining(batchId);
    if (remaining === 0) {
      // All done — leave batch in 'reviewing' so the user can commit via the existing review flow.
      // (Status only flips to 'committed' when the user clicks Commit on Step 4.)
      const counts = await countByStatus(batchId);
      return res.json({ done: true, ...counts });
    }
    // No queued rows but some still processing (claimed by an in-flight tick). Retry shortly.
    setTimeout(() => fireNextTick(getBaseUrl(req), batchId), 5000);
    return res.json({ done: false, idle: true, message: "Waiting on in-flight tasks", remaining });
  }

  const { ok, fail } = await processConcurrent(slice, deadlineMs);

  const remaining = await countRemaining(batchId);
  const isDone = remaining === 0;

  if (!isDone) {
    setTimeout(() => fireNextTick(getBaseUrl(req), batchId), 1000);
  }

  return res.json({
    ok,
    fail,
    remaining,
    done: isDone,
    tick_ms: Date.now() - tickStartedAt,
  });
}

// ── Admin routes ─────────────────────────────────────────────────────

export async function handleCampusExcelWorkerRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  // POST /admin/campus-excel-worker/tick
  if (path === "/admin/campus-excel-worker/tick" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;
    const body = (req.body || {}) as { batch_id?: string };
    const batchId = body.batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });
    return runTick(req, res, batchId);
  }

  // GET /admin/campus-excel-worker/status?batch_id=...
  if (path === "/admin/campus-excel-worker/status" && req.method === "GET") {
    if (!requireAdmin(auth, res)) return;
    const batchId = (req.query?.batch_id as string) || undefined;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });

    const { data: batch } = await supabase
      .from("campus_upload_batches")
      .select("id, status, batch_type, created_at, total_files")
      .eq("id", batchId)
      .maybeSingle();
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const counts = await countByStatus(batchId);
    const remaining = await countRemaining(batchId);
    const done = counts.total > 0 ? counts.ok + counts.fail : 0;
    const percent = counts.total > 0 ? Math.round((done / counts.total) * 100) : 0;

    let etaMin: number | null = null;
    if (remaining > 0 && batch.created_at) {
      const elapsedMs = Date.now() - new Date(batch.created_at).getTime();
      const ratePerMs = done / Math.max(elapsedMs, 1);
      if (ratePerMs > 0) etaMin = Math.round((remaining / ratePerMs) / 60_000);
    }

    return res.json({
      batch_id: batchId,
      status: batch.status,
      batch_type: batch.batch_type,
      total: counts.total,
      ok: counts.ok,
      fail: counts.fail,
      remaining,
      percent,
      eta_min: etaMin,
    });
  }

  // POST /admin/campus-excel-worker/stop
  if (path === "/admin/campus-excel-worker/stop" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;
    const body = (req.body || {}) as { batch_id?: string };
    const batchId = body.batch_id;
    if (!batchId) return res.status(400).json({ error: "batch_id required" });

    await supabase
      .from("campus_upload_batches")
      .update({ status: "cancelled" })
      .eq("id", batchId);
    return res.json({ ok: true, batch_id: batchId, status: "cancelled" });
  }

  return undefined;
}

// ── Public tick (CRON_SECRET-protected, used for self-recursion) ─────

export async function handlePublicCampusExcelWorkerTick(
  path: string,
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse | undefined> {
  if (path === "/public/campus-excel-worker/tick" && req.method === "POST") {
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

// Export for use from campus-upload route (e.g. to kick the first tick after /enqueue)
export { fireNextTick as kickFirstTick, getBaseUrl };
