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
import { supabase } from "../lib/supabase";
import { runAnalyzeJd } from "../lib/analyze-jd";
import { AuthResult, requirePermission, hasPermission } from "../lib/auth";

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

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

    return res.status(200).json({
      batch: batchFull,
      runs: runs || [],
      total_runs: (runs || []).length,
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

  return undefined; // route not matched
}
