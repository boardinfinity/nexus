import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { AuthResult, requirePermission, requireReader } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { callGPT } from "../lib/openai";
import { chunkTextForCatalog } from "../lib/helpers";

// ==================== INTERNAL HELPERS ====================

async function downloadAndParsePDF(sb: any, filePath: string): Promise<{ text: string; pages: number }> {
  const { data: fileData, error: dlErr } = await sb.storage
    .from("college-catalogs")
    .download(filePath);
  if (dlErr || !fileData) throw new Error("Failed to download catalog PDF");
  const pdfParse = require("pdf-parse");
  const buffer = Buffer.from(await fileData.arrayBuffer());
  const pdf = await pdfParse(buffer);
  return { text: pdf.text, pages: pdf.numpages };
}

async function runCatalogPhase(
  upload: any,
  phase: string,
  opts: { college_name?: string; college_short_name?: string; catalog_year?: string }
): Promise<{ done: boolean; next_phase?: string; batch?: number; stats?: Record<string, any> }> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const progress = upload.progress || {};

  const updateProgress = async (updates: Record<string, any>) => {
    const merged = { ...progress, ...updates };
    await sb.from("catalog_uploads").update({
      status: "extracting",
      progress: merged,
      updated_at: new Date().toISOString(),
    }).eq("id", upload.id);
  };

  switch (phase) {
    // ---- PHASE 1: Extract college info + schools ----
    case "extract_info": {
      const { text: fullText, pages: totalPages } = await downloadAndParsePDF(sb, upload.file_path);
      await sb.from("catalog_uploads").update({ total_pages: totalPages }).eq("id", upload.id);
      await updateProgress({ current_phase: "extract_info", total_pages: totalPages });

      // Extract schools using regex (more reliable than GPT for this)
      const schoolRegex = /School of [A-Za-z, &]+/g;
      const schoolMentions = new Set<string>();
      let match;
      while ((match = schoolRegex.exec(fullText)) !== null) {
        let name = match[0].replace(/\s+/g, " ").trim();
        // Clean up: remove trailing prepositions/articles
        name = name.replace(/\s+(of|the|and|in|for|to|at|on|with|from|by|or|as|is|an|a)$/i, "").trim();
        if (name.length > 15 && name.length < 80) schoolMentions.add(name);
      }
      // Deduplicate similar school names (keep longest)
      const schoolNames = [...schoolMentions].filter(s =>
        !["School of Business offers", "School of Business office"].some(skip => s.startsWith(skip))
      ).filter(s => /^School of [A-Z]/.test(s));
      const uniqueSchools = schoolNames.reduce((acc: string[], s) => {
        if (!acc.some(a => s.startsWith(a) || a.startsWith(s))) acc.push(s);
        else {
          const idx = acc.findIndex(a => s.startsWith(a) || a.startsWith(s));
          if (idx >= 0 && s.length > acc[idx].length) acc[idx] = s;
        }
        return acc;
      }, []);
      console.log("Found schools via regex:", uniqueSchools);

      // Use GPT just for college name/location (first 5K chars is enough for that)
      const firstSection = fullText.slice(0, 5000);
      const gptResult = await callGPT(`You are analyzing a university academic catalog. Extract basic info from this text.

Text:
${firstSection}

Return a JSON object:
{
  "college_name": "Full official name of the university",
  "short_name": "Abbreviation",
  "country": "Country",
  "city": "City",
  "website": "Website URL if found",
  "catalog_year": "Academic year e.g. 2025-2026"
}

Only include information clearly stated in the text.`);

      const collegeInfo = JSON.parse(gptResult);
      // Add schools from regex extraction
      collegeInfo.schools = uniqueSchools.map(name => ({
        name,
        short_name: name.replace("School of ", "").split(",")[0].trim()
      }));
      const collegeFinalName = opts.college_name || collegeInfo.college_name;

      let collegeId: string;
      const { data: existingCollege } = await sb
        .from("colleges").select("id").eq("name", collegeFinalName).maybeSingle();

      if (existingCollege) {
        await sb.from("colleges").update({
          short_name: opts.college_short_name || collegeInfo.short_name,
          country: collegeInfo.country, city: collegeInfo.city,
          website: collegeInfo.website,
          catalog_year: opts.catalog_year || collegeInfo.catalog_year,
          updated_at: new Date().toISOString(),
        }).eq("id", existingCollege.id);
        collegeId = existingCollege.id;
      } else {
        const { data: newCollege, error: insertErr } = await sb
          .from("colleges").insert({
            name: collegeFinalName,
            short_name: opts.college_short_name || collegeInfo.short_name,
            country: collegeInfo.country, city: collegeInfo.city,
            website: collegeInfo.website,
            catalog_year: opts.catalog_year || collegeInfo.catalog_year,
          }).select().single();
        if (insertErr) throw new Error(`Failed to create college: ${insertErr.message}`);
        collegeId = newCollege.id;
      }

      await sb.from("catalog_uploads").update({ college_id: collegeId }).eq("id", upload.id);

      const schoolMap: Record<string, string> = {};
      for (const school of collegeInfo.schools || []) {
        const { data: schoolData } = await sb
          .from("college_schools")
          .upsert({ college_id: collegeId, name: school.name, short_name: school.short_name }, { onConflict: "college_id,name" })
          .select().single();
        if (schoolData) schoolMap[school.name] = schoolData.id;
      }

      await updateProgress({
        current_phase: "extract_info",
        college_id: collegeId,
        school_map: schoolMap,
        total_pages: totalPages,
        schools_found: Object.keys(schoolMap).length,
        programs_extracted: 0,
        courses_found: 0,
      });

      return { done: false, next_phase: "extract_programs", stats: { schools: Object.keys(schoolMap).length } };
    }

    // ---- PHASE 2: Extract programs (2 chunks per call) ----
    case "extract_programs": {
      const collegeId = progress.college_id;
      const schoolMap = progress.school_map || {};
      if (!collegeId) throw new Error("No college_id in progress — run extract_info first");

      const { text: fullText } = await downloadAndParsePDF(sb, upload.file_path);
      const programChunks = chunkTextForCatalog(fullText, 15000);
      const maxChunks = Math.min(programChunks.length, 10);
      const batchIndex = progress.programs_batch_index || 0;
      const chunksPerCall = 1;
      const endIndex = Math.min(batchIndex + chunksPerCall, maxChunks);

      const allPrograms: any[] = [];
      for (let i = batchIndex; i < endIndex; i++) {
        try {
          const gptResult = await callGPT(`You are analyzing a university academic catalog section. Extract all degree programs mentioned.

Text:
${programChunks[i]}

Schools in this university: ${Object.keys(schoolMap).join(", ")}

Return JSON array of programs:
[{
  "name": "Full program name e.g. Bachelor of Business (Accountancy)",
  "school_name": "Which school this belongs to (must be one from the list above)",
  "degree_type": "bachelor|master|phd|graduate_certificate|diploma",
  "abbreviation": "e.g. BBus, BCS, MBA",
  "major": "Major specialization if any, null otherwise",
  "duration_years": 3,
  "total_credit_points": 144,
  "qf_emirates_level": 7,
  "delivery_mode": "on_campus|online|hybrid",
  "description": "Brief program description",
  "learning_outcomes": ["outcome1", "outcome2"],
  "intake_sessions": ["Autumn", "Spring"]
}]

Only include programs clearly described. Skip duplicates.`);
          allPrograms.push(...JSON.parse(gptResult));
        } catch { /* skip chunk errors */ }
      }

      // Deduplicate and insert
      const seenPrograms = new Set<string>();
      for (const prog of allPrograms) {
        if (seenPrograms.has(prog.name)) continue;
        seenPrograms.add(prog.name);
        const schoolId = schoolMap[prog.school_name] || Object.values(schoolMap)[0];
        if (!schoolId) continue;
        await sb.from("college_programs").upsert({
          school_id: schoolId, college_id: collegeId, name: prog.name,
          degree_type: prog.degree_type || "bachelor", abbreviation: prog.abbreviation,
          major: prog.major, duration_years: prog.duration_years,
          total_credit_points: prog.total_credit_points, qf_emirates_level: prog.qf_emirates_level,
          delivery_mode: prog.delivery_mode, description: prog.description,
          learning_outcomes: prog.learning_outcomes || [], intake_sessions: prog.intake_sessions || [],
          processing_status: "completed", updated_at: new Date().toISOString(),
        }, { onConflict: "college_id,name" });
      }

      const { count: totalPrograms } = await sb.from("college_programs")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      if (endIndex < maxChunks) {
        await updateProgress({
          current_phase: "extract_programs",
          programs_batch_index: endIndex,
          programs_total_batches: maxChunks,
          programs_extracted: totalPrograms || 0,
        });
        return { done: false, next_phase: "extract_programs", batch: endIndex, stats: { programs: totalPrograms } };
      }

      await updateProgress({
        current_phase: "extract_programs",
        programs_batch_index: maxChunks,
        programs_total_batches: maxChunks,
        programs_extracted: totalPrograms || 0,
      });
      return { done: false, next_phase: "extract_courses", stats: { programs: totalPrograms } };
    }

    // ---- PHASE 3: Extract courses (2 chunks per call) ----
    case "extract_courses": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { text: fullText } = await downloadAndParsePDF(sb, upload.file_path);
      const courseChunks = chunkTextForCatalog(fullText, 15000);
      const batchIndex = progress.courses_batch_index || 0;
      const chunksPerCall = 1;
      const endIndex = Math.min(batchIndex + chunksPerCall, courseChunks.length);

      for (let i = batchIndex; i < endIndex; i++) {
        try {
          const gptResult = await callGPT(`You are analyzing a university catalog section. Extract all course/subject descriptions.

Text:
${courseChunks[i]}

Return JSON array of courses:
[{
  "code": "ACCY121",
  "name": "Accounting for Decision Making",
  "credit_points": 6,
  "description": "Full course description",
  "hours_format": "L-2, T-2",
  "prerequisites": "Raw prerequisite text",
  "topics_covered": ["topic1", "topic2"]
}]

Only include courses with a valid course code (letters followed by numbers, e.g. ACCY121, BUS101, CSIT111). Skip entries that aren't course descriptions.`);

          const courses = JSON.parse(gptResult);
          for (const course of courses) {
            if (!course.code) continue;
            const codeMatch = course.code.match(/^([A-Z]+)\s?(\d)/);
            const prefix = codeMatch ? codeMatch[1] : null;
            const level = codeMatch ? parseInt(codeMatch[2]) * 100 : null;
            const prereqCodes = (course.prerequisites || "").match(/[A-Z]{2,4}\s?\d{3}/g) || [];
            await sb.from("college_courses").upsert({
              college_id: collegeId, code: course.code.replace(/\s/g, ""), name: course.name,
              credit_points: course.credit_points || 6, description: course.description,
              hours_format: course.hours_format, prerequisites: course.prerequisites,
              prerequisite_codes: prereqCodes.map((c: string) => c.replace(/\s/g, "")),
              department_prefix: prefix, level, topics_covered: course.topics_covered || [],
              updated_at: new Date().toISOString(),
            }, { onConflict: "college_id,code" });
          }
        } catch { /* skip chunk errors */ }
      }

      const { count: totalCourses } = await sb.from("college_courses")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      if (endIndex < courseChunks.length) {
        await updateProgress({
          current_phase: "extract_courses",
          courses_batch_index: endIndex,
          courses_total_batches: courseChunks.length,
          courses_found: totalCourses || 0,
        });
        return { done: false, next_phase: "extract_courses", batch: endIndex, stats: { courses: totalCourses } };
      }

      await updateProgress({
        current_phase: "extract_courses",
        courses_batch_index: courseChunks.length,
        courses_total_batches: courseChunks.length,
        courses_found: totalCourses || 0,
      });
      return { done: false, next_phase: "map_courses", stats: { courses: totalCourses } };
    }

    // ---- PHASE 4: Map courses to programs (3 programs per call) ----
    case "map_courses": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbPrograms } = await sb.from("college_programs").select("id, name").eq("college_id", collegeId);
      const { data: dbCourses } = await sb.from("college_courses").select("id, code").eq("college_id", collegeId);
      const codeToId: Record<string, string> = {};
      for (const c of dbCourses || []) codeToId[c.code] = c.id;
      const courseCodes = (dbCourses || []).map((c: any) => c.code).join(", ");

      const batchIndex = progress.map_batch_index || 0;
      const progsPerCall = 3;
      const programs = dbPrograms || [];
      const endIndex = Math.min(batchIndex + progsPerCall, programs.length);

      for (let i = batchIndex; i < endIndex; i++) {
        const prog = programs[i];
        try {
          const gptResult = await callGPT(`Given this university program name: "${prog.name}"
And these available course codes: ${courseCodes}

Based on the program name and common university curriculum patterns, identify which courses likely belong to this program.

Return JSON:
[{
  "code": "ACCY121",
  "course_type": "core|major|elective|capstone|general_education",
  "year_of_study": 1,
  "is_required": true
}]

Be conservative — only include courses that clearly relate to this program based on the department prefix and program focus.`);

          const mappings = JSON.parse(gptResult);
          for (let idx = 0; idx < mappings.length; idx++) {
            const m = mappings[idx];
            const courseId = codeToId[m.code?.replace(/\s/g, "")];
            if (!courseId) continue;
            await sb.from("program_courses").upsert({
              program_id: prog.id, course_id: courseId,
              course_type: m.course_type || "core", year_of_study: m.year_of_study,
              is_required: m.is_required !== false, sort_order: idx,
            }, { onConflict: "program_id,course_id" });
          }
        } catch { /* skip mapping errors */ }
      }

      if (endIndex < programs.length) {
        await updateProgress({
          current_phase: "map_courses",
          map_batch_index: endIndex,
          map_total_batches: programs.length,
        });
        return { done: false, next_phase: "map_courses", batch: endIndex };
      }

      await updateProgress({
        current_phase: "map_courses",
        map_batch_index: programs.length,
        map_total_batches: programs.length,
      });
      return { done: false, next_phase: "extract_skills" };
    }

    // ---- PHASE 5: Extract skills (1 batch of 6 courses per call) ----
    case "extract_skills": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbCourses } = await sb.from("college_courses")
        .select("id, code, name, description").eq("college_id", collegeId);
      const coursesWithDesc = (dbCourses || []).filter((c: any) => c.description);

      const batchSize = 6;
      const totalBatches = Math.ceil(coursesWithDesc.length / batchSize);
      const batchIndex = progress.skills_batch_index || 0;

      if (batchIndex < totalBatches) {
        const batch = coursesWithDesc.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
        const courseDescriptions = batch.map((c: any) =>
          `Course: ${c.code} - ${c.name}\nDescription: ${c.description}`
        ).join("\n\n---\n\n");

        try {
          const gptResult = await callGPT(`You are analyzing university courses. Extract skills and competencies students will develop.

${courseDescriptions}

For EACH course above, extract skills. Return JSON:
{
  "courses": [
    {
      "code": "ACCY121",
      "skills": [
        { "skill_name": "Financial Statement Analysis", "skill_category": "Technical", "confidence": 0.9 },
        { "skill_name": "Critical Thinking", "skill_category": "Analytical", "confidence": 0.7 }
      ]
    }
  ]
}

Categories: "Technical", "Analytical", "Domain Knowledge", "Communication", "Leadership", "Research"
Be specific (not "business skills" but "financial statement analysis"). Only include skills clearly developed in each course.`);

          const result = JSON.parse(gptResult);
          for (const courseSkills of result.courses || []) {
            const course = (dbCourses || []).find((c: any) => c.code === courseSkills.code?.replace(/\s/g, ""));
            if (!course) continue;
            for (const skill of courseSkills.skills || []) {
              await sb.from("course_skills").upsert({
                course_id: course.id, skill_name: skill.skill_name,
                skill_category: skill.skill_category, confidence: skill.confidence || 0.8,
                source: "ai_extraction",
              }, { onConflict: "course_id,skill_name" });
            }
          }
        } catch { /* skip batch errors */ }

        const nextBatch = batchIndex + 1;
        await updateProgress({
          current_phase: "extract_skills",
          skills_batch_index: nextBatch,
          skills_total_batches: totalBatches,
        });

        if (nextBatch < totalBatches) {
          return { done: false, next_phase: "extract_skills", batch: nextBatch, stats: { skills_batches: `${nextBatch}/${totalBatches}` } };
        }
      }

      await updateProgress({ current_phase: "extract_skills", skills_batch_index: totalBatches, skills_total_batches: totalBatches });
      return { done: false, next_phase: "map_taxonomy" };
    }

    // ---- PHASE 6: Map skills to taxonomy ----
    case "map_taxonomy": {
      const collegeId = progress.college_id;
      if (!collegeId) throw new Error("No college_id in progress");

      const { data: dbCourses } = await sb.from("college_courses").select("id").eq("college_id", collegeId);
      const courseIds = (dbCourses || []).map((c: any) => c.id);

      const { data: extractedSkills } = await sb
        .from("course_skills").select("id, skill_name")
        .is("taxonomy_skill_id", null)
        .in("course_id", courseIds);

      for (const skill of extractedSkills || []) {
        const { data: exactMatch } = await sb
          .from("taxonomy_skills").select("id")
          .ilike("name", skill.skill_name).limit(1).maybeSingle();

        if (exactMatch) {
          await sb.from("course_skills").update({ taxonomy_skill_id: exactMatch.id }).eq("id", skill.id);
        } else {
          try {
            const { data: fuzzyMatch } = await sb
              .rpc("find_similar_skill", { search_term: skill.skill_name }).limit(1).maybeSingle();
            if ((fuzzyMatch as any)?.id) {
              await sb.from("course_skills").update({ taxonomy_skill_id: (fuzzyMatch as any).id }).eq("id", skill.id);
            }
          } catch { /* RPC may not exist */ }
        }
      }

      // Compute final stats
      const { count: totalSkills } = await sb.from("course_skills")
        .select("id", { count: "exact", head: true }).in("course_id", courseIds);
      const { count: totalPrograms } = await sb.from("college_programs")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);
      const { count: totalCourses } = await sb.from("college_courses")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);

      await sb.from("catalog_uploads").update({
        status: "completed",
        progress: { ...progress, current_phase: "done" },
        extraction_results: {
          schools: progress.schools_found || 0,
          programs: totalPrograms || 0,
          courses: totalCourses || 0,
          skills: totalSkills || 0,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", upload.id);

      return {
        done: true,
        stats: {
          schools: progress.schools_found || 0,
          programs: totalPrograms || 0,
          courses: totalCourses || 0,
          skills: totalSkills || 0,
        },
      };
    }

    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

// ==================== ROUTE HANDLER ====================

export async function handleCollegeRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "colleges", res)) return;

  // ==================== ALUMNI ====================
  if (path.match(/^\/alumni\/?$/) && req.method === "GET") {
    const { search, university_name, graduation_year, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("alumni")
      .select(`
        id, university_name, university_id, degree, field_of_study, graduation_year, start_year, current_status, created_at,
        person:people!alumni_person_id_fkey(id, full_name, first_name, last_name, email, linkedin_url, current_title, location_city, location_country)
      `, { count: "exact" });

    if (university_name) query = query.ilike("university_name", `%${university_name}%`);
    if (graduation_year) query = query.eq("graduation_year", parseInt(graduation_year));

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  // ==================== COLLEGE INTELLIGENCE ENGINE ROUTES ====================

  // POST /api/college/upload-catalog — Register a catalog upload (file already in Supabase Storage)
  if (path === "/college/upload-catalog" && req.method === "POST") {
    if (!requirePermission("colleges", "write")(auth, res)) return;
    const { file_name, file_path, file_size_bytes } = req.body || {};
    if (!file_name || !file_path) {
      return res.status(400).json({ error: "file_name and file_path are required" });
    }

    const { data: upload, error: insertErr } = await supabase
      .from("catalog_uploads")
      .insert({
        file_name,
        file_path,
        file_size_bytes: file_size_bytes || 0,
        status: "uploaded",
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });
    return res.json(upload);
  }

  // POST /api/college/process-phase — Phased catalog processing (one phase per call)
  if (path === "/college/process-phase" && req.method === "POST") {
    if (!requirePermission("colleges", "write")(auth, res)) return;
    const { upload_id, phase, college_name, college_short_name, catalog_year } = req.body || {};
    if (!upload_id || !phase) return res.status(400).json({ error: "upload_id and phase are required" });

    const { data: upload, error: fetchErr } = await supabase
      .from("catalog_uploads")
      .select("*")
      .eq("id", upload_id)
      .single();
    if (fetchErr || !upload) return res.status(404).json({ error: "Upload not found" });

    try {
      const result = await runCatalogPhase(upload, phase, { college_name, college_short_name, catalog_year });
      return res.json(result);
    } catch (err: any) {
      console.error(`Phase ${phase} failed:`, err.message);
      await supabase.from("catalog_uploads").update({
        status: "failed",
        error_message: (err.message || "Phase failed").slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", upload_id);
      return res.status(500).json({ error: err.message, phase });
    }
  }

  // GET /api/college/processing-status/:upload_id
  if (path.match(/^\/college\/processing-status\/[^/]+$/) && req.method === "GET") {
    const uploadId = path.split("/").pop()!;
    const { data, error } = await supabase
      .from("catalog_uploads")
      .select("id, status, progress, extraction_results, error_message, college_id, updated_at")
      .eq("id", uploadId)
      .single();
    if (error) return res.status(404).json({ error: "Upload not found" });
    return res.json(data);
  }

  // GET /api/colleges — List all colleges with stats (single RPC, no N+1)
  if (path === "/colleges" && req.method === "GET") {
    const { search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const [statsResult, countResult] = await Promise.all([
      supabase.rpc("get_colleges_with_stats", {
        p_limit: limitNum,
        p_offset: offset,
        p_search: search || null,
      }),
      supabase.rpc("get_colleges_count", { p_search: search || null }),
    ]);

    if (statsResult.error) {
      // Fallback: simple query without stats if RPC not yet applied
      const { data: colleges, error, count } = await supabase
        .from("colleges")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (error) return res.status(500).json({ error: error.message });
      const fallback = (colleges || []).map((c: any) => ({
        ...c,
        program_count: 0,
        course_count: 0,
        skill_count: 0,
      }));
      return res.json(fallback);
    }

    return res.json(statsResult.data || []);
  }

  // GET /api/colleges/:id — College detail with schools and programs
  if (path.match(/^\/colleges\/[^/]+$/) && !path.includes("/programs") && !path.includes("/courses") && req.method === "GET") {
    const collegeId = path.split("/")[2];
    const [collegeRes, schoolsRes, programsRes, coursesRes] = await Promise.all([
      supabase.from("colleges").select("*").eq("id", collegeId).single(),
      supabase.from("college_schools").select("*").eq("college_id", collegeId).order("name"),
      supabase.from("college_programs").select("*").eq("college_id", collegeId).order("name"),
      supabase.from("college_courses").select("id", { count: "exact", head: true }).eq("college_id", collegeId),
    ]);
    if (collegeRes.error) return res.status(404).json({ error: "College not found" });

    return res.json({
      ...collegeRes.data,
      schools: schoolsRes.data || [],
      programs: programsRes.data || [],
      course_count: coursesRes.count || 0,
    });
  }

  // GET /api/colleges/:id/programs — All programs for a college
  if (path.match(/^\/colleges\/[^/]+\/programs$/) && req.method === "GET") {
    const collegeId = path.split("/")[2];
    const { data: programs, error } = await supabase
      .from("college_programs")
      .select("*, college_schools(name)")
      .eq("college_id", collegeId)
      .order("name");
    if (error) return res.status(500).json({ error: error.message });

    const enriched = await Promise.all((programs || []).map(async (p: any) => {
      const [courseCount, skillCount] = await Promise.all([
        supabase.from("program_courses").select("id", { count: "exact", head: true }).eq("program_id", p.id),
        supabase.from("course_skills").select("id", { count: "exact", head: true })
          .in("course_id", (await supabase.from("program_courses").select("course_id").eq("program_id", p.id)).data?.map((r: any) => r.course_id) || []),
      ]);
      return {
        ...p,
        school_name: p.college_schools?.name || null,
        course_count: courseCount.count || 0,
        skill_count: skillCount.count || 0,
      };
    }));

    return res.json(enriched);
  }

  // GET /api/colleges/:id/programs/:program_id — Program detail with courses and skills
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "GET") {
    const parts = path.split("/");
    const programId = parts[4];

    const [programRes, coursesRes] = await Promise.all([
      supabase.from("college_programs").select("*, college_schools(name)").eq("id", programId).single(),
      supabase.from("program_courses")
        .select("*, college_courses(*)")
        .eq("program_id", programId)
        .order("year_of_study")
        .order("sort_order"),
    ]);

    if (programRes.error) return res.status(404).json({ error: "Program not found" });

    // Fetch skills for each course
    const courseIds = (coursesRes.data || []).map((pc: any) => pc.course_id);
    const { data: skills } = await supabase
      .from("course_skills")
      .select("*")
      .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

    return res.json({
      ...programRes.data,
      school_name: programRes.data.college_schools?.name || null,
      courses: coursesRes.data || [],
      skills: skills || [],
    });
  }

  // GET /api/colleges/:id/courses — All courses for a college with filtering
  if (path.match(/^\/colleges\/[^/]+\/courses$/) && req.method === "GET") {
    const collegeId = path.split("/")[2];
    const { prefix, level, search } = req.query as Record<string, string>;

    let query = supabase
      .from("college_courses")
      .select("*")
      .eq("college_id", collegeId)
      .order("code");

    if (prefix) query = query.eq("department_prefix", prefix);
    if (level) query = query.eq("level", parseInt(level));
    if (search) query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);

    const { data: courses, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Get skill counts for each course
    const courseIds = (courses || []).map((c: any) => c.id);
    const { data: skillCounts } = await supabase
      .from("course_skills")
      .select("course_id")
      .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

    const countMap: Record<string, number> = {};
    for (const s of skillCounts || []) {
      countMap[s.course_id] = (countMap[s.course_id] || 0) + 1;
    }

    return res.json((courses || []).map((c: any) => ({
      ...c,
      skill_count: countMap[c.id] || 0,
    })));
  }

  // GET /api/colleges/:id/courses/:course_id — Course detail
  if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "GET") {
    const parts = path.split("/");
    const courseId = parts[4];

    const [courseRes, skillsRes, programsRes] = await Promise.all([
      supabase.from("college_courses").select("*").eq("id", courseId).single(),
      supabase.from("course_skills").select("*").eq("course_id", courseId).order("confidence", { ascending: false }),
      supabase.from("program_courses")
        .select("course_type, year_of_study, college_programs(id, name, degree_type)")
        .eq("course_id", courseId),
    ]);

    if (courseRes.error) return res.status(404).json({ error: "Course not found" });

    return res.json({
      ...courseRes.data,
      skills: skillsRes.data || [],
      programs: (programsRes.data || []).map((pc: any) => ({
        ...pc.college_programs,
        course_type: pc.course_type,
        year_of_study: pc.year_of_study,
      })),
    });
  }

  // GET /api/college/skill-coverage/:program_id — Skill category breakdown
  if (path.match(/^\/college\/skill-coverage\/[^/]+$/) && req.method === "GET") {
    const programId = path.split("/").pop()!;

    const { data: programCourses } = await supabase
      .from("program_courses")
      .select("course_id, course_type, college_courses(code, name)")
      .eq("program_id", programId);

    const courseIds = (programCourses || []).map((pc: any) => pc.course_id);
    const { data: skills } = await supabase
      .from("course_skills")
      .select("*")
      .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

    // Group by category
    const categories: Record<string, { skill_count: number; skills: any[]; courses: string[] }> = {};
    for (const s of skills || []) {
      const cat = s.skill_category || "Other";
      if (!categories[cat]) categories[cat] = { skill_count: 0, skills: [], courses: [] };
      categories[cat].skill_count++;
      categories[cat].skills.push(s);
      const course = (programCourses || []).find((pc: any) => pc.course_id === s.course_id);
      if (course?.college_courses) {
        const courseLabel = `${(course.college_courses as any).code} - ${(course.college_courses as any).name}`;
        if (!categories[cat].courses.includes(courseLabel)) {
          categories[cat].courses.push(courseLabel);
        }
      }
    }

    return res.json({
      categories: Object.entries(categories).map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.skill_count - a.skill_count),
    });
  }

  // GET /api/college/compare-programs?program_ids=uuid1,uuid2,...
  if (path === "/college/compare-programs" && req.method === "GET") {
    const { program_ids } = req.query as Record<string, string>;
    if (!program_ids) return res.status(400).json({ error: "program_ids query param required" });

    const ids = program_ids.split(",").filter(Boolean);
    if (ids.length < 2 || ids.length > 4) {
      return res.status(400).json({ error: "Provide 2-4 program IDs" });
    }

    const { data, error } = await supabase.rpc("get_program_skill_comparison", { p_program_ids: ids });
    if (error) return res.status(500).json({ error: error.message });

    // Also fetch program names
    const { data: programs } = await supabase
      .from("college_programs")
      .select("id, name, degree_type, major")
      .in("id", ids);

    return res.json({ programs: programs || [], skills: data || [] });
  }

  // GET /api/college/skill-gaps/:college_id
  if (path.match(/^\/college\/skill-gaps\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/").pop()!;
    const { taxonomy_category } = req.query as Record<string, string>;

    const { data, error } = await supabase.rpc("get_skill_gaps", { p_college_id: collegeId });
    if (error) return res.status(500).json({ error: error.message });

    let filtered = data || [];
    if (taxonomy_category) {
      filtered = filtered.filter((s: any) => s.taxonomy_category === taxonomy_category);
    }

    // Group by category
    const grouped: Record<string, string[]> = {};
    for (const s of filtered) {
      if (!grouped[s.taxonomy_category]) grouped[s.taxonomy_category] = [];
      grouped[s.taxonomy_category].push(s.taxonomy_skill_name);
    }

    return res.json({ gaps: grouped, total: filtered.length });
  }

  // GET /api/college/program-skill-heatmap/:college_id
  if (path.match(/^\/college\/program-skill-heatmap\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/").pop()!;

    const { data, error } = await supabase.rpc("get_program_skill_heatmap", { p_college_id: collegeId });
    if (error) return res.status(500).json({ error: error.message });

    return res.json(data || []);
  }

  // GET /api/college/course-prerequisites/:college_id
  if (path.match(/^\/college\/course-prerequisites\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/").pop()!;

    const { data: courses } = await supabase
      .from("college_courses")
      .select("id, code, name, prerequisite_codes, level, department_prefix")
      .eq("college_id", collegeId);

    const codeToId: Record<string, string> = {};
    for (const c of courses || []) codeToId[c.code] = c.id;

    const nodes = (courses || []).map((c: any) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      level: c.level,
      prefix: c.department_prefix,
    }));

    const edges: { from: string; to: string }[] = [];
    for (const c of courses || []) {
      for (const prereqCode of c.prerequisite_codes || []) {
        if (codeToId[prereqCode]) {
          edges.push({ from: codeToId[prereqCode], to: c.id });
        }
      }
    }

    return res.json({ nodes, edges });
  }

  // ==================== COLLEGE CRUD ENDPOINTS ====================

  // PATCH /api/colleges/:id — Update college info
  if (path.match(/^\/colleges\/[^/]+$/) && !path.includes("/programs") && !path.includes("/courses") && req.method === "PATCH") {
    const collegeId = path.split("/")[2];
    const { name, short_name, country, city, website, catalog_year } = req.body || {};
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (short_name !== undefined) updates.short_name = short_name;
    if (country !== undefined) updates.country = country;
    if (city !== undefined) updates.city = city;
    if (website !== undefined) updates.website = website;
    if (catalog_year !== undefined) updates.catalog_year = catalog_year;

    const { data, error } = await supabase
      .from("colleges")
      .update(updates)
      .eq("id", collegeId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // POST /api/colleges/:id/programs — Create program
  if (path.match(/^\/colleges\/[^/]+\/programs$/) && req.method === "POST") {
    const collegeId = path.split("/")[2];
    const { name, school_id, degree_type, abbreviation, major, duration_years, total_credit_points, description, learning_outcomes } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!degree_type) return res.status(400).json({ error: "degree_type is required" });

    const { data, error } = await supabase
      .from("college_programs")
      .insert({
        college_id: collegeId,
        name,
        school_id: school_id || null,
        degree_type,
        abbreviation: abbreviation || null,
        major: major || null,
        duration_years: duration_years || null,
        total_credit_points: total_credit_points || null,
        description: description || null,
        learning_outcomes: learning_outcomes || [],
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // PATCH /api/colleges/:id/programs/:pid — Update program
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "PATCH") {
    const parts = path.split("/");
    const programId = parts[4];
    const { name, school_id, degree_type, abbreviation, major, duration_years, total_credit_points, description, learning_outcomes } = req.body || {};
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (school_id !== undefined) updates.school_id = school_id;
    if (degree_type !== undefined) updates.degree_type = degree_type;
    if (abbreviation !== undefined) updates.abbreviation = abbreviation;
    if (major !== undefined) updates.major = major;
    if (duration_years !== undefined) updates.duration_years = duration_years;
    if (total_credit_points !== undefined) updates.total_credit_points = total_credit_points;
    if (description !== undefined) updates.description = description;
    if (learning_outcomes !== undefined) updates.learning_outcomes = learning_outcomes;

    const { data, error } = await supabase
      .from("college_programs")
      .update(updates)
      .eq("id", programId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // DELETE /api/colleges/:id/programs/:pid — Delete program
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+$/) && req.method === "DELETE") {
    const parts = path.split("/");
    const programId = parts[4];
    // Delete related program_courses first
    await supabase.from("program_courses").delete().eq("program_id", programId);
    const { error } = await supabase.from("college_programs").delete().eq("id", programId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // POST /api/colleges/:id/courses — Create course
  if (path.match(/^\/colleges\/[^/]+\/courses$/) && req.method === "POST") {
    const collegeId = path.split("/")[2];
    const { code, name, credit_points, description, prerequisites, hours_format } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });
    if (!name) return res.status(400).json({ error: "name is required" });

    // Parse department prefix and level from code
    const codeMatch = code.match(/^([A-Z]+)(\d+)/);
    const department_prefix = codeMatch ? codeMatch[1] : null;
    const level = codeMatch ? Math.floor(parseInt(codeMatch[2]) / 100) * 100 : null;

    // Parse prerequisite codes from prerequisites string
    const prerequisite_codes = prerequisites
      ? (prerequisites.match(/[A-Z]{2,5}\d{3,4}/g) || [])
      : [];

    const { data, error } = await supabase
      .from("college_courses")
      .insert({
        college_id: collegeId,
        code,
        name,
        credit_points: credit_points || 6,
        description: description || null,
        prerequisites: prerequisites || null,
        prerequisite_codes,
        hours_format: hours_format || null,
        department_prefix,
        level,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // PATCH /api/colleges/:id/courses/:cid — Update course
  if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "PATCH") {
    const parts = path.split("/");
    const courseId = parts[4];
    const { code, name, credit_points, description, prerequisites, hours_format } = req.body || {};
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (code !== undefined) {
      updates.code = code;
      const codeMatch = code.match(/^([A-Z]+)(\d+)/);
      updates.department_prefix = codeMatch ? codeMatch[1] : null;
      updates.level = codeMatch ? Math.floor(parseInt(codeMatch[2]) / 100) * 100 : null;
    }
    if (name !== undefined) updates.name = name;
    if (credit_points !== undefined) updates.credit_points = credit_points;
    if (description !== undefined) updates.description = description;
    if (prerequisites !== undefined) {
      updates.prerequisites = prerequisites;
      updates.prerequisite_codes = prerequisites
        ? (prerequisites.match(/[A-Z]{2,5}\d{3,4}/g) || [])
        : [];
    }
    if (hours_format !== undefined) updates.hours_format = hours_format;

    const { data, error } = await supabase
      .from("college_courses")
      .update(updates)
      .eq("id", courseId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // DELETE /api/colleges/:id/courses/:cid — Delete course
  if (path.match(/^\/colleges\/[^/]+\/courses\/[^/]+$/) && req.method === "DELETE") {
    const parts = path.split("/");
    const courseId = parts[4];
    // Check if course is assigned to programs
    const { count } = await supabase
      .from("program_courses")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);
    // Delete related records
    await supabase.from("course_skills").delete().eq("course_id", courseId);
    await supabase.from("program_courses").delete().eq("course_id", courseId);
    const { error } = await supabase.from("college_courses").delete().eq("id", courseId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, had_program_assignments: (count || 0) > 0 });
  }

  // POST /api/colleges/:id/programs/:pid/courses — Add course to program
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses$/) && req.method === "POST") {
    const parts = path.split("/");
    const programId = parts[4];
    const { course_id, course_type, year_of_study, sort_order } = req.body || {};
    if (!course_id) return res.status(400).json({ error: "course_id is required" });

    // Check for duplicates
    const { data: existing } = await supabase
      .from("program_courses")
      .select("id")
      .eq("program_id", programId)
      .eq("course_id", course_id)
      .maybeSingle();
    if (existing) return res.status(400).json({ error: "Course already assigned to this program" });

    const { data, error } = await supabase
      .from("program_courses")
      .insert({
        program_id: programId,
        course_id,
        course_type: course_type || "core",
        year_of_study: year_of_study || null,
        sort_order: sort_order || 0,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // PATCH /api/colleges/:id/programs/:pid/courses/:cid — Update program-course assignment
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses\/[^/]+$/) && req.method === "PATCH") {
    const parts = path.split("/");
    const programId = parts[4];
    const courseId = parts[6];
    const { course_type, year_of_study, sort_order } = req.body || {};
    const updates: Record<string, any> = {};
    if (course_type !== undefined) updates.course_type = course_type;
    if (year_of_study !== undefined) updates.year_of_study = year_of_study;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from("program_courses")
      .update(updates)
      .eq("program_id", programId)
      .eq("course_id", courseId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // DELETE /api/colleges/:id/programs/:pid/courses/:cid — Remove course from program
  if (path.match(/^\/colleges\/[^/]+\/programs\/[^/]+\/courses\/[^/]+$/) && req.method === "DELETE") {
    const parts = path.split("/");
    const programId = parts[4];
    const courseId = parts[6];
    const { error } = await supabase
      .from("program_courses")
      .delete()
      .eq("program_id", programId)
      .eq("course_id", courseId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // ==================== JOB STATUS CHECKER ====================
  if (path === "/pipelines/check-job-status" && req.method === "POST") {
    if (!requirePermission("pipelines", "full")(auth, res)) return;
    const { batch_size = 50 } = req.body || {};
    const limit = Math.min(parseInt(batch_size) || 50, 200);

    // Get jobs with source_url that haven't been checked recently (or never checked)
    const { data: jobs, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, source_url, job_status, status_checked_at")
      .not("source_url", "is", null)
      .order("status_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!jobs || jobs.length === 0) return res.json({ success: true, checked: 0, message: "No jobs with source URLs to check" });

    // Create a pipeline run
    const { data: run, error: runErr } = await supabase
      .from("pipeline_runs")
      .insert({
        pipeline_type: "job_status_check",
        trigger_type: "manual",
        config: { batch_size: limit },
        status: "running",
        total_items: jobs.length,
        processed_items: 0,
        started_at: new Date().toISOString(),
        triggered_by: "dashboard",
      })
      .select()
      .single();
    if (runErr) return res.status(500).json({ error: runErr.message });

    // Process each job
    let processed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        let status = "unknown";
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(job.source_url!, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusBot/1.0)" },
            signal: controller.signal,
            redirect: "follow",
          });
          clearTimeout(timeout);

          if (response.status === 404 || response.status === 410) {
            status = "closed";
          } else if (response.ok) {
            const html = await response.text();
            const lowerHtml = html.toLowerCase();
            // Check for closed/expired indicators
            if (
              lowerHtml.includes("job not found") ||
              lowerHtml.includes("this job has expired") ||
              lowerHtml.includes("no longer available") ||
              lowerHtml.includes("position has been filled") ||
              lowerHtml.includes("this job is no longer") ||
              lowerHtml.includes("job has been removed")
            ) {
              status = "closed";
            } else if (
              lowerHtml.includes("apply now") ||
              lowerHtml.includes("apply for this") ||
              lowerHtml.includes("submit application") ||
              lowerHtml.includes("easy apply")
            ) {
              status = "open";
            }
          } else {
            status = "unknown";
          }
        } catch {
          status = "unknown";
        }

        await supabase
          .from("jobs")
          .update({ job_status: status, status_checked_at: new Date().toISOString() })
          .eq("id", job.id);
        processed++;
      } catch {
        failed++;
      }

      // Update progress
      await supabase
        .from("pipeline_runs")
        .update({ processed_items: processed, failed_items: failed })
        .eq("id", run.id);
    }

    // Complete the pipeline run
    await supabase
      .from("pipeline_runs")
      .update({
        status: "completed",
        processed_items: processed,
        failed_items: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return res.json({ success: true, checked: processed, failed, pipeline_run_id: run.id });
  }

  return undefined;
}
