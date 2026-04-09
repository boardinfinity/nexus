/**
 * OpenAI Batch API integration for nightly JD enrichment
 * - 50% cheaper than real-time API
 * - No timeout exposure (async, up to 24h SLA, typically 2-4h)
 * - Submits all JDs in one JSONL file at midnight
 */

import { OPENAI_API_KEY } from "./supabase";
import { supabase } from "./supabase";

const OPENAI_BASE = "https://api.openai.com/v1";
const JD_BATCH_MODEL = "gpt-4.1-mini";

// ── V2 System Prompt (same as single-job analysis) ──────────────────────────
const V2_SYSTEM_PROMPT = `You are an expert job market analyst specializing in Indian MBA/graduate placement intelligence. Classify the job description into structured fields.

Return ONLY a JSON object (no markdown, no explanation) with:
{
  "job_id": "the ID from input",
  "job_function": "FN-XXX",
  "job_family": "JF-XX",
  "job_industry": "IND-XX",
  "seniority": "L0-L5",
  "company_type": "MNC|Indian Enterprise|Startup|Government-PSU|Consulting Firm",
  "geography": "Metro-Mumbai|Metro-Delhi-NCR|Metro-Bangalore|Metro-Hyderabad|Metro-Chennai|Metro-Pune|Metro-Kolkata|Metro-Ahmedabad|Tier-2-India|Remote-India|UAE-Dubai|International-Other",
  "standardized_title": "normalized job title",
  "sub_role": "specific area within function",
  "ctc_min": null,
  "ctc_max": null,
  "experience_min_years": null,
  "experience_max_years": null,
  "min_education": "bachelor|master|phd|any",
  "bucket_label": "Seniority Title | Industry | CompanyType | Geography",
  "skills": [{"name": "...", "category": "technology|tool|certification|methodology|language|knowledge|domain|skill|competency|ability", "required": true}],
  "jd_quality": "well_structured|adequate|poor",
  "classification_confidence": "high|medium|low"
}

Max 15 skills, ordered by importance. Job functions: FN-ACC FN-ADM FN-ART FN-BDV FN-CON FN-CSU FN-EDU FN-ENG FN-ENT FN-FIN FN-HLT FN-HRM FN-ITS FN-LGL FN-MKT FN-MED FN-OPS FN-PRD FN-PGM FN-PUR FN-QAL FN-REL FN-RES FN-SAL FN-DAT FN-GEN
Job families: JF-01 through JF-20. Industries: IND-01 through IND-15.`;

// ── Submit a batch of jobs to OpenAI Batch API ─────────────────────────────
export async function submitJDBatch(jobs: Array<{ id: string; title: string; company_name?: string; description: string }>): Promise<{
  batch_id: string;
  output_file_id?: string;
  status: string;
  request_count: number;
}> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  // Build JSONL content — one request per job
  const lines = jobs.map(job => {
    const jdText = `Title: ${job.title}\nCompany: ${job.company_name || "Unknown"}\n\n${job.description.slice(0, 4000)}`;
    return JSON.stringify({
      custom_id: job.id,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: JD_BATCH_MODEL,
        max_completion_tokens: 2000,
        temperature: 0,
        messages: [
          { role: "system", content: V2_SYSTEM_PROMPT },
          { role: "user", content: `Classify this job description. Return JSON only.\n\nJob ID: ${job.id}\n\n${jdText}` },
        ],
      },
    });
  });

  const jsonlContent = lines.join("\n");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(jsonlContent);

  // Upload JSONL file
  const formData = new FormData();
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  formData.append("file", blob, "jd_batch.jsonl");
  formData.append("purpose", "batch");

  const uploadRes = await fetch(`${OPENAI_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`File upload failed: ${await uploadRes.text()}`);
  const file = await uploadRes.json();

  // Submit batch
  const batchRes = await fetch(`${OPENAI_BASE}/batches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: { description: `JD enrichment batch — ${jobs.length} jobs — ${new Date().toISOString()}` },
    }),
  });
  if (!batchRes.ok) throw new Error(`Batch submit failed: ${await batchRes.text()}`);
  const batch = await batchRes.json();

  return {
    batch_id: batch.id,
    status: batch.status,
    request_count: jobs.length,
  };
}

// ── Poll batch status ────────────────────────────────────────────────────────
export async function pollBatch(batchId: string): Promise<{
  status: string; // validating | in_progress | finalizing | completed | failed | expired | cancelled
  completed: number;
  failed: number;
  total: number;
  output_file_id?: string;
  error_file_id?: string;
}> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch(`${OPENAI_BASE}/batches/${batchId}`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Poll failed: ${await res.text()}`);
  const batch = await res.json();

  return {
    status: batch.status,
    completed: batch.request_counts?.completed || 0,
    failed: batch.request_counts?.failed || 0,
    total: batch.request_counts?.total || 0,
    output_file_id: batch.output_file_id || undefined,
    error_file_id: batch.error_file_id || undefined,
  };
}

// ── Process batch results and write to DB ────────────────────────────────────
export async function processBatchResults(outputFileId: string, batchRunId: string): Promise<{
  processed: number;
  failed: number;
}> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  // Download output file
  const fileRes = await fetch(`${OPENAI_BASE}/files/${outputFileId}/content`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  if (!fileRes.ok) throw new Error(`Download failed: ${await fileRes.text()}`);
  const rawText = await fileRes.text();

  const lines = rawText.trim().split("\n").filter(Boolean);
  let processed = 0;
  let failed = 0;

  // Load taxonomy map for skill matching
  const { data: taxData } = await supabase.from("taxonomy_skills").select("id, name");
  const taxMap = new Map<string, string>();
  for (const s of taxData || []) taxMap.set(s.name.toLowerCase().trim(), s.id);

  // Process in chunks
  const CHUNK = 50;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK);
    const results = chunk.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    for (const result of results) {
      const jobId = result.custom_id;
      if (!jobId) { failed++; continue; }
      if (result.error) { failed++; continue; }

      try {
        const content = result.response?.body?.choices?.[0]?.message?.content || "";
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);

        const confidenceToScore = (c: string) => c === "high" ? 0.90 : c === "medium" ? 0.70 : 0.50;
        const categoryToTier = (cat: string) => {
          if (["technology","tool","certification","methodology","language"].includes(cat)) return "hard_skill";
          if (["knowledge","domain"].includes(cat)) return "knowledge";
          return "competency";
        };

        // Update job record
        const bucket = (parsed.bucket_label || "").replace(/\s*\|\s*null\b/g, "").trim() || null;
        await supabase.from("jobs").update({
          job_function: parsed.job_function || null,
          job_family: parsed.job_family || null,
          job_industry: parsed.job_industry || null,
          bucket,
          sub_role: parsed.sub_role || null,
          experience_min: parsed.experience_min_years ?? null,
          experience_max: parsed.experience_max_years ?? null,
          education_req: parsed.min_education || null,
          jd_quality: parsed.jd_quality || null,
          classification_confidence: confidenceToScore(parsed.classification_confidence || "medium"),
          analysis_version: "v2",
          analyzed_at: new Date().toISOString(),
          enrichment_status: "complete",
          seniority_level: parsed.seniority || null,
        }).eq("id", jobId);

        // Bulk skill processing
        const skills = (parsed.skills || []).slice(0, 15);
        if (skills.length > 0) {
          const unmatchedNames: string[] = [];
          const skillRows: any[] = [];

          for (const skill of skills) {
            if (!skill.name) continue;
            const normalizedName = skill.name.toLowerCase().trim();
            const existingId = taxMap.get(normalizedName) || null;
            if (!existingId) unmatchedNames.push(skill.name.trim());
            skillRows.push({
              job_id: jobId,
              skill_name: skill.name.trim(),
              category: skill.category || "skill",
              skill_tier: categoryToTier(skill.category || "skill"),
              is_required: skill.required !== false,
              confidence_score: confidenceToScore(parsed.classification_confidence || "medium"),
              taxonomy_skill_id: existingId,
            });
          }

          // Auto-create unmatched skills (bulk)
          if (unmatchedNames.length > 0) {
            await supabase.from("taxonomy_skills").insert(
              unmatchedNames.map(name => ({ name, status: "unverified", is_auto_created: true }))
            ).onConflict("name");
            
            const { data: newSkills } = await supabase
              .from("taxonomy_skills").select("id, name").in("name", unmatchedNames);
            for (const s of newSkills || []) {
              taxMap.set(s.name.toLowerCase(), s.id);
              const row = skillRows.find(r => r.skill_name.toLowerCase() === s.name.toLowerCase());
              if (row) row.taxonomy_skill_id = s.id;
            }
          }

          await supabase.from("job_skills").delete().eq("job_id", jobId);
          await supabase.from("job_skills").insert(skillRows);
        }

        processed++;
      } catch (e) {
        failed++;
      }
    }

    // Update run progress
    await supabase.from("pipeline_runs").update({ processed_items: processed, failed_items: failed }).eq("id", batchRunId);
  }

  return { processed, failed };
}
