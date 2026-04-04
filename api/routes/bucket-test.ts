import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, OPENAI_API_KEY } from "../lib/supabase";
import { type AuthResult, requireSuperAdmin } from "../lib/auth";

const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert job market analyst specializing in Indian MBA/graduate placement intelligence. Classify each job description into structured buckets.

For each job, return a JSON object with:

{
  "job_id": "the ID from input",

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
  "industry": "IND-XX",
  "industry_name": "Name",

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
  // Examples: "Full Stack Development", "FP&A", "Talent Acquisition", "Performance Marketing", "Supply Chain Planning"
  "sub_role": "specific area within the function",

  // CTC RANGE (ONLY if explicitly stated in the JD — numbers/ranges mentioned)
  // If JD says "10-15 LPA" or "CTC: 8,00,000 - 12,00,000" extract it. If not stated, return null.
  "ctc_min": null,
  "ctc_max": null,
  "ctc_currency": "INR",

  // EXPERIENCE RANGE (from JD)
  "experience_min_years": 3,
  "experience_max_years": 7,

  // EDUCATION REQUIREMENT
  "min_education": "bachelor" | "master" | "phd" | "any",
  "preferred_fields": ["Computer Science", "Statistics"],

  // BUCKET LABEL — clean human-readable label
  // Format: "{Seniority-Level} {Standardized Title} | {Industry Name} | {Company Type} | {Geography}"
  // Seniority-Level mapping: L0→"Intern" L1→"Entry-Level" L2→"Mid-Level" L3→"Senior" L4→"Director" L5→"Executive"
  // Example: "Senior Data Engineer | IT & Software | Startup | Bangalore"
  // Example: "Entry-Level HR Executive | FMCG & Consumer Goods | MNC | Mumbai"
  // DO NOT repeat the seniority word (no "Senior Senior...")
  "bucket_label": "The bucket",

  // SKILLS (top 15, with categories)
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
- ONLY use IND-15: Others if there are absolutely NO industry signals in the JD or company name

COMPANY TYPE DETECTION (use these signals):
- "Series A/B/C", "funded by", "VC-backed", "early stage", "pre-revenue", employee count < 500 mentioned → Startup
- "Fortune 500", "global operations", "offices in 20+ countries", well-known MNC names (Google, Microsoft, Accenture, Deloitte, Unilever, P&G, Amazon, etc.) → MNC
- "PSU", "government", "public sector undertaking", "Bharat", NTPC/BHEL/ONGC/SAIL → Government-PSU
- "consulting", "advisory", Big 4 names, MBB names → Consulting Firm
- Default for Indian companies without other signals → Indian Enterprise

CRITICAL RULES:
- Use ONLY the codes provided. Do not invent new codes.
- If a JD is too vague to classify, set classification_confidence to "low"
- For skills, use the 10 categories: technology, tool, skill, knowledge, competency, certification, domain, methodology, language, ability
- Cap skills at 15 most important per JD
- Return null for any field you genuinely cannot determine`;

async function callGPTForBuckets(systemPrompt: string, userPrompt: string): Promise<string> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_completion_tokens: 8192,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown error");
        throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "{}";
    } catch (err: any) {
      console.error(`callGPTForBuckets attempt ${attempt + 1} failed:`, err.message);
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("callGPTForBuckets: all retries failed");
}

export async function handleBucketTestRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  // POST /admin/bucket-test
  if (path.match(/^\/admin\/bucket-test\/?$/) && req.method === "POST") {
    if (!requireSuperAdmin(auth, res)) return;

    const limit = Math.min(parseInt(req.body?.limit) || 50, 500);
    const offset = parseInt(req.body?.offset) || 0;

    // Fetch jobs with descriptions from the database
    const { data: jobs, error: fetchErr } = await supabase.rpc("get_bucket_test_jobs", {
      p_limit: limit,
      p_offset: offset,
    });

    // Fallback to direct query if RPC doesn't exist
    let jobRows = jobs;
    if (fetchErr) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, company_name, description, location_raw, location_country, source")
        .not("description", "is", null)
        .gt("description", "")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return res.status(500).json({ error: error.message });
      // Filter for description length > 200 client-side since supabase doesn't support length filter
      jobRows = (data || []).filter((j: any) => j.description && j.description.length > 200);
    }

    if (!jobRows || jobRows.length === 0) {
      return res.json({ processed: 0, failed: 0, sample_results: [], message: "No jobs found matching criteria" });
    }

    // Truncate descriptions to 2500 chars for the API call
    const truncatedJobs = jobRows.map((j: any) => ({
      id: j.id,
      title: j.title,
      company_name: j.company_name,
      description: (j.description || "").substring(0, 2500),
      location_raw: j.location_raw,
      location_country: j.location_country,
      source: j.source,
    }));

    let processed = 0;
    let failed = 0;
    const allResults: any[] = [];

    // Process in batches of 3
    for (let i = 0; i < truncatedJobs.length; i += 3) {
      const batch = truncatedJobs.slice(i, i + 3);
      const userPrompt = `Classify the following ${batch.length} job description(s). Return a JSON object with a "results" key containing an array of classification objects, one per job.

${batch
  .map(
    (j: any, idx: number) => `--- JOB ${idx + 1} ---
ID: ${j.id}
Title: ${j.title}
Company: ${j.company_name || "Unknown"}
Location: ${j.location_raw || j.location_country || "Unknown"}
Source: ${j.source || "Unknown"}
Description:
${j.description}
--- END JOB ${idx + 1} ---`
  )
  .join("\n\n")}`;

      try {
        const raw = await callGPTForBuckets(CLASSIFICATION_SYSTEM_PROMPT, userPrompt);
        const parsed = JSON.parse(raw);
        const results = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [parsed];

        for (const result of results) {
          try {
            const { error: insertErr } = await supabase.from("jd_bucket_test").insert({
              job_id: result.job_id || null,
              job_function: result.job_function || null,
              job_family: result.job_family || null,
              industry: result.industry || null,
              seniority: result.seniority || null,
              company_type: result.company_type || null,
              geography: result.geography || null,
              standardized_title: result.standardized_title || null,
              bucket_label: result.bucket_label || null,
              skills: result.skills || null,
              jd_quality: result.jd_quality || null,
              classification_confidence: result.classification_confidence || null,
              sub_role: result.sub_role || null,
              ctc_min: result.ctc_min ?? null,
              ctc_max: result.ctc_max ?? null,
              ctc_currency: result.ctc_currency || null,
              experience_min_years: result.experience_min_years ?? null,
              experience_max_years: result.experience_max_years ?? null,
              min_education: result.min_education || null,
              preferred_fields: result.preferred_fields || null,
              prompt_version: "v2",
              raw_response: result,
            });

            if (insertErr) {
              console.error("Bucket test insert error:", insertErr.message);
              failed++;
            } else {
              processed++;
              allResults.push(result);
            }
          } catch (insertErr: any) {
            console.error("Bucket test insert exception:", insertErr.message);
            failed++;
          }
        }
      } catch (err: any) {
        console.error(`Bucket test batch ${i / 3 + 1} failed:`, err.message);
        failed += batch.length;
      }
    }

    return res.json({
      processed,
      failed,
      total_input: truncatedJobs.length,
      sample_results: allResults.slice(0, 5),
    });
  }

  return undefined;
}
