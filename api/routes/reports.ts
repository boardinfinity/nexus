import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult, requirePermission } from "../lib/auth";
import { supabase, ANTHROPIC_API_KEY } from "../lib/supabase";
import { callClaude } from "../lib/openai";
import { chunkText } from "../lib/helpers";

async function processReportChunk(
  text: string, title: string, sourceOrg: string, year: number,
  region: string, chunkNum: number, totalChunks: number
): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const truncatedText = text.slice(0, 80000);
  const prompt = `You are an expert analyst processing a section of an industry/skills report.
Extract structured information from the following report section.

Report: ${title} by ${sourceOrg} (${year}) — Region: ${region}
Section ${chunkNum} of ${totalChunks}:
"""
${truncatedText}
"""`;

  const jsonSchema = {
    type: "object" as const,
    properties: {
      section_summary: { type: "string", description: "Brief summary of this section (2-3 sentences)" },
      key_findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: { type: "string" },
            category: { type: "string", enum: ["skills", "labor_market", "technology", "salary", "education", "regional"] },
            confidence: { type: "number" },
          },
          required: ["finding", "category", "confidence"],
        },
      },
      skill_mentions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill_name: { type: "string" },
            mention_context: { type: "string" },
            ranking: { type: "number" },
            growth_indicator: { type: "string", enum: ["growing", "declining", "stable", "emerging"] },
            data_point: { type: "string" },
          },
          required: ["skill_name"],
        },
      },
      extracted_tables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "string" } },
                required: ["label", "value"],
              },
            },
          },
          required: ["title", "rows"],
        },
      },
      stats: {
        type: "array",
        items: {
          type: "object",
          properties: { metric: { type: "string" }, value: { type: "string" }, context: { type: "string" } },
          required: ["metric", "value", "context"],
        },
      },
    },
    required: ["section_summary", "key_findings", "skill_mentions", "extracted_tables", "stats"],
  };

  try {
    const result = await callClaude(prompt, jsonSchema);
    return JSON.parse(result);
  } catch {
    return { section_summary: "", key_findings: [], skill_mentions: [], extracted_tables: [], stats: [] };
  }
}

export async function handleReportRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  // POST /api/reports — create report record
  if (path === "/reports" && req.method === "POST") {
    if (!requirePermission("reports", "write")(auth, res)) return;
    const { title, source_org, report_year, report_type, region, file_url, file_type, file_size_bytes } = req.body || {};
    if (!title || !file_url) {
      return res.status(400).json({ error: "title and file_url are required" });
    }
    const { data, error } = await supabase
      .from("secondary_reports")
      .insert({
        title,
        source_org: source_org || null,
        report_year: report_year || null,
        report_type: report_type || null,
        region: region || null,
        file_url,
        file_type: file_type || null,
        file_size_bytes: file_size_bytes || null,
        uploaded_by: auth.email,
        processing_status: "pending",
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // GET /api/reports — list reports
  if (path === "/reports" && req.method === "GET") {
    const { search, status, report_type, region, page = "1", limit = "20" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("secondary_reports")
      .select("*", { count: "exact" });

    if (search) query = query.or(`title.ilike.%${search}%,source_org.ilike.%${search}%`);
    if (status && status !== "all") query = query.eq("processing_status", status);
    if (report_type && report_type !== "all") query = query.eq("report_type", report_type);
    if (region && region !== "all") query = query.eq("region", region);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    // Get skill mention counts for each report
    const reportIds = (data || []).map((r: any) => r.id);
    let skillCounts: Record<string, number> = {};
    if (reportIds.length > 0) {
      const { data: counts } = await supabase
        .from("report_skill_mentions")
        .select("report_id")
        .in("report_id", reportIds);
      for (const row of counts || []) {
        skillCounts[row.report_id] = (skillCounts[row.report_id] || 0) + 1;
      }
    }

    const enriched = (data || []).map((r: any) => ({
      ...r,
      skill_count: skillCounts[r.id] || 0,
    }));

    return res.json({ data: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  // GET /api/reports/:id — single report detail
  if (path.match(/^\/reports\/[^/]+$/) && !path.includes("/skills") && req.method === "GET") {
    const id = path.split("/")[2];
    const { data, error } = await supabase
      .from("secondary_reports")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return res.status(404).json({ error: "Report not found" });
    return res.json(data);
  }

  // GET /api/reports/:id/skills — skill mentions for a report
  if (path.match(/^\/reports\/[^/]+\/skills$/) && req.method === "GET") {
    const id = path.split("/")[2];
    const { data, error } = await supabase
      .from("report_skill_mentions")
      .select("*")
      .eq("report_id", id)
      .order("ranking", { ascending: true, nullsFirst: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // DELETE /api/reports/:id — delete report
  if (path.match(/^\/reports\/[^/]+$/) && req.method === "DELETE") {
    if (!requirePermission("reports", "full")(auth, res)) return;
    const id = path.split("/")[2];
    const { error } = await supabase
      .from("secondary_reports")
      .delete()
      .eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // POST /api/reports/:id/process-phase — phased AI processing (one phase per call)
  if (path.match(/^\/reports\/[^/]+\/process-phase$/) && req.method === "POST") {
    const id = path.split("/")[2];
    const { phase } = req.body || {};

    if (!phase || !["extract_text", "process_chunk", "merge_results", "match_taxonomy"].includes(phase)) {
      return res.status(400).json({ error: "Invalid phase. Must be: extract_text, process_chunk, merge_results, match_taxonomy" });
    }

    // Get the report
    const { data: report, error: fetchErr } = await supabase
      .from("secondary_reports")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr || !report) return res.status(404).json({ error: "Report not found" });

    try {
      // Phase 1: Extract text, chunk it, store chunk count
      if (phase === "extract_text") {
        if (report.processing_status === "completed") return res.status(400).json({ error: "Report already processed" });

        await supabase.from("secondary_reports").update({
          processing_status: "processing",
          error_message: null,
          extracted_data: { _chunk_results: [] },
        }).eq("id", id);

        const fileResponse = await fetch(report.file_url);
        if (!fileResponse.ok) throw new Error("Failed to download file from storage");
        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

        let fullText = "";
        if (report.file_type === "pdf") {
          const pdfParse = require("pdf-parse");
          const pdf = await pdfParse(fileBuffer);
          fullText = pdf.text;
        } else if (report.file_type === "docx") {
          const mammoth = require("mammoth");
          const result = await mammoth.extractRawText({ buffer: fileBuffer });
          fullText = result.value;
        } else {
          throw new Error("Unsupported file type: " + report.file_type);
        }

        const chunks = chunkText(fullText, 80000);
        await supabase.from("secondary_reports").update({
          total_chunks: chunks.length,
          processed_chunks: 0,
        }).eq("id", id);

        return res.json({ next_phase: "process_chunk", total_chunks: chunks.length, chunk: 0 });
      }

      // Phase 2: Process ONE chunk with Claude
      if (phase === "process_chunk") {
        const chunkIndex = report.processed_chunks || 0;
        const totalChunks = report.total_chunks || 1;

        if (chunkIndex >= totalChunks) {
          return res.json({ next_phase: "merge_results" });
        }

        // Re-download and re-parse PDF to get the chunk
        const fileResponse = await fetch(report.file_url);
        if (!fileResponse.ok) throw new Error("Failed to download file from storage");
        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

        let fullText = "";
        if (report.file_type === "pdf") {
          const pdfParse = require("pdf-parse");
          const pdf = await pdfParse(fileBuffer);
          fullText = pdf.text;
        } else if (report.file_type === "docx") {
          const mammoth = require("mammoth");
          const result = await mammoth.extractRawText({ buffer: fileBuffer });
          fullText = result.value;
        } else {
          throw new Error("Unsupported file type: " + report.file_type);
        }

        const chunks = chunkText(fullText, 80000);
        const chunkResult = await processReportChunk(
          chunks[chunkIndex],
          report.title,
          report.source_org || "Unknown",
          report.report_year || 0,
          report.region || "Global",
          chunkIndex + 1,
          totalChunks
        );

        // Append to _chunk_results in extracted_data
        const existingData = report.extracted_data || {};
        const chunkResults = existingData._chunk_results || [];
        chunkResults.push(chunkResult);

        await supabase.from("secondary_reports").update({
          processed_chunks: chunkIndex + 1,
          extracted_data: { ...existingData, _chunk_results: chunkResults },
        }).eq("id", id);

        const nextChunk = chunkIndex + 1;
        if (nextChunk >= totalChunks) {
          return res.json({ next_phase: "merge_results", chunk: nextChunk, total_chunks: totalChunks });
        }
        return res.json({ next_phase: "process_chunk", chunk: nextChunk, total_chunks: totalChunks });
      }

      // Phase 3: Merge all chunk results, generate summary, deduplicate skills
      if (phase === "merge_results") {
        const existingData = report.extracted_data || {};
        const allResults = existingData._chunk_results || [];

        const mergedFindings: any[] = [];
        const mergedSkills: any[] = [];
        const mergedTables: any[] = [];
        const mergedStats: any[] = [];
        const summaryParts: string[] = [];

        for (const result of allResults) {
          if (result.section_summary) summaryParts.push(result.section_summary);
          if (result.key_findings) mergedFindings.push(...result.key_findings);
          if (result.skill_mentions) mergedSkills.push(...result.skill_mentions);
          if (result.extracted_tables) mergedTables.push(...result.extracted_tables);
          if (result.stats) mergedStats.push(...result.stats);
        }

        // Deduplicate skills by name — keep the one with more data
        const skillMap = new Map<string, any>();
        for (const skill of mergedSkills) {
          const key = skill.skill_name?.toLowerCase();
          if (!key) continue;
          const existing = skillMap.get(key);
          if (!existing || (skill.data_point && !existing.data_point) || (skill.ranking && !existing.ranking)) {
            skillMap.set(key, skill);
          }
        }
        const dedupedSkills = Array.from(skillMap.values());

        // Generate overall summary if multiple chunks
        let summary = summaryParts.join(" ");
        if (summaryParts.length > 1 && ANTHROPIC_API_KEY) {
          try {
            const summaryPrompt = `Summarize the following section summaries from an industry report into a concise executive summary (3-5 sentences).\n\n${summaryParts.join("\n\n")}`;
            summary = await callClaude(summaryPrompt) || summary;
          } catch {
            // Keep concatenated summary
          }
        }

        // Store merged results, clear _chunk_results
        await supabase.from("secondary_reports").update({
          summary,
          key_findings: mergedFindings,
          extracted_data: { tables: mergedTables, stats: mergedStats, _deduped_skills: dedupedSkills },
        }).eq("id", id);

        return res.json({ next_phase: "match_taxonomy", skills_count: dedupedSkills.length });
      }

      // Phase 4: Match skills to taxonomy, insert report_skill_mentions
      if (phase === "match_taxonomy") {
        const existingData = report.extracted_data || {};
        const dedupedSkills = existingData._deduped_skills || [];

        const skillMentionsToInsert: any[] = [];
        for (const skill of dedupedSkills) {
          let taxonomySkillId: string | null = null;

          // Exact match
          const { data: exactMatch } = await supabase
            .from("taxonomy_skills")
            .select("id")
            .ilike("name", skill.skill_name)
            .limit(1)
            .maybeSingle();

          if (exactMatch) {
            taxonomySkillId = exactMatch.id;
          } else {
            // Fuzzy match
            try {
              const { data: fuzzyMatch } = await supabase
                .rpc("find_similar_skill", { search_term: skill.skill_name })
                .limit(1)
                .maybeSingle();
              if ((fuzzyMatch as any)?.id) {
                taxonomySkillId = (fuzzyMatch as any).id;
              }
            } catch {
              // RPC may not exist
            }
          }

          skillMentionsToInsert.push({
            report_id: id,
            taxonomy_skill_id: taxonomySkillId,
            skill_name: skill.skill_name,
            mention_context: skill.mention_context || null,
            ranking: skill.ranking || null,
            growth_indicator: skill.growth_indicator || null,
            data_point: skill.data_point || null,
          });
        }

        // Insert skill mentions
        if (skillMentionsToInsert.length > 0) {
          await supabase.from("report_skill_mentions").delete().eq("report_id", id);
          for (let i = 0; i < skillMentionsToInsert.length; i += 50) {
            await supabase.from("report_skill_mentions").insert(skillMentionsToInsert.slice(i, i + 50));
          }
        }

        // Clean up _deduped_skills from extracted_data and mark complete
        const { _deduped_skills, ...cleanData } = existingData;
        await supabase.from("secondary_reports").update({
          extracted_data: cleanData,
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        }).eq("id", id);

        return res.json({ done: true, skills_matched: skillMentionsToInsert.length });
      }
    } catch (err: any) {
      console.error("Report phase processing error:", err);
      await supabase.from("secondary_reports").update({
        processing_status: "error",
        error_message: `Phase ${phase} failed: ${err.message || "Processing failed"}`,
      }).eq("id", id);
      return res.status(500).json({ error: err.message || "Processing failed", phase });
    }
  }

  return undefined;
}
