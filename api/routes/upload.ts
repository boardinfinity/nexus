import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission, requireReader } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { normalizeText, mapEmploymentTypeExtended, mapSeniorityFromClay, upsertCompanyByName, normalizeCompanyName, parseDomain } from "../lib/helpers";

async function processUploadBatch(
  rows: any[],
  sourceType: string,
  uploadId: string
): Promise<{ processed: number; skipped: number; failed: number; errors: any[] }> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      let jobData: Record<string, any>;

      if (sourceType === "clay_linkedin") {
        const title = (row["Job Title"] || "").trim();
        const externalId = (row["Job Id"] || "").trim();
        if (!title) throw new Error("Missing required field: Job Title");
        if (!externalId) throw new Error("Missing required field: Job Id");

        const companyName = (row["Company Name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(
            companyName,
            row["Company URL"] || null,
            null
          );
          // Update company LinkedIn URL if provided
          if (row["Company LinkedIn Page"] && companyId) {
            await supabase.from("companies")
              .update({ linkedin_url: row["Company LinkedIn Page"] })
              .eq("id", companyId)
              .is("linkedin_url", null);
          }
        }

        let postedAt: string | null = null;
        if (row["Posted On"]) {
          try {
            const d = new Date(row["Posted On"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);

        jobData = {
          external_id: externalId,
          source: "linkedin",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          company_id: companyId,
          company_name: companyName || null,
          source_url: row["Job Post - LinkedIn"] || null,
          location_raw: row["Location"] || null,
          posted_at: postedAt,
          seniority_level: mapSeniorityFromClay(row["Seniority"]),
          enrichment_status: "pending",
          raw_data: row,
        };
      } else if (sourceType === "google_jobs") {
        const title = (row["job_title"] || "").trim();
        const externalId = (row["job_id"] || "").trim();
        if (!title) throw new Error("Missing required field: job_title");
        if (!externalId) throw new Error("Missing required field: job_id");

        const companyName = (row["employer_name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(
            companyName,
            row["employer_website"] || null,
            row["employer_logo"] || null
          );
        }

        let postedAt: string | null = null;
        if (row["job_posted_at_datetime_utc"]) {
          try {
            const d = new Date(row["job_posted_at_datetime_utc"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const desc = row["job_description"] || null;
        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);
        const locationRaw = row["job_location"] || [row["job_city"], row["job_state"], row["job_country"]].filter(Boolean).join(", ");

        jobData = {
          external_id: externalId,
          source: "google_jobs",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          description: desc,
          company_id: companyId,
          company_name: companyName || null,
          location_raw: locationRaw || null,
          location_city: row["job_city"] || null,
          location_state: row["job_state"] || null,
          location_country: row["job_country"] || null,
          employment_type: mapEmploymentTypeExtended(row["job_employment_type"]),
          salary_min: parseFloat(row["job_min_salary"]) || null,
          salary_max: parseFloat(row["job_max_salary"]) || null,
          salary_unit: row["job_salary_period"] || null,
          posted_at: postedAt,
          application_url: row["job_apply_link"] || null,
          source_url: row["job_google_link"] || null,
          enrichment_status: (desc && desc.length > 100) ? "partial" : "pending",
          raw_data: {
            ...row,
            onet_soc: row["job_onet_soc"] || null,
            search_query: row["search_query"] || null,
          },
        };
      } else {
        // custom source
        const title = (row["title"] || "").trim();
        const externalId = (row["external_id"] || "").trim();
        if (!title) throw new Error("Missing required field: title");
        if (!externalId) throw new Error("Missing required field: external_id");

        const companyName = (row["company_name"] || "").trim();
        let companyId = null;
        if (companyName) {
          companyId = await upsertCompanyByName(companyName);
        }

        let postedAt: string | null = null;
        if (row["posted_at"]) {
          try {
            const d = new Date(row["posted_at"]);
            if (!isNaN(d.getTime())) postedAt = d.toISOString();
          } catch { /* leave null */ }
        }

        const titleNorm = normalizeText(title);
        const companyNorm = normalizeText(companyName);

        jobData = {
          external_id: externalId,
          source: "other",
          title,
          title_normalized: titleNorm || null,
          company_name_normalized: companyNorm || null,
          company_id: companyId,
          company_name: companyName || null,
          location_raw: row["location"] || null,
          posted_at: postedAt,
          description: row["description"] || null,
          source_url: row["source_url"] || null,
          employment_type: mapEmploymentTypeExtended(row["employment_type"]),
          seniority_level: row["seniority_level"] || null,
          enrichment_status: row["description"] ? "partial" : "pending",
          raw_data: row,
        };
      }

      // Insert with ON CONFLICT handling via upsert with ignoreDuplicates
      const { error: insertError } = await supabase
        .from("jobs")
        .upsert(jobData, { onConflict: "external_id,source", ignoreDuplicates: true });

      if (insertError) {
        // Check if it's a duplicate error
        if (insertError.message?.includes("duplicate") || insertError.code === "23505") {
          skipped++;
        } else {
          throw new Error(insertError.message);
        }
      } else {
        processed++;
      }
    } catch (err: any) {
      failed++;
      errors.push({
        row_index: i,
        error: err.message || "Unknown error",
        raw: row,
      });
    }
  }

  // Update csv_uploads with cumulative counts
  const { data: current } = await supabase
    .from("csv_uploads")
    .select("processed_rows, skipped_rows, failed_rows, error_log")
    .eq("id", uploadId)
    .single();

  const existingErrors = Array.isArray(current?.error_log) ? current.error_log : [];
  const newProcessed = (current?.processed_rows || 0) + processed;
  const newSkipped = (current?.skipped_rows || 0) + skipped;
  const newFailed = (current?.failed_rows || 0) + failed;

  await supabase.from("csv_uploads").update({
    processed_rows: newProcessed,
    skipped_rows: newSkipped,
    failed_rows: newFailed,
    error_log: [...existingErrors, ...errors].slice(-500), // Keep last 500 errors
  }).eq("id", uploadId);

  return { processed, skipped, failed, errors };
}

async function finalizeUpload(uploadId: string) {
  const { data } = await supabase
    .from("csv_uploads")
    .select("total_rows, processed_rows, skipped_rows, failed_rows, source_type, filename")
    .eq("id", uploadId)
    .single();

  if (!data) return;

  const totalProcessed = (data.processed_rows || 0) + (data.skipped_rows || 0) + (data.failed_rows || 0);
  const isDone = totalProcessed >= data.total_rows;

  if (isDone) {
    await supabase.from("csv_uploads").update({
      status: data.failed_rows > data.processed_rows ? "failed" : "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", uploadId);

    // Create a pipeline_run record for tracking
    await supabase.from("pipeline_runs").insert({
      pipeline_type: "csv_upload",
      trigger_type: "manual",
      config: { upload_id: uploadId, source_type: data.source_type, filename: data.filename },
      status: "completed",
      total_items: data.total_rows,
      processed_items: data.processed_rows,
      failed_items: data.failed_rows,
      skipped_items: data.skipped_rows,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: "csv_upload",
    });
  }
}

export async function handleUploadRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "upload", res)) return;

  if (path === "/upload/start" && req.method === "POST") {
    if (!requirePermission("upload", "write")(auth, res)) return;
    const { filename, source_type, total_rows } = req.body || {};
    if (!filename || !source_type || !total_rows) {
        return res.status(400).json({ error: "filename, source_type, and total_rows are required" });
    }
    if (!["clay_linkedin", "google_jobs", "custom"].includes(source_type)) {
        return res.status(400).json({ error: "source_type must be one of: clay_linkedin, google_jobs, custom" });
    }
    const { data, error } = await supabase
        .from("csv_uploads")
        .insert({
          filename,
          source_type,
          total_rows: parseInt(total_rows),
          status: "processing",
          uploaded_by: auth.email || null,
        })
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ upload_id: data.id, status: "processing" });
  }

  if (path === "/upload/batch" && req.method === "POST") {
    if (!requirePermission("upload", "write")(auth, res)) return;
    const { upload_id, source_type, rows } = req.body || {};
    if (!upload_id || !source_type || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "upload_id, source_type, and rows[] are required" });
    }
    const batchResult = await processUploadBatch(rows, source_type, upload_id);
    await finalizeUpload(upload_id);
    return res.json({ batch_result: batchResult });
  }

  if (path.match(/^\/upload\/template\/(clay_linkedin|google_jobs|custom)$/) && req.method === "GET") {
    const source = path.split("/").pop()!;
    const templates: Record<string, string> = {
        clay_linkedin: "Job Title,Job Id,Job Post - LinkedIn,Company Name,Company URL,Company LinkedIn Page,Location,Posted On,Seniority",
        google_jobs: "job_title,job_id,employer_name,employer_website,employer_logo,job_description,job_employment_type,job_apply_link,job_location,job_city,job_state,job_country,job_posted_at_datetime_utc,job_min_salary,job_max_salary,job_salary_period,job_google_link,job_onet_soc,search_query",
        custom: "title,external_id,company_name,location,posted_at,source_url,description,employment_type,seniority_level",
    };
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="template_${source}.csv"`);
    return res.send(templates[source] + "\n");
  }

  if (path.match(/^\/upload\/[0-9a-f-]+$/) && req.method === "GET") {
    const id = path.split("/").pop();
    const { data, error } = await supabase.from("csv_uploads").select("*").eq("id", id).single();
    if (error) return res.status(404).json({ error: "Upload not found" });
    return res.json(data);
  }

  if (path.match(/^\/csv-uploads\/?$/) && req.method === "GET") {
    const { limit = "20", page = "1" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { data, error, count } = await supabase
        .from("csv_uploads")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0 });
  }

  if (path.match(/^\/csv-uploads\/[0-9a-f-]+\/errors$/) && req.method === "GET") {
    const id = path.split("/")[2];
    const { data, error } = await supabase
        .from("csv_uploads")
        .select("id, filename, source_type, total_rows, processed_rows, skipped_rows, failed_rows, error_log, status, uploaded_by, created_at, completed_at")
        .eq("id", id)
        .single();
    if (error) return res.status(404).json({ error: "Upload not found" });
    return res.json(data);
  }

  if (path.match(/^\/jobs\/[^/]+\/skills$/) && req.method === "GET") {
    const jobId = path.split("/")[2];
    const { data, error } = await supabase
        .from("job_skills")
        .select("*, taxonomy_skill:taxonomy_skills(id, name, category, subcategory)")
        .eq("job_id", jobId)
        .order("confidence_score", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
}
