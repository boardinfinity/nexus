import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, OPENAI_API_KEY } from "../lib/supabase";
import { type AuthResult, requireReader, requireEditor, requireAdmin } from "../lib/auth";
import { resolveBucket } from "../lib/bucketResolver";
import { type ClassificationResult, type ClassificationSkill, categoryToTier, confidenceBandToScore } from "../lib/bucketTypes";
import { runAnalyzeJd } from "../lib/analyze-jd";

function confidenceToScore(c: string): number {
  return confidenceBandToScore(c as any);
}

const JD_CLASSIFICATION_PROMPT = `You are an expert job market analyst specializing in Indian MBA/graduate placement intelligence. Classify the given job description into structured fields.

Return a JSON object with:

{
  // FUNCTION (what type of work) — pick exactly ONE from the 26 codes:
  // FN-ACC: Accounting | FN-ADM: Administrative | FN-ART: Arts & Design | FN-BDV: Business Development
  // FN-CON: Consulting | FN-CUS: Customer Success & Support | FN-EDU: Education | FN-ENG: Engineering
  // FN-ENT: Entrepreneurship | FN-FIN: Finance | FN-HLT: Healthcare Services | FN-HRM: Human Resources
  // FN-ITE: Information Technology | FN-LEG: Legal | FN-MKT: Marketing | FN-MED: Media & Communication
  // FN-OPS: Operations | FN-PDM: Product Management | FN-PGM: Program & Project Management
  // FN-PUR: Purchasing | FN-QAS: Quality Assurance | FN-RES: Real Estate | FN-RSC: Research
  // FN-SAL: Sales | FN-DAT: Data & Analytics | FN-GEN: General Management
  "job_function": "FN-XXX",
  "job_function_name": "Name",

  // FAMILY (career bucket for Indian placement) — pick exactly ONE from 20:
  // JF-01: Strategy & Consulting | JF-02: Finance & Banking | JF-03: Marketing & Brand
  // JF-04: Sales & Business Development | JF-05: Supply Chain & Operations | JF-06: FMCG & Retail
  // JF-07: Human Resources | JF-08: Data Science & Analytics | JF-09: Software Engineering
  // JF-10: Product & Design | JF-11: Media & Content | JF-12: Healthcare & Pharma
  // JF-13: Education & Training | JF-14: Legal & Compliance | JF-15: Real Estate & Infrastructure
  // JF-16: Energy & Sustainability | JF-17: Manufacturing & Engineering | JF-18: Government & PSU
  // JF-19: Entrepreneurship & Startups | JF-20: General Management & Leadership
  "job_family": "JF-XX",
  "job_family_name": "Name",

  // INDUSTRY — pick ONE from 15:
  // IND-01: IT & Software | IND-02: BFSI (Banking, Financial Services, Insurance)
  // IND-03: E-Commerce & Internet | IND-04: FMCG & Consumer Goods | IND-05: Consulting & Professional Services
  // IND-06: Manufacturing & Industrial | IND-07: Healthcare & Pharma | IND-08: Energy & Utilities
  // IND-09: Real Estate & Construction | IND-10: Media & Entertainment | IND-11: Education & Ed-Tech
  // IND-12: Automotive & EV | IND-13: Telecom & Networking | IND-14: Government & Defense
  // IND-15: Others
  "job_industry": "IND-XX",
  "job_industry_name": "Name",

  // SENIORITY — pick ONE:
  // L0: Intern/Trainee (0 yrs) | L1: Entry (0-2 yrs) | L2: Mid (2-5 yrs)
  // L3: Senior (5-10 yrs) | L4: Director (10-15 yrs) | L5: Executive (15+ yrs)
  "seniority": "LX",

  // COMPANY TYPE — pick ONE:
  // MNC | Indian Enterprise | Startup | Government-PSU | Consulting Firm
  "company_type": "one of above",

  // GEOGRAPHY — pick ONE:
  // Metro-Mumbai | Metro-Delhi-NCR | Metro-Bangalore | Metro-Hyderabad | Metro-Chennai | Metro-Pune
  // Metro-Kolkata | Metro-Ahmedabad | Tier-2-India | Remote-India | UAE-Dubai | International-Other
  "geography": "one of above",

  // STANDARDIZED TITLE — normalize the title (e.g., "Sr. SDE-II" → "Senior Software Engineer")
  "standardized_title": "Normalized Title",

  // SUB-ROLE — more specific role category within the function
  "sub_role": "specific area within the function",

  // CTC RANGE (ONLY if explicitly stated in the JD)
  "ctc_min": null,
  "ctc_max": null,

  // EXPERIENCE RANGE (from JD)
  "experience_min": null,
  "experience_max": null,

  // EDUCATION REQUIREMENT
  "min_education": "bachelor" | "master" | "phd" | "any",
  "preferred_fields": ["Computer Science", "Statistics"],

  // BUCKET LABEL — clean human-readable label
  // Format: "{Seniority-Level} {Standardized Title} | {Industry Name} | {Company Type} | {Geography}"
  "bucket": "The bucket label",
  "company_name": "Company name extracted from the JD text (null if not mentioned)",

  // SKILLS (top 15, with categories)
  // Categories: technology, tool, skill, knowledge, competency, certification, domain, methodology, language, ability
  "skills": [
    { "name": "Python", "category": "technology", "required": true },
    { "name": "Leadership", "category": "competency", "required": false }
  ],

  // JD QUALITY — how well-written is this JD?
  "jd_quality": "well_structured" | "adequate" | "poor",

  // CONFIDENCE — how confident are you in the classification?
  "classification_confidence": "high" | "medium" | "low"
}

INDUSTRY DETECTION (use these signals from the JD text):
- Look for explicit industry keywords: "bank", "fintech", "NBFC", "insurance", "mutual fund" → IND-02: BFSI
- "SaaS", "cloud", "software product", "tech company", "IT services" → IND-01: IT & Software
- "e-commerce", "marketplace", "D2C", "online retail" → IND-03: E-Commerce & Internet
- "FMCG", "consumer goods", "retail chain", "CPG", "food & beverage" → IND-04: FMCG & Consumer Goods
- "consulting", "advisory", "Big 4", "Deloitte", "McKinsey", "BCG", "Bain", "EY", "PwC", "KPMG" → IND-05: Consulting
- "manufacturing", "plant", "factory", "production", "industrial" → IND-06: Manufacturing
- "pharma", "healthcare", "hospital", "clinical", "medical devices", "biotech" → IND-07: Healthcare & Pharma
- "energy", "oil & gas", "renewable", "solar", "power", "utilities" → IND-08: Energy
- "real estate", "construction", "infrastructure", "property" → IND-09: Real Estate
- "media", "entertainment", "OTT", "advertising agency", "gaming", "film" → IND-10: Media
- "ed-tech", "education", "university", "school", "LMS", "e-learning" → IND-11: Education
- "automobile", "automotive", "EV", "electric vehicle", "auto parts" → IND-12: Automotive
- "telecom", "5G", "network", "ISP" → IND-13: Telecom
- "government", "PSU", "public sector", "defense", "ministry" → IND-14: Government
- If well-known company: TCS/Infosys/Wipro/HCL/Tech Mahindra → IND-01, HDFC/ICICI/SBI/Axis → IND-02, Flipkart/Amazon India/Swiggy/Zomato → IND-03, HUL/ITC/P&G/Nestle → IND-04
- ONLY use IND-15: Others if there are absolutely NO industry signals

COMPANY TYPE DETECTION:
- "Series A/B/C", "funded by", "VC-backed", "early stage", employee count < 500 → Startup
- "Fortune 500", "global operations", well-known MNC names → MNC
- "PSU", "government", "public sector undertaking" → Government-PSU
- "consulting", "advisory", Big 4 / MBB names → Consulting Firm
- Default for Indian companies without other signals → Indian Enterprise

CRITICAL RULES:
- Use ONLY the codes provided. Do not invent new codes.
- If a JD is too vague to classify, set classification_confidence to "low"
- Cap skills at 15 most important per JD
- Return null for any field you genuinely cannot determine`;

export async function handleTaxonomyRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  if (!requireReader(auth, "taxonomy", res)) return;

  // ── GET /taxonomy/job-roles — returns all roles grouped by family ──
  if (path === "/taxonomy/job-roles" && req.method === "GET") {
    const { data, error } = await supabase
      .from("job_roles")
      .select("id, name, family, synonyms")
      .order("family")
      .order("name");
    if (error) return res.status(500).json({ error: error.message });
    const grouped: Record<string, typeof data> = {};
    for (const role of data || []) {
      if (!grouped[role.family]) grouped[role.family] = [];
      grouped[role.family].push(role);
    }
    return res.json({ families: grouped, total: (data || []).length });
  }

  if (path === "/taxonomy" && req.method === "GET") {
    const {
      category, source, search,
      l1, l2, regions, source_filter,
      page = "1", limit = "50", sort = "name", order = "asc",
    } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const ascending = order !== "desc";
    const allowedSortCols = ["name", "category", "subcategory", "l1", "l2", "source", "created_at"];
    const sortByJobCount = sort === "job_count";
    const sortCol = allowedSortCols.includes(sort) ? sort : "name";

    let query = supabase
      .from("taxonomy_skills")
      .select("*", { count: "exact" });

    if (category) query = query.eq("category", category);
    if (source) query = query.eq("source", source);
    if (search) query = query.ilike("name", `%${search}%`);
    // ── New 4-category filters ──
    if (l1) query = query.eq("l1", l1);
    if (l2) query = query.eq("l2", l2);
    // regions: comma-separated list -> array overlap match (skill has ANY of the requested regions)
    if (regions) {
      const arr = regions.split(",").map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) query = query.overlaps("regions", arr);
    }
    // source_filter: 'v2' = nexus_taxonomy_v2_2026_05; 'legacy' = anything else
    if (source_filter === "v2") {
      query = query.eq("source", "nexus_taxonomy_v2_2026_05");
    } else if (source_filter === "legacy") {
      query = query.neq("source", "nexus_taxonomy_v2_2026_05");
    }

    // Apply ordering — job_count sorting is done in-memory after enrichment
    if (!sortByJobCount) {
      query = query.order(sortCol, { ascending });
    } else {
      query = query.order("name", { ascending: true });
    }

    const { data, error, count } = await query
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    // Enrich each skill with job_count
    if (data && data.length > 0) {
      const skillIds = data.map((s: any) => s.id);
      const { data: jobSkills } = await supabase
        .from("job_skills")
        .select("taxonomy_skill_id")
        .in("taxonomy_skill_id", skillIds);

      const countMap: Record<string, number> = {};
      for (const js of jobSkills || []) {
        if (js.taxonomy_skill_id) {
          countMap[js.taxonomy_skill_id] = (countMap[js.taxonomy_skill_id] || 0) + 1;
        }
      }
      for (const skill of data) {
        (skill as any).job_count = countMap[(skill as any).id] || 0;
      }

      // Sort by job_count in-memory if requested
      if (sortByJobCount) {
        data.sort((a: any, b: any) => ascending
          ? (a.job_count || 0) - (b.job_count || 0)
          : (b.job_count || 0) - (a.job_count || 0)
        );
      }
    }

    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  if (path === "/taxonomy/stats" && req.method === "GET") {
    // Use single RPC for all taxonomy stats (SQL aggregation)
    const { data, error } = await supabase.rpc("get_taxonomy_stats");
    if (error) return res.status(500).json({ error: error.message });

    // Fetch skill lifecycle counts
    const [unverifiedRes, validatedRes, autoCreatedRes] = await Promise.all([
      supabase.from("taxonomy_skills").select("id", { count: "exact", head: true }).eq("status", "unverified"),
      supabase.from("taxonomy_skills").select("id", { count: "exact", head: true }).eq("status", "validated"),
      supabase.from("taxonomy_skills").select("id", { count: "exact", head: true }).eq("is_auto_created", true),
    ]);

    return res.json({
      total: data?.total || 0,
      by_category: data?.by_category || {},
      by_l1: data?.by_l1 || {},
      by_l2: data?.by_l2 || {},
      by_region: data?.by_region || {},
      hot_technologies: data?.hot_technologies || 0,
      top_skills: (data?.top_skills || []).map((s: any) => ({ name: s.name, job_count: Number(s.job_count) })),
      unverified_count: unverifiedRes.count || 0,
      validated_count: validatedRes.count || 0,
      auto_created_count: autoCreatedRes.count || 0,
    });
  }

  // Reference data: all job_functions, job_families, job_industries in one call
  if (path === "/taxonomy/reference-data" && req.method === "GET") {
    const [funcRes, famRes, indRes] = await Promise.all([
      supabase.from("job_functions").select("id, name").order("id"),
      supabase.from("job_families").select("id, name").order("id"),
      supabase.from("job_industries").select("id, name").order("id"),
    ]);

    if (funcRes.error || famRes.error || indRes.error) {
      return res.status(500).json({ error: "Failed to fetch reference data" });
    }

    return res.json({
      functions: funcRes.data || [],
      families: famRes.data || [],
      industries: indRes.data || [],
    });
  }

  // Validate skills: triggers validate_skills() DB function (admin only)
  if (path === "/taxonomy/validate-skills" && req.method === "POST") {
    if (!requireAdmin(auth, res)) return;

    const { data, error } = await supabase.rpc("validate_skills");
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ validated: data || 0 });
  }

  // Unverified skills: top N by mention_count
  if (path === "/taxonomy/skills/unverified" && req.method === "GET") {
    const limit = Math.min(parseInt((req.query as Record<string, string>).limit || "20"), 100);

    const { data, error } = await supabase
      .from("taxonomy_skills")
      .select("id, name, category, status, mention_count, company_count, is_auto_created, first_seen_at")
      .eq("status", "unverified")
      .order("mention_count", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: data?.length || 0 });
  }

  if (path.match(/^\/taxonomy\/[^/]+$/) && req.method === "GET") {
    const id = path.split("/")[2];
    const { data, error } = await supabase
      .from("taxonomy_skills")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return res.status(404).json({ error: "Taxonomy skill not found" });

    // Get job count for this skill
    const { count: jobCount } = await supabase
      .from("job_skills")
      .select("id", { count: "exact", head: true })
      .eq("taxonomy_skill_id", id);

    return res.json({ ...data, job_count: jobCount || 0 });
  }

  // Edit taxonomy skill name
  if (path.match(/^\/taxonomy\/[^/]+$/) && req.method === "PATCH") {
    if (!requireEditor(auth, "taxonomy", res)) return;
    const id = path.split("/")[2];
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data, error } = await supabase
      .from("taxonomy_skills")
      .update({ name })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // Skill detail: linked jobs, courses, reports
  if (path.match(/^\/taxonomy\/[^/]+\/linked$/) && req.method === "GET") {
    const id = path.split("/")[2];

    // Get the skill first
    const { data: skill } = await supabase.from("taxonomy_skills").select("id, name").eq("id", id).single();
    if (!skill) return res.status(404).json({ error: "Skill not found" });

    // Linked jobs (via job_skills by taxonomy_skill_id or skill_name)
    const { data: jobSkills } = await supabase
      .from("job_skills")
      .select("job_id, skill_name")
      .or(`taxonomy_skill_id.eq.${id},skill_name.ilike.%${skill.name}%`)
      .limit(50);

    const jobIds = [...new Set((jobSkills || []).map(js => js.job_id))];
    let linkedJobs: any[] = [];
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, title, company_name, source")
        .in("id", jobIds.slice(0, 50));
      linkedJobs = jobs || [];
    }

    // Linked courses (via course_skills)
    const { data: courseSkills } = await supabase
      .from("course_skills")
      .select("course_id")
      .eq("taxonomy_skill_id", id)
      .limit(50);

    let linkedCourses: any[] = [];
    const courseIds = [...new Set((courseSkills || []).map(cs => cs.course_id))];
    if (courseIds.length > 0) {
      const { data: courses } = await supabase
        .from("college_courses")
        .select("id, course_code, title, college_id")
        .in("id", courseIds.slice(0, 50));
      linkedCourses = courses || [];
    }

    // Linked reports
    const { data: reports } = await supabase
      .from("reports")
      .select("id, title, report_type, created_at")
      .ilike("config::text", `%${skill.name}%`)
      .limit(20);

    return res.json({
      jobs: linkedJobs,
      courses: linkedCourses,
      reports: reports || [],
    });
  }

  // ── GET /api/analyze-jd/runs — recent runs with filters (Track E dashboard) ──
  if (path === "/analyze-jd/runs" && req.method === "GET") {
    if (!requireReader(auth, "jobs", res)) return;

    const source = req.query.source as string | undefined;
    const status = req.query.status as string | undefined;
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const limitRaw = req.query.limit as string | undefined;
    const pageRaw = req.query.page as string | undefined;
    const limit = Math.min(parseInt(limitRaw || "50", 10), 200);
    const page = Math.max(parseInt(pageRaw || "1", 10), 1);
    const offset = (page - 1) * limit;

    let query = supabase
      .from("analyze_jd_runs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (source) query = query.eq("source", source);
    if (status) query = query.eq("status", status);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ data: data || [], total: count ?? 0, page, limit });
  }

  // ── POST /api/analyze-jd — unified single JD analysis ──────────────────────
  if (path === "/analyze-jd" && req.method === "POST") {
    const { text, job_id, filename } = req.body || {};
    let jdText = text;

    // If no text but job_id provided, hydrate from jobs table
    if (!jdText && job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("description, title, company_name, location_raw, employment_type, seniority_level, functions, raw_data")
        .eq("id", job_id)
        .single();

      if (job?.description) {
        jdText = job.description;
      } else if (job) {
        const parts: string[] = [];
        if (job.title) parts.push(`Job Title: ${job.title}`);
        if (job.company_name) parts.push(`Company: ${job.company_name}`);
        if (job.location_raw) parts.push(`Location: ${job.location_raw}`);
        if (job.employment_type) parts.push(`Employment Type: ${job.employment_type}`);
        if (job.seniority_level) parts.push(`Seniority: ${job.seniority_level}`);
        if (job.functions?.length) parts.push(`Functions: ${job.functions.join(", ")}`);
        const rd = job.raw_data as Record<string, any> | null;
        if (rd?.description) parts.push(`Description: ${rd.description}`);
        if (rd?.descriptionHtml) {
          const plain = rd.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (plain.length > 50) parts.push(`Description: ${plain}`);
        }
        if (rd?.requirements) parts.push(`Requirements: ${rd.requirements}`);
        if (rd?.qualifications) parts.push(`Qualifications: ${rd.qualifications}`);
        if (parts.length > 2) jdText = parts.join("\n");
      }
    }

    if (!jdText) {
      return res.status(400).json({
        error: job_id
          ? "This job has no description data. Please paste the JD text manually instead."
          : "Provide \'text\' or \'job_id\'",
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
    }

    // Editor permission required when saving back to a job
    if (job_id) {
      if (!requireEditor(auth, "jobs", res)) return;
    }

    // Determine the calling user
    const callingUserId = auth?.userId ?? undefined;

    // Route through unified pipeline
    const result = await runAnalyzeJd({
      text: jdText,
      filename: filename ?? undefined,
      job_id: job_id ?? undefined,
      source: "manual_single",
      created_by: callingUserId,
    });

    if (result.status === "failed") {
      return res.status(500).json({ error: result.error || "AI analysis failed" });
    }

    // Shape skills array to match legacy frontend contract
    const legacySkills = result.skills.map(s => ({
      name: s.name,
      category: s.category,
      skill_tier: s.skill_tier,
      required: s.required,
      taxonomy_match: s.taxonomy_match,
      is_new: s.is_new,
    }));

    return res.json({
      // ── Legacy flat fields (preserved for existing frontend) ──
      bucket: result.bucket,
      job_function: result.job_function,
      job_function_name: result.job_function_name,
      job_family: result.job_family,
      job_family_name: result.job_family_name,
      job_industry: result.job_industry,
      job_industry_name: result.job_industry_name,
      seniority: result.seniority,
      company_type: result.company_type,
      geography: result.geography,
      sub_role: result.sub_role,
      standardized_title: result.standardized_title,
      company_name: result.company_name,
      experience_min: result.experience_min,
      experience_max: result.experience_max,
      min_education: result.min_education,
      preferred_fields: result.preferred_fields,
      jd_quality: result.jd_quality,
      classification_confidence: result.classification_confidence,
      ctc_min: result.ctc_min,
      ctc_max: result.ctc_max,
      skills: legacySkills,
      total: result.total,
      saved: result.saved,
      // ── New structured payload ──
      classification: result.classification,
      bucket_mapping: result.bucket_mapping,
      // ── Instrumentation ──
      run_id: result.run_id,
      was_partial: result.was_partial,
    });
  }

  // ── Extract text from uploaded file (PDF, DOCX, TXT) ────────────────────────
  if (path === "/taxonomy/extract-text" && req.method === "POST") {
    if (!requireReader(auth, "jobs", res)) return;

    // Parse multipart manually using raw body
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    const boundary = contentType.split("boundary=")[1]?.trim();
    if (!boundary) return res.status(400).json({ error: "No boundary in content-type" });

    const rawBody: Buffer = await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    // Extract file from multipart body
    const boundaryBuf = Buffer.from("--" + boundary);
    const parts = rawBody.toString("binary").split("--" + boundary);
    let fileBuffer: Buffer | null = null;
    let filename = "upload";
    let ext = ".txt";

    for (const part of parts) {
      if (part.includes("Content-Disposition") && part.includes("filename=")) {
        const nameMatch = part.match(/filename="([^"]+)"/);
        if (nameMatch) {
          filename = nameMatch[1];
          ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
        }
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const filePart = part.substring(headerEnd + 4).replace(/\r\n$/, "");
          fileBuffer = Buffer.from(filePart, "binary");
        }
        break;
      }
    }

    if (!fileBuffer) return res.status(400).json({ error: "No file found in upload" });

    const allowed = [".txt", ".pdf", ".docx", ".doc"];
    if (!allowed.includes(ext)) return res.status(400).json({ error: `Unsupported type: ${ext}. Use PDF, DOCX, or TXT.` });

    try {
      let text = "";

      if (ext === ".txt") {
        text = fileBuffer.toString("utf-8");
      } else if (ext === ".pdf") {
        // Dynamic import to avoid build issues
        const pdfParse = (await import("pdf-parse")).default;
        const result = await pdfParse(fileBuffer);
        text = result.text;
      } else if (ext === ".docx" || ext === ".doc") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        text = result.value;
      }

      text = text.replace(/\s+/g, " ").trim();
      const word_count = text.split(/\s+/).filter(Boolean).length;

      return res.json({ text, filename, word_count });
    } catch (err: any) {
      return res.status(500).json({ error: `Extraction failed: ${err.message}` });
    }
  }


  // Salary lookup removed — RapidAPI/JSearch deprecated. Apify-only.



  return undefined;
}
