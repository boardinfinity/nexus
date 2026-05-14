/**
 * api/routes/campus-upload.ts
 * ───────────────────────────────────────────────────────────────────
 * Bulk campus JD upload pipeline — Track D (jdenh001)
 *
 * Routes:
 *   POST   /api/campus-upload/batch              — create draft batch
 *   POST   /api/campus-upload/batch/:id/files    — upload files, extract + analyze
 *   GET    /api/campus-upload/batch/:id/review   — per-JD preview + run results
 *   POST   /api/campus-upload/batch/:id/commit   — commit accepted JDs → jobs table
 *
 * File support: .pdf (via pdf-parse), .docx (via mammoth), .txt
 * Max 50 files per request, ≤10 MB each.
 * Each file runs through runAnalyzeJd() with source='campus_upload'.
 *
 * TODO (v2): OCR for image-only PDFs (pdf-parse returns empty text for scanned PDFs).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import mammoth from "mammoth";
import { supabase, CRON_SECRET } from "../lib/supabase";
import { runAnalyzeJd } from "../lib/analyze-jd";
import { AuthResult, requirePermission, hasPermission } from "../lib/auth";
import {
  parseExcelBuffer,
  extractRows,
  splitVacancyTitle,
  MAX_EXCEL_ROWS,
  MIN_DESCRIPTION_CHARS,
  type ColumnMapping,
} from "../lib/excel-parse";

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_EXCEL_BYTES = 25 * 1024 * 1024; // 25 MB — xlsx files compress well
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const ALLOWED_EXCEL_EXTENSIONS = [".xlsx", ".xls"];

// ──────────────────────────────────────────────────────────────────────
// Multipart helpers (adapted from surveys.ts same-repo pattern)
// ──────────────────────────────────────────────────────────────────────

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body as Buffer;
  if (typeof (req as any).body === "string") return Buffer.from((req as any).body);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface FilePart {
  filename: string;
  content: Buffer;
}

/** Extract all named file parts from a multipart body. */
function extractAllFileParts(raw: Buffer, boundary: string): FilePart[] {
  const sep = Buffer.from("--" + boundary);
  const parts: FilePart[] = [];
  let pos = raw.indexOf(sep);
  while (pos !== -1) {
    const next = raw.indexOf(sep, pos + sep.length);
    if (next === -1) break;
    const segment = raw.subarray(pos + sep.length, next);
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = segment.subarray(0, headerEnd).toString("utf-8");
      const fnMatch = headers.match(/filename="([^"]*)"/);
      if (fnMatch) {
        let body = segment.subarray(headerEnd + 4);
        // Trim trailing \r\n
        if (
          body.length >= 2 &&
          body[body.length - 2] === 0x0d &&
          body[body.length - 1] === 0x0a
        ) {
          body = body.subarray(0, body.length - 2);
        }
        parts.push({ filename: fnMatch[1], content: body });
      }
    }
    pos = next;
  }
  return parts;
}

/** Extract form field (non-file) value from multipart body. */
function extractFormField(raw: Buffer, boundary: string, fieldName: string): string | null {
  const sep = Buffer.from("--" + boundary);
  let pos = raw.indexOf(sep);
  while (pos !== -1) {
    const next = raw.indexOf(sep, pos + sep.length);
    if (next === -1) break;
    const segment = raw.subarray(pos + sep.length, next);
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = segment.subarray(0, headerEnd).toString("utf-8");
      // Match form field (no filename attribute)
      const nameMatch = headers.match(/name="([^"]*)"/);
      const hasFile = headers.includes("filename=");
      if (nameMatch && nameMatch[1] === fieldName && !hasFile) {
        let body = segment.subarray(headerEnd + 4);
        if (
          body.length >= 2 &&
          body[body.length - 2] === 0x0d &&
          body[body.length - 1] === 0x0a
        ) {
          body = body.subarray(0, body.length - 2);
        }
        return body.toString("utf-8").trim();
      }
    }
    pos = next;
  }
  return null;
}

/** Extract text from a file buffer based on filename extension. */
async function extractTextFromBuffer(buf: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result.value || "").trim();
  }
  if (lower.endsWith(".pdf")) {
    // pdf-parse is CommonJS — require lazily to avoid bundling issues
    // TODO (v2): add Tesseract OCR for scanned/image-only PDFs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buf);
    return (result.text || "").trim();
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buf.toString("utf-8").trim();
  }
  throw new Error(`Unsupported file type: ${filename}. Use .pdf, .docx, or .txt`);
}

/** Short preview of extracted text (first 400 chars). */
function makePreview(text: string): string {
  return text.slice(0, 400).replace(/\s+/g, " ").trim();
}

// ──────────────────────────────────────────────────────────────────────
// Permission helpers
// ──────────────────────────────────────────────────────────────────────

/** Verify the user can access a batch (admin or college_rep scoped to the batch's college). */
async function assertBatchInScope(
  batchId: string,
  auth: AuthResult,
  res: VercelResponse
): Promise<{ id: string; college_id: string; status: string } | null> {
  const { data: batch, error } = await supabase
    .from("campus_upload_batches")
    .select("id, college_id, status")
    .eq("id", batchId)
    .maybeSingle();

  if (error || !batch) {
    res.status(404).json({ error: "Batch not found" });
    return null;
  }

  const u = auth.nexusUser;
  if (u.role === "college_rep") {
    const allowed = u.restricted_college_ids || [];
    if (!allowed.includes(batch.college_id)) {
      res.status(403).json({ error: "Access denied to this batch" });
      return null;
    }
  }

  return batch as { id: string; college_id: string; status: string };
}

// ──────────────────────────────────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────────────────────────────────

export async function handleCampusUploadRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  const method = req.method || "GET";

  // ── POST /campus-upload/batch ─────────────────────────────────────
  // Create a draft batch with metadata.
  if (path === "/campus-upload/batch" && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const {
      college_id,
      program,
      job_type,
      drive_year,
      source,
      ctc_tag,
    } = req.body || {};

    if (!college_id) {
      return res.status(400).json({ error: "college_id is required" });
    }

    const validJobTypes = ["summer_internship", "full_time_placement", "ppo", "other"];
    if (job_type && !validJobTypes.includes(job_type)) {
      return res.status(400).json({
        error: `job_type must be one of: ${validJobTypes.join(", ")}`,
      });
    }

    const { data: batch, error } = await supabase
      .from("campus_upload_batches")
      .insert({
        college_id,
        program: program || null,
        job_type: job_type || null,
        drive_year: drive_year ? Number(drive_year) : null,
        source: source || null,
        ctc_tag: ctc_tag || null,
        status: "draft",
        uploaded_by: auth.nexusUser.auth_uid || null,
        total_files: 0,
        jds_committed: 0,
      })
      .select("id, college_id, program, job_type, drive_year, source, ctc_tag, status, created_at")
      .single();

    if (error) {
      console.error("campus-upload: create batch error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ batch });
  }

  // ── POST /campus-upload/batch/:id/files ──────────────────────────
  // Multipart upload: accept .pdf/.docx/.txt files, extract text,
  // run analyze pipeline per file.
  const filesMatch = path.match(/^\/campus-upload\/batch\/([^/]+)\/files$/);
  if (filesMatch && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const batchId = filesMatch[1];
    const batch = await assertBatchInScope(batchId, auth, res);
    if (!batch) return res;

    if (batch.status === "committed" || batch.status === "cancelled") {
      return res.status(400).json({
        error: `Cannot upload files to a batch with status '${batch.status}'`,
      });
    }

    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    const boundaryMatch = ct.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "Missing multipart boundary" });
    }
    const boundary = boundaryMatch[1].replace(/^"|"$/g, "");
    const raw = await readRawBody(req);
    const fileParts = extractAllFileParts(raw, boundary);

    if (fileParts.length === 0) {
      return res.status(400).json({ error: "No files found in request" });
    }
    if (fileParts.length > MAX_FILES) {
      return res.status(400).json({
        error: `Too many files. Max ${MAX_FILES} per request; got ${fileParts.length}`,
      });
    }

    // Validate extensions + sizes
    for (const fp of fileParts) {
      const lower = fp.filename.toLowerCase();
      const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!hasAllowedExt) {
        return res.status(400).json({
          error: `File '${fp.filename}' is not allowed. Supported: .pdf, .docx, .txt`,
        });
      }
      if (fp.content.length > MAX_FILE_BYTES) {
        return res.status(400).json({
          error: `File '${fp.filename}' exceeds 10 MB limit (${(fp.content.length / 1024 / 1024).toFixed(1)} MB)`,
        });
      }
    }

    // Process each file
    const results: Array<{
      filename: string;
      extracted: {
        company_name: string | null;
        role_title: string | null;
        jd_text_preview: string;
      };
      analyze_run_id: string;
      status: "succeeded" | "partial" | "failed";
      skill_count: number;
      was_partial: boolean;
      error?: string;
    }> = [];

    for (const fp of fileParts) {
      let extractedText = "";
      let extractionError: string | undefined;

      try {
        extractedText = await extractTextFromBuffer(fp.content, fp.filename);
      } catch (e: any) {
        extractionError = e?.message || String(e);
      }

      if (extractionError || !extractedText) {
        // Push a failure record and continue
        results.push({
          filename: fp.filename,
          extracted: { company_name: null, role_title: null, jd_text_preview: "" },
          analyze_run_id: "",
          status: "failed",
          skill_count: 0,
          was_partial: true,
          error: extractionError || "Empty file — no text could be extracted",
        });
        continue;
      }

      // Run unified analyze pipeline
      const analyzeResult = await runAnalyzeJd({
        text: extractedText,
        filename: fp.filename,
        batch_id: batchId,
        source: "campus_upload",
        created_by: auth.nexusUser.auth_uid || undefined,
      });

      results.push({
        filename: fp.filename,
        extracted: {
          company_name: analyzeResult.company_name,
          role_title: analyzeResult.standardized_title || analyzeResult.job_family_name,
          jd_text_preview: makePreview(extractedText),
        },
        analyze_run_id: analyzeResult.run_id,
        status: analyzeResult.status,
        skill_count: analyzeResult.skills?.length ?? 0,
        was_partial: analyzeResult.was_partial,
        error: analyzeResult.error,
      });
    }

    // Update batch total_files count and set status → reviewing
    const newTotal = (results.length);
    await supabase
      .from("campus_upload_batches")
      .update({
        total_files: newTotal,
        status: "reviewing",
      })
      .eq("id", batchId);

    return res.status(200).json({ batch_id: batchId, files: results });
  }

  // ── GET /campus-upload/batch/:id/review ──────────────────────────
  // Return all files in batch with extracted preview + run results.
  const reviewMatch = path.match(/^\/campus-upload\/batch\/([^/]+)\/review$/);
  if (reviewMatch && method === "GET") {
    if (!requirePermission("jobs", "read")(auth, res)) return res;

    const batchId = reviewMatch[1];
    const batch = await assertBatchInScope(batchId, auth, res);
    if (!batch) return res;

    // Fetch batch metadata
    const { data: batchFull } = await supabase
      .from("campus_upload_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    // Fetch all analyze_jd_runs for this batch. analyze_jd_runs is a pipeline-audit table — it does
    // NOT store extracted company/title/classification fields. Those live only in the analyze response
    // and the eventual jobs row. The Step-3 UI reads what's available here for status + skill counts;
    // company + role are filled in by the user in the form (UI keeps them in component state).
    const { data: runs, error: runsError } = await supabase
      .from("analyze_jd_runs")
      .select(
        "id, status, was_partial, bucket_match, bucket_confidence, skills_extracted, input_chars, latency_ms, error_message, created_at"
      )
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    if (runsError) {
      console.error("campus-upload: review runs error:", runsError);
      return res.status(500).json({ error: runsError.message });
    }

    // For excel-sourced batches, also include the campus_excel_tasks rows so
    // the frontend can show per-row context (raw_title, excel_row_index) for
    // each analyze_jd_run. Joined client-side on analyze_run_id.
    let excelTasks: any[] | undefined;
    if (batchFull?.batch_type === "excel_jd_analyze") {
      const { data: tasks } = await supabase
        .from("campus_excel_tasks")
        .select("id, excel_row_index, raw_title, raw_employer, status, analyze_run_id, error_message")
        .eq("batch_id", batchId)
        .order("excel_row_index", { ascending: true });
      excelTasks = tasks || [];
    }

    return res.status(200).json({
      batch: batchFull,
      runs: runs || [],
      total_runs: (runs || []).length,
      ...(excelTasks ? { excel_tasks: excelTasks } : {}),
    });
  }

  // ── POST /campus-upload/batch/:id/commit ─────────────────────────
  // Body: { items: Array<{ analyze_run_id, edited_company_name?, edited_role_title?, accept: bool }> }
  // For each accepted item: create a jobs row, re-link run to job.
  const commitMatch = path.match(/^\/campus-upload\/batch\/([^/]+)\/commit$/);
  if (commitMatch && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const batchId = commitMatch[1];
    const batch = await assertBatchInScope(batchId, auth, res);
    if (!batch) return res;

    if (batch.status === "committed") {
      return res.status(400).json({ error: "Batch is already committed" });
    }
    if (batch.status === "cancelled") {
      return res.status(400).json({ error: "Cannot commit a cancelled batch" });
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    const acceptedItems = items.filter((i: any) => i.accept === true);
    const committedJobIds: string[] = [];
    const errors: Array<{ analyze_run_id: string; error: string }> = [];

    for (const item of acceptedItems) {
      const { analyze_run_id, edited_company_name, edited_role_title } = item;

      if (!analyze_run_id) {
        errors.push({ analyze_run_id: "?", error: "analyze_run_id missing" });
        continue;
      }

      // Fetch the analyze run for batch verification.
      // NOTE: analyze_jd_runs does NOT store company_name / standardized_title / job_function* /
      // job_family* / job_industry* / bucket / seniority / geography / company_type / jd_quality /
      // classification_confidence / experience_min/max / min_education columns. The unified analyze
      // pipeline returns those values in-response and they're surfaced to the UI; the DB row only
      // carries pipeline-level audit fields. The UI sends the human-edited company + role in the
      // request body, which is the authoritative source for the commit.
      const { data: run, error: runFetchErr } = await supabase
        .from("analyze_jd_runs")
        .select("id, batch_id, status")
        .eq("id", analyze_run_id)
        .maybeSingle();

      if (runFetchErr || !run) {
        errors.push({
          analyze_run_id,
          error: runFetchErr?.message || "Run not found",
        });
        continue;
      }

      // Verify the run belongs to this batch
      if (run.batch_id !== batchId) {
        errors.push({ analyze_run_id, error: "Run does not belong to this batch" });
        continue;
      }

      const companyName = (edited_company_name || "").trim() || "Unknown";
      const roleTitle = (edited_role_title || "").trim() || "Unknown Role";

      // Upsert company if needed
      let companyId: string | null = null;
      if (companyName && companyName !== "Unknown") {
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .ilike("name", companyName)
          .maybeSingle();
        if (company) {
          companyId = company.id;
        } else {
          // Create a minimal company record
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({ name: companyName })
            .select("id")
            .single();
          if (newCompany) companyId = newCompany.id;
        }
      }

      // Create the jobs row.
      // jobs.external_id and jobs.source are NOT NULL (no default) — must supply both.
      // jobs.source_type does NOT exist; classification fields (function/family/industry/bucket/etc)
      // are not yet propagated from the analyze pipeline to the DB row — handled by separate analyzer
      // re-runs once those columns are wired through. For now the campus_upload path stores the
      // minimum viable shape; downstream enrichment fills the rest.
      const externalId = `campus-${batchId}-${analyze_run_id}`;
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          external_id: externalId,
          source: "campus_upload",
          title: roleTitle,
          company_name: companyName,
          company_id: companyId,
          upload_batch_id: batchId,
          analysis_version: "campus_upload_v1",
          analyzed_at: new Date().toISOString(),
          enrichment_status: "partial",
        })
        .select("id")
        .single();

      if (jobError || !job) {
        errors.push({
          analyze_run_id,
          error: jobError?.message || "Failed to create job",
        });
        continue;
      }

      committedJobIds.push(job.id);

      // Re-link the analyze_run to the new job_id
      await supabase
        .from("analyze_jd_runs")
        .update({ job_id: job.id })
        .eq("id", analyze_run_id);
    }

    // Update batch status → committed and jds_committed count
    await supabase
      .from("campus_upload_batches")
      .update({
        status: "committed",
        jds_committed: committedJobIds.length,
      })
      .eq("id", batchId);

    return res.status(200).json({
      batch_id: batchId,
      committed: committedJobIds.length,
      skipped: items.filter((i: any) => !i.accept).length,
      errors_count: errors.length,
      errors,
      job_ids: committedJobIds,
    });
  }

  // ── GET /campus-upload/batch/:id ─────────────────────────────────
  // Fetch batch metadata only (lighter than /review).
  const batchGetMatch = path.match(/^\/campus-upload\/batch\/([^/]+)$/);
  if (batchGetMatch && method === "GET") {
    if (!requirePermission("jobs", "read")(auth, res)) return res;

    const batchId = batchGetMatch[1];
    const batch = await assertBatchInScope(batchId, auth, res);
    if (!batch) return res;

    const { data: batchFull } = await supabase
      .from("campus_upload_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    return res.status(200).json({ batch: batchFull });
  }

  // ── GET /campus-upload/batches ────────────────────────────────────
  // List batches (scoped to college for college_rep).
  if (path === "/campus-upload/batches" && method === "GET") {
    if (!requirePermission("jobs", "read")(auth, res)) return res;

    const u = auth.nexusUser;
    const { college_id, status: statusFilter, limit: limitRaw, page: pageRaw } =
      req.query as Record<string, string>;

    const limit = Math.min(Number(limitRaw) || 50, 200);
    const page = Math.max(Number(pageRaw) || 1, 1);
    const offset = (page - 1) * limit;

    let q = supabase
      .from("campus_upload_batches")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (college_id) q = q.eq("college_id", college_id);
    if (statusFilter) q = q.eq("status", statusFilter);

    // college_rep: restrict to their colleges
    if (u.role === "college_rep" && u.restricted_college_ids?.length) {
      q = q.in("college_id", u.restricted_college_ids);
    }

    const { data, count, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ data: data || [], total: count || 0, page, limit });
  }

  // ── POST /campus-upload/excel/parse ──────────────────────────────
  // Multipart upload: accept a single .xlsx, return detected shape + header
  // + auto-column-mapping + 5-row preview. Stateless — does NOT touch DB.
  // The client picks a track, optionally overrides the mapping, then calls
  // /excel/enqueue (Track A) or /vacancy-log/commit (Track B).
  if (path === "/campus-upload/excel/parse" && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }
    const boundaryMatch = ct.match(/boundary=([^;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "Missing multipart boundary" });
    const boundary = boundaryMatch[1].replace(/^"|"$/g, "");

    const raw = await readRawBody(req);
    const fileParts = extractAllFileParts(raw, boundary);
    if (fileParts.length === 0) return res.status(400).json({ error: "No file in request" });
    if (fileParts.length > 1) {
      return res.status(400).json({ error: "Send exactly one .xlsx file to /excel/parse" });
    }
    const fp = fileParts[0];
    const lower = fp.filename.toLowerCase();
    if (!ALLOWED_EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return res.status(400).json({
        error: `File '${fp.filename}' is not an Excel file. Use .xlsx or .xls`,
      });
    }
    if (fp.content.length > MAX_EXCEL_BYTES) {
      return res.status(400).json({
        error: `File '${fp.filename}' exceeds ${MAX_EXCEL_BYTES / 1024 / 1024} MB limit`,
      });
    }

    let parsed;
    try {
      parsed = parseExcelBuffer(fp.content);
    } catch (e: any) {
      return res.status(400).json({ error: `Failed to parse Excel: ${e?.message || String(e)}` });
    }

    if (parsed.total_rows > MAX_EXCEL_ROWS) {
      return res.status(400).json({
        error: `Sheet has ${parsed.total_rows} rows; max supported is ${MAX_EXCEL_ROWS}`,
      });
    }

    return res.status(200).json({
      filename: fp.filename,
      ...parsed,
    });
  }

  // ── POST /campus-upload/excel/enqueue ────────────────────────────
  // Track A: accept .xlsx + column mapping + batch_id (optional — creates one
  // if missing). For each non-empty row with a description >= MIN_DESCRIPTION_CHARS,
  // INSERT a campus_excel_tasks row with status='queued'. Sets batch.batch_type
  // = 'excel_jd_analyze' and kicks the first worker tick.
  //
  // Multipart fields:
  //   file       — .xlsx
  //   batch_id   — existing draft batch (optional; if omitted, requires college_id)
  //   college_id — required when batch_id is omitted
  //   mapping    — JSON column mapping { title, employer, description, ... }
  //   header_row_index — 0-based row index of the header (from /excel/parse)
  if (path === "/campus-upload/excel/enqueue" && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }
    const boundaryMatch = ct.match(/boundary=([^;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "Missing multipart boundary" });
    const boundary = boundaryMatch[1].replace(/^"|"$/g, "");

    const raw = await readRawBody(req);
    const fileParts = extractAllFileParts(raw, boundary);
    if (fileParts.length === 0) return res.status(400).json({ error: "No file in request" });
    const fp = fileParts[0];
    if (!ALLOWED_EXCEL_EXTENSIONS.some((ext) => fp.filename.toLowerCase().endsWith(ext))) {
      return res.status(400).json({ error: `File '${fp.filename}' is not an Excel file` });
    }
    if (fp.content.length > MAX_EXCEL_BYTES) {
      return res.status(400).json({ error: `File '${fp.filename}' exceeds size limit` });
    }

    const mappingStr = extractFormField(raw, boundary, "mapping");
    if (!mappingStr) return res.status(400).json({ error: "mapping field required" });
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingStr);
    } catch (e: any) {
      return res.status(400).json({ error: "mapping must be valid JSON" });
    }
    if (mapping.title === undefined || mapping.description === undefined) {
      return res.status(400).json({
        error: "Track A requires mapping for both 'title' and 'description'",
      });
    }

    const headerRowIdxStr = extractFormField(raw, boundary, "header_row_index");
    const headerRowIdx = headerRowIdxStr !== null ? parseInt(headerRowIdxStr, 10) : 0;
    if (!Number.isInteger(headerRowIdx) || headerRowIdx < 0) {
      return res.status(400).json({ error: "header_row_index must be a non-negative integer" });
    }

    // Resolve / create the batch
    const providedBatchId = extractFormField(raw, boundary, "batch_id");
    let batchId: string;
    let batchCollegeId: string;
    if (providedBatchId) {
      const batch = await assertBatchInScope(providedBatchId, auth, res);
      if (!batch) return res;
      if (batch.status === "committed" || batch.status === "cancelled") {
        return res.status(400).json({
          error: `Cannot enqueue into batch with status '${batch.status}'`,
        });
      }
      batchId = batch.id;
      batchCollegeId = batch.college_id;
      // Flip batch_type to excel_jd_analyze
      await supabase
        .from("campus_upload_batches")
        .update({ batch_type: "excel_jd_analyze" })
        .eq("id", batchId);
    } else {
      const collegeId = extractFormField(raw, boundary, "college_id");
      if (!collegeId) {
        return res.status(400).json({ error: "Either batch_id or college_id is required" });
      }
      // college_rep scope check
      const u = auth.nexusUser;
      if (u.role === "college_rep") {
        const allowed = u.restricted_college_ids || [];
        if (!allowed.includes(collegeId)) {
          return res.status(403).json({ error: "Access denied to this college" });
        }
      }
      const { data: newBatch, error: cErr } = await supabase
        .from("campus_upload_batches")
        .insert({
          college_id: collegeId,
          status: "draft",
          batch_type: "excel_jd_analyze",
          uploaded_by: u.auth_uid || null,
          source: "excel_upload",
          total_files: 0,
          jds_committed: 0,
        })
        .select("id, college_id")
        .single();
      if (cErr || !newBatch) {
        return res.status(500).json({ error: cErr?.message || "Failed to create batch" });
      }
      batchId = newBatch.id;
      batchCollegeId = newBatch.college_id;
    }

    // Extract rows + filter to those with usable descriptions
    let rows;
    try {
      rows = extractRows(fp.content, mapping, headerRowIdx);
    } catch (e: any) {
      return res.status(400).json({ error: `Failed to extract rows: ${e?.message || String(e)}` });
    }

    const eligible = rows.filter(
      (r) => r.description && r.description.length >= MIN_DESCRIPTION_CHARS && r.title
    );
    const skipped = rows.length - eligible.length;

    if (eligible.length === 0) {
      return res.status(400).json({
        error: `No eligible rows. Need a non-empty title + description with ≥ ${MIN_DESCRIPTION_CHARS} chars`,
        total_rows: rows.length,
        skipped,
      });
    }

    // Bulk insert task rows. Supabase has a ~1000-row upper bound per insert
    // in practice; chunk to be safe.
    const taskRows = eligible.map((r) => ({
      batch_id: batchId,
      excel_row_index: r.excel_row_index,
      raw_title: r.title!,
      raw_employer: r.employer,
      raw_description: r.description!,
      raw_metadata: r.raw_metadata,
      status: "queued",
    }));

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < taskRows.length; i += CHUNK) {
      const slice = taskRows.slice(i, i + CHUNK);
      const { error: insErr, count } = await supabase
        .from("campus_excel_tasks")
        .insert(slice, { count: "exact" });
      if (insErr) {
        return res.status(500).json({
          error: `Failed to enqueue tasks: ${insErr.message}`,
          inserted_so_far: inserted,
        });
      }
      inserted += count || slice.length;
    }

    // Flip batch to 'reviewing', set total_files = inserted count
    await supabase
      .from("campus_upload_batches")
      .update({ status: "reviewing", total_files: inserted })
      .eq("id", batchId);

    // Kick the first tick (fire-and-forget)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    fetch(`${baseUrl}/api/public/campus-excel-worker/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": CRON_SECRET || "",
      },
      body: JSON.stringify({ batch_id: batchId }),
    }).catch((e) => {
      console.error("[campus-upload/excel/enqueue] kick failed:", e?.message || e);
    });

    return res.status(202).json({
      batch_id: batchId,
      college_id: batchCollegeId,
      enqueued: inserted,
      total_rows: rows.length,
      skipped,
      status_url: `/api/admin/campus-excel-worker/status?batch_id=${batchId}`,
      message: "Tasks enqueued. Worker started. Poll the status URL for progress.",
    });
  }

  // ── POST /campus-upload/vacancy-log/commit ───────────────────────
  // Track B: accept .xlsx (no description) + mapping. Bulk-insert directly
  // into campus_vacancies; no LLM, no analyze pipeline. Creates a batch row
  // with batch_type='vacancy_log' (or accepts an existing draft batch).
  if (path === "/campus-upload/vacancy-log/commit" && method === "POST") {
    if (!requirePermission("jobs", "write")(auth, res)) return res;

    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }
    const boundaryMatch = ct.match(/boundary=([^;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "Missing multipart boundary" });
    const boundary = boundaryMatch[1].replace(/^"|"$/g, "");

    const raw = await readRawBody(req);
    const fileParts = extractAllFileParts(raw, boundary);
    if (fileParts.length === 0) return res.status(400).json({ error: "No file in request" });
    const fp = fileParts[0];
    if (!ALLOWED_EXCEL_EXTENSIONS.some((ext) => fp.filename.toLowerCase().endsWith(ext))) {
      return res.status(400).json({ error: `File '${fp.filename}' is not an Excel file` });
    }
    if (fp.content.length > MAX_EXCEL_BYTES) {
      return res.status(400).json({ error: `File '${fp.filename}' exceeds size limit` });
    }

    const mappingStr = extractFormField(raw, boundary, "mapping");
    if (!mappingStr) return res.status(400).json({ error: "mapping field required" });
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingStr);
    } catch (e: any) {
      return res.status(400).json({ error: "mapping must be valid JSON" });
    }
    if (mapping.title === undefined) {
      return res.status(400).json({ error: "Track B requires mapping for 'title'" });
    }

    const headerRowIdxStr = extractFormField(raw, boundary, "header_row_index");
    const headerRowIdx = headerRowIdxStr !== null ? parseInt(headerRowIdxStr, 10) : 0;
    if (!Number.isInteger(headerRowIdx) || headerRowIdx < 0) {
      return res.status(400).json({ error: "header_row_index must be a non-negative integer" });
    }

    // Resolve / create the batch
    const providedBatchId = extractFormField(raw, boundary, "batch_id");
    let batchId: string;
    let batchCollegeId: string;
    if (providedBatchId) {
      const batch = await assertBatchInScope(providedBatchId, auth, res);
      if (!batch) return res;
      if (batch.status === "committed" || batch.status === "cancelled") {
        return res.status(400).json({
          error: `Cannot commit into batch with status '${batch.status}'`,
        });
      }
      batchId = batch.id;
      batchCollegeId = batch.college_id;
      await supabase
        .from("campus_upload_batches")
        .update({ batch_type: "vacancy_log" })
        .eq("id", batchId);
    } else {
      const collegeId = extractFormField(raw, boundary, "college_id");
      if (!collegeId) {
        return res.status(400).json({ error: "Either batch_id or college_id is required" });
      }
      const u = auth.nexusUser;
      if (u.role === "college_rep") {
        const allowed = u.restricted_college_ids || [];
        if (!allowed.includes(collegeId)) {
          return res.status(403).json({ error: "Access denied to this college" });
        }
      }
      const { data: newBatch, error: cErr } = await supabase
        .from("campus_upload_batches")
        .insert({
          college_id: collegeId,
          status: "draft",
          batch_type: "vacancy_log",
          uploaded_by: u.auth_uid || null,
          source: "excel_vacancy_log",
          total_files: 0,
          jds_committed: 0,
        })
        .select("id, college_id")
        .single();
      if (cErr || !newBatch) {
        return res.status(500).json({ error: cErr?.message || "Failed to create batch" });
      }
      batchId = newBatch.id;
      batchCollegeId = newBatch.college_id;
    }

    // Extract rows
    let rows;
    try {
      rows = extractRows(fp.content, mapping, headerRowIdx);
    } catch (e: any) {
      return res.status(400).json({ error: `Failed to extract rows: ${e?.message || String(e)}` });
    }

    const eligible = rows.filter((r) => r.title && r.title.trim().length > 0);
    const skipped = rows.length - eligible.length;

    if (eligible.length === 0) {
      return res.status(400).json({ error: "No rows with a non-empty title", total_rows: rows.length });
    }

    // Map to campus_vacancies rows + split UOWD-style titles
    const vacancyRows = eligible.map((r) => {
      const split = splitVacancyTitle(r.title!);
      return {
        batch_id: batchId,
        college_id: batchCollegeId,
        excel_row_index: r.excel_row_index,
        raw_title: r.title!,
        vacancy_external_id: split.vacancy_external_id,
        parsed_roles: split.parsed_roles,
        parsed_employer: split.parsed_employer || r.employer,
        publishing_channel: r.publishing_channel,
        start_date: r.start_date,
        end_date: r.end_date,
        raw_metadata: r.raw_metadata,
      };
    });

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < vacancyRows.length; i += CHUNK) {
      const slice = vacancyRows.slice(i, i + CHUNK);
      const { error: insErr, count } = await supabase
        .from("campus_vacancies")
        .insert(slice, { count: "exact" });
      if (insErr) {
        return res.status(500).json({
          error: `Failed to insert vacancies: ${insErr.message}`,
          inserted_so_far: inserted,
        });
      }
      inserted += count || slice.length;
    }

    // Flip batch to 'committed' immediately (no review step for Track B)
    await supabase
      .from("campus_upload_batches")
      .update({
        status: "committed",
        total_files: inserted,
        jds_committed: inserted,
      })
      .eq("id", batchId);

    return res.status(200).json({
      batch_id: batchId,
      college_id: batchCollegeId,
      committed: inserted,
      total_rows: rows.length,
      skipped,
      message: "Vacancy log committed.",
    });
  }

  return undefined; // route not matched
}
