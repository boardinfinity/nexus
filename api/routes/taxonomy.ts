import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, OPENAI_API_KEY } from "../lib/supabase";
import type { AuthResult } from "../lib/auth";
import { extractSkillsWithAI } from "../lib/openai";

export async function handleTaxonomyRoutes(
  path: string,
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthResult
): Promise<VercelResponse | undefined> {
  if (path === "/taxonomy" && req.method === "GET") {
    const { category, source, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("taxonomy_skills")
      .select("*", { count: "exact" });

    if (category) query = query.eq("category", category);
    if (source) query = query.eq("source", source);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error, count } = await query
      .order("name")
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
    }

    return res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  }

  if (path === "/taxonomy/stats" && req.method === "GET") {
    // Category counts
    const { data: catData, error: catErr } = await supabase
      .from("taxonomy_skills")
      .select("category");
    if (catErr) return res.status(500).json({ error: catErr.message });

    const categoryCounts: Record<string, number> = {};
    for (const row of catData || []) {
      categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
    }

    // Hot technology count
    const { count: hotCount } = await supabase
      .from("taxonomy_skills")
      .select("id", { count: "exact", head: true })
      .eq("is_hot_technology", true);

    // Top skills by job count
    const { data: topSkills, error: topErr } = await supabase
      .from("job_skills")
      .select("skill_name, taxonomy_skill_id");
    if (topErr) return res.status(500).json({ error: topErr.message });

    const skillCounts: Record<string, number> = {};
    for (const row of topSkills || []) {
      skillCounts[row.skill_name] = (skillCounts[row.skill_name] || 0) + 1;
    }
    const topSkillsList = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, job_count: count }));

    return res.json({
      total: (catData || []).length,
      by_category: categoryCounts,
      hot_technologies: hotCount || 0,
      top_skills: topSkillsList,
    });
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

  if (path === "/analyze-jd" && req.method === "POST") {
    const { text, job_id } = req.body || {};
    let jdText = text;

    if (!jdText && job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("description, title, company_name, location_raw, employment_type, seniority_level, functions, raw_data")
        .eq("id", job_id)
        .single();

      if (job?.description) {
        jdText = job.description;
      } else if (job) {
        // Build a synthetic JD from available metadata + raw_data
        const parts: string[] = [];
        if (job.title) parts.push(`Job Title: ${job.title}`);
        if (job.company_name) parts.push(`Company: ${job.company_name}`);
        if (job.location_raw) parts.push(`Location: ${job.location_raw}`);
        if (job.employment_type) parts.push(`Employment Type: ${job.employment_type}`);
        if (job.seniority_level) parts.push(`Seniority: ${job.seniority_level}`);
        if (job.functions?.length) parts.push(`Functions: ${job.functions.join(", ")}`);
        // Check raw_data for any description-like fields
        const rd = job.raw_data as Record<string, any> | null;
        if (rd?.description) parts.push(`Description: ${rd.description}`);
        if (rd?.descriptionHtml) {
          // Strip HTML tags for plain text
          const plain = rd.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (plain.length > 50) parts.push(`Description: ${plain}`);
        }
        if (rd?.requirements) parts.push(`Requirements: ${rd.requirements}`);
        if (rd?.qualifications) parts.push(`Qualifications: ${rd.qualifications}`);

        if (parts.length > 2) {
          jdText = parts.join("\n");
        }
      }
    }

    if (!jdText) {
      return res.status(400).json({ error: job_id ? "This job has no description data. Please paste the JD text manually instead." : "Provide 'text' or 'job_id'" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
    }

    try {
      const extracted = await extractSkillsWithAI(jdText);

      // Try to match against taxonomy
      const matched = [];
      for (const skill of extracted) {
        const { data: match } = await supabase
          .from("taxonomy_skills")
          .select("id, name, category, subcategory")
          .ilike("name", `%${skill.name}%`)
          .limit(1)
          .single();

        matched.push({
          ...skill,
          taxonomy_match: match || null,
        });
      }

      return res.json({ skills: matched, total: matched.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "AI extraction failed" });
    }
  }

  return undefined;
}
