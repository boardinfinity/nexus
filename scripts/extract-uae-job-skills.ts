/**
 * scripts/extract-uae-job-skills.ts
 * =====================================================================
 * One-shot real-time extraction of skills + classification for UAE/GCC
 * jobs that are not yet at analysis_version='v2'.
 *
 * Purpose:  populate job_skills + jobs.bucket_id + jobs.analysis_version
 *           ahead of the UOWD College Dashboard demo (May 15 2026 AM IST).
 *
 * Why a script and not a pipeline run?
 *   - Vercel serverless has a 5-minute hard timeout.
 *   - We need 3-4 hours of continuous processing.
 *   - The script is idempotent and resumable — safe to crash + restart.
 *
 * Idempotency:  reads only jobs where analysis_version IS NULL or != 'v2'.
 *               runAnalyzeJd() flips it to 'v2' when persisted, so the
 *               next run automatically skips already-done jobs.
 *
 * Run locally (from repo root, with .env populated):
 *
 *   tsx scripts/extract-uae-job-skills.ts
 *
 * Or background it overnight:
 *
 *   nohup tsx scripts/extract-uae-job-skills.ts \
 *     > /tmp/uae-extract.log 2>&1 &
 *   echo $! > /tmp/uae-extract.pid
 *   tail -f /tmp/uae-extract.log
 *
 * Stop early (graceful — finishes the in-flight slice then exits):
 *
 *   touch /tmp/uae-extract.stop
 *
 * Required env vars (loaded from .env / .env.local automatically by tsx):
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_KEY
 *   - OPENAI_API_KEY
 *
 * Optional env vars:
 *   - UAE_EXTRACT_CONCURRENCY  (default: 6   — how many JDs in-flight at once)
 *   - UAE_EXTRACT_MAX_JOBS     (default: 5000 — safety cap on total processed)
 *   - UAE_EXTRACT_DRY_RUN      (default: 0   — set to 1 to count without calling OpenAI)
 *
 * Author:   thread cd-uowd14 (College Dashboard Phase 0)
 * Date:     2026-05-14
 * =====================================================================
 */

import { supabase } from "../api/lib/supabase";
import { runAnalyzeJd } from "../api/lib/analyze-jd";
import * as fs from "fs";

// ── Config ───────────────────────────────────────────────────────────
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

const CONCURRENCY = Number(process.env.UAE_EXTRACT_CONCURRENCY || 6);
const MAX_JOBS = Number(process.env.UAE_EXTRACT_MAX_JOBS || 5000);
const DRY_RUN = process.env.UAE_EXTRACT_DRY_RUN === "1";
const STOP_FILE = "/tmp/uae-extract.stop";
const PROGRESS_LOG_EVERY = 50;
const SLICE_SIZE = 50; // fetch this many job rows at a time
const MIN_DESC_LENGTH = 100;

// ── Helpers ──────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString();
}

function shouldStop(): boolean {
  return fs.existsSync(STOP_FILE);
}

async function fetchNextSlice(): Promise<
  Array<{ id: string; title: string; description: string; company_name: string | null }>
> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title, description, company_name")
    .in("location_country", UAE_GCC_COUNTRIES)
    .or("analysis_version.is.null,analysis_version.neq.v2")
    .not("description", "is", null)
    .limit(SLICE_SIZE);

  if (error) throw error;
  return (data || []).filter(
    (j) => j.description && j.description.length >= MIN_DESC_LENGTH
  );
}

// Bounded concurrent pool
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<Array<{ ok: boolean; error?: string }>> {
  const results: Array<{ ok: boolean; error?: string }> = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        await fn(items[i]);
        results[i] = { ok: true };
      } catch (e: any) {
        results[i] = { ok: false, error: e?.message || String(e) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function processOne(job: {
  id: string;
  title: string;
  description: string;
  company_name: string | null;
}): Promise<void> {
  // 2 retries on transient OpenAI / network failures
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await runAnalyzeJd({
        text: job.description,
        job_id: job.id,
        source: "async_batch", // closest match — persistence path writes job_skills + jobs.update
        filename: job.company_name ? `${job.company_name}.txt` : undefined,
      });
      if (result.status === "succeeded" || result.status === "partial") return;
      lastErr = new Error(result.error || `runAnalyzeJd returned ${result.status}`);
    } catch (e: any) {
      lastErr = e;
    }
    // Short backoff
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastErr;
}

// ── Main loop ────────────────────────────────────────────────────────
async function main() {
  console.log(`[${ts()}] === extract-uae-job-skills START ===`);
  console.log(
    `[${ts()}] concurrency=${CONCURRENCY} max_jobs=${MAX_JOBS} dry_run=${DRY_RUN}`
  );
  console.log(`[${ts()}] stop_file=${STOP_FILE} (touch this to stop gracefully)`);

  // Pre-flight: count target jobs
  const { count: totalRemaining, error: countErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("location_country", UAE_GCC_COUNTRIES)
    .or("analysis_version.is.null,analysis_version.neq.v2")
    .not("description", "is", null);

  if (countErr) {
    console.error(`[${ts()}] FATAL: pre-flight count failed: ${countErr.message}`);
    process.exit(2);
  }

  console.log(`[${ts()}] pre-flight: ${totalRemaining} UAE/GCC jobs need analysis`);

  if (DRY_RUN) {
    console.log(`[${ts()}] DRY_RUN=1 — exiting without OpenAI calls`);
    process.exit(0);
  }

  if (!totalRemaining || totalRemaining === 0) {
    console.log(`[${ts()}] nothing to do — exiting clean`);
    process.exit(0);
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const startMs = Date.now();

  while (processed < MAX_JOBS) {
    if (shouldStop()) {
      console.log(`[${ts()}] stop file detected — exiting gracefully`);
      break;
    }

    const slice = await fetchNextSlice();
    if (slice.length === 0) {
      console.log(`[${ts()}] no more jobs to analyze — all done`);
      break;
    }

    const sliceStart = Date.now();
    const results = await runWithConcurrency(slice, CONCURRENCY, processOne);
    const sliceMs = Date.now() - sliceStart;

    const sliceOk = results.filter((r) => r.ok).length;
    const sliceFailed = results.length - sliceOk;
    succeeded += sliceOk;
    failed += sliceFailed;
    processed += slice.length;

    // Log per-slice
    const ratePerJob = sliceMs / slice.length;
    const remaining = Math.max(0, (totalRemaining || 0) - processed);
    const etaMin = Math.round((remaining * ratePerJob) / 60000);
    console.log(
      `[${ts()}] slice: n=${slice.length} ok=${sliceOk} fail=${sliceFailed} ` +
        `slice_ms=${sliceMs} per_job_ms=${Math.round(ratePerJob)} ` +
        `total_processed=${processed} total_ok=${succeeded} total_fail=${failed} ` +
        `eta_min=${etaMin}`
    );

    // Surface a sample failure (only first per slice) to make debugging possible
    const firstFail = results.find((r) => !r.ok);
    if (firstFail) {
      console.warn(
        `[${ts()}] sample failure (slice): ${(firstFail.error || "").slice(0, 200)}`
      );
    }

    // Light pacing between slices to be gentle on rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1);
  console.log(`[${ts()}] === DONE ===`);
  console.log(
    `[${ts()}] processed=${processed} succeeded=${succeeded} failed=${failed} elapsed_min=${elapsedMin}`
  );
}

main().catch((e) => {
  console.error(`[${ts()}] FATAL: ${e?.stack || e?.message || String(e)}`);
  process.exit(1);
});
