import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleAnalyticsRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
    // ==================== ANALYTICS ====================

    if (path === "/analytics/overview" && req.method === "GET") {
      const { date_from, date_to, source, country, status } = req.query as Record<string, string>;

      let jobsQuery = supabase.from("jobs").select("*", { count: "exact", head: true });
      let jobsWithDescQuery = supabase.from("jobs").select("*", { count: "exact", head: true }).not("description", "is", null);
      let jobsAnalyzedQuery = supabase.from("jobs").select("*", { count: "exact", head: true }).eq("enrichment_status", "complete");
      let companiesQuery = supabase.from("companies").select("*", { count: "exact", head: true });
      let peopleQuery = supabase.from("people").select("*", { count: "exact", head: true });
      let alumniQuery = supabase.from("alumni").select("*", { count: "exact", head: true });
      let skillsQuery = supabase.from("job_skills").select("skill_name");
      let jobsPeriodQuery = supabase.from("jobs").select("*", { count: "exact", head: true });

      // Apply filters to all job-related queries
      const applyJobFilters = (q: any) => {
        if (source) q = q.eq("source", source);
        if (country) q = q.eq("location_country", country);
        if (status) q = q.eq("enrichment_status", status);
        if (date_from) q = q.gte("created_at", date_from);
        if (date_to) q = q.lte("created_at", date_to);
        return q;
      };

      jobsQuery = applyJobFilters(jobsQuery);
      jobsWithDescQuery = applyJobFilters(jobsWithDescQuery);
      jobsAnalyzedQuery = applyJobFilters(jobsAnalyzedQuery);
      jobsPeriodQuery = applyJobFilters(jobsPeriodQuery);

      const [
        totalJobsRes,
        jobsWithDescRes,
        jobsAnalyzedRes,
        companiesRes,
        peopleRes,
        alumniRes,
        skillsRes,
        jobsPeriodRes,
      ] = await Promise.all([
        jobsQuery,
        jobsWithDescQuery,
        jobsAnalyzedQuery,
        companiesQuery,
        peopleQuery,
        alumniQuery,
        skillsQuery,
        jobsPeriodQuery,
      ]);

      const totalJobs = totalJobsRes.count || 0;
      const jobsWithDesc = jobsWithDescRes.count || 0;
      const jobsAnalyzed = jobsAnalyzedRes.count || 0;
      const uniqueSkills = new Set((skillsRes.data || []).map((s: any) => s.skill_name)).size;

      return res.json({
        total_jobs: totalJobs,
        jobs_with_descriptions: jobsWithDesc,
        jobs_analyzed: jobsAnalyzed,
        jd_coverage_pct: totalJobs > 0 ? Math.round((jobsWithDesc / totalJobs) * 1000) / 10 : 0,
        skills_extracted: uniqueSkills,
        total_companies: companiesRes.count || 0,
        total_people: peopleRes.count || 0,
        total_alumni: alumniRes.count || 0,
        jobs_period: jobsPeriodRes.count || 0,
        enrichment_complete_pct: totalJobs > 0 ? Math.round((jobsAnalyzed / totalJobs) * 1000) / 10 : 0,
        training_data_ready: jobsAnalyzed,
      });
    }

    if (path === "/analytics/jobs-by-source" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_by_source', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/jobs-by-region" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_by_region', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/jobs-by-role" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_by_role', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/top-skills" && req.method === "GET") {
      const { limit: limitStr, source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const limit = parseInt(limitStr || "20");
      const { data, error } = await supabase.rpc('get_top_skills', {
        p_limit: limit,
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      // Map 'skill' key to 'skill_name' to match frontend expectations
      const result = (data || []).map((row: any) => ({ skill_name: row.skill, count: row.count }));
      return res.json(result);
    }

    if (path === "/analytics/recent-skills" && req.method === "GET") {
      const days = parseInt((req.query as Record<string, string>).days || "30");
      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data: jobs, error: jobsErr } = await supabase
        .from("jobs")
        .select("id")
        .gte("created_at", since.toISOString());
      if (jobsErr) return res.status(500).json({ error: jobsErr.message });

      const jobIds = (jobs || []).map((j: any) => j.id);
      if (jobIds.length === 0) return res.json([]);

      const { data: skills, error: skillsErr } = await supabase
        .from("job_skills")
        .select("skill_name")
        .in("job_id", jobIds);
      if (skillsErr) return res.status(500).json({ error: skillsErr.message });

      const counts: Record<string, number> = {};
      for (const row of skills || []) {
        const name = row.skill_name || "Unknown";
        counts[name] = (counts[name] || 0) + 1;
      }
      const result = Object.entries(counts)
        .map(([skill_name, count]) => ({ skill_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      return res.json(result);
    }

    if (path === "/analytics/enrichment-funnel" && req.method === "GET") {
      const { source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_enrichment_funnel', {
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/timeline" && req.method === "GET") {
      const { granularity = "day", days = "30", source, country, status, date_from, date_to } = req.query as Record<string, string>;
      const { data, error } = await supabase.rpc('get_jobs_timeline', {
        p_days: parseInt(days),
        p_granularity: granularity,
        p_source: source || null,
        p_country: country || null,
        p_status: status || null,
        p_date_from: date_from || null,
        p_date_to: date_to || null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (path === "/analytics/pipeline-health" && req.method === "GET") {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("pipeline_runs")
        .select("pipeline_type, status")
        .gte("created_at", since.toISOString());
      if (error) return res.status(500).json({ error: error.message });

      const grouped: Record<string, Record<string, number>> = {};
      for (const row of data || []) {
        const ptype = row.pipeline_type || "unknown";
        if (!grouped[ptype]) grouped[ptype] = {};
        const st = row.status || "unknown";
        grouped[ptype][st] = (grouped[ptype][st] || 0) + 1;
      }
      const result = Object.entries(grouped).map(([pipeline_type, statuses]) => ({
        pipeline_type,
        ...statuses,
      }));

      return res.json(result);
    }

    if (path === "/analytics/jobs-table" && req.method === "GET") {
      const {
        page = "1", limit = "50", search, source, status, country, sort = "created_at", order = "desc",
      } = req.query as Record<string, string>;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      let query = supabase
        .from("jobs")
        .select("id, title, company_name, location_country, location_city, source, enrichment_status, created_at, posted_at", { count: "exact" });

      if (search) {
        query = query.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`);
      }
      if (source) query = query.eq("source", source);
      if (status) query = query.eq("enrichment_status", status);
      if (country) query = query.eq("location_country", country);

      const ascending = order === "asc";
      query = query.order(sort, { ascending }).range(offset, offset + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Get skill counts for these jobs
      const jobIds = (data || []).map((j: any) => j.id);
      let skillCounts: Record<string, number> = {};
      if (jobIds.length > 0) {
        const { data: skills } = await supabase
          .from("job_skills")
          .select("job_id")
          .in("job_id", jobIds);
        for (const s of skills || []) {
          skillCounts[s.job_id] = (skillCounts[s.job_id] || 0) + 1;
        }
      }

      const enriched = (data || []).map((j: any) => ({
        ...j,
        skills_count: skillCounts[j.id] || 0,
      }));

      return res.json({ data: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
    }

    if (path === "/analytics/skill-cooccurrence" && req.method === "GET") {
      const { skill_name, limit: limitStr = "20" } = req.query as Record<string, string>;
      const limit = parseInt(limitStr);

      if (skill_name) {
        // Top co-occurring skills for a given skill
        const { data, error } = await supabase
          .from("skill_cooccurrence")
          .select("*")
          .or(`skill_a_name.eq.${skill_name},skill_b_name.eq.${skill_name}`)
          .order("cooccurrence_count", { ascending: false })
          .limit(limit);
        if (error) return res.status(500).json({ error: error.message });

        // Normalize: return the "other" skill name
        const result = (data || []).map((row: any) => ({
          skill_name: row.skill_a_name === skill_name ? row.skill_b_name : row.skill_a_name,
          cooccurrence_count: row.cooccurrence_count,
          pmi_score: row.pmi_score ? Math.round(row.pmi_score * 100) / 100 : null,
          jobs_with_skill: row.skill_a_name === skill_name ? row.jobs_with_b : row.jobs_with_a,
        }));

        return res.json(result);
      } else {
        // Top overall pairs
        const { data, error } = await supabase
          .from("skill_cooccurrence")
          .select("*")
          .order("cooccurrence_count", { ascending: false })
          .limit(limit);
        if (error) return res.status(500).json({ error: error.message });

        return res.json((data || []).map((row: any) => ({
          skill_a: row.skill_a_name,
          skill_b: row.skill_b_name,
          cooccurrence_count: row.cooccurrence_count,
          pmi_score: row.pmi_score ? Math.round(row.pmi_score * 100) / 100 : null,
        })));
      }
    }

    // ==================== EXPORT ENDPOINTS ====================

    if (path === "/export/jobs" && req.method === "GET") {
      const { source, country, enrichment_status, has_description, limit: limitStr } = req.query as Record<string, string>;
      const exportLimit = parseInt(limitStr || "10000");

      let query = supabase
        .from("jobs")
        .select("id, title, company_name, location_city, location_country, source, posted_at, seniority_level, employment_type, work_mode, description, enrichment_status, quality_score, salary_min, salary_max, industry_domain")
        .order("created_at", { ascending: false })
        .limit(exportLimit);

      if (source) query = query.eq("source", source);
      if (country) query = query.eq("location_country", country);
      if (enrichment_status) query = query.eq("enrichment_status", enrichment_status);
      if (has_description === "true") query = query.not("description", "is", null);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const rows = data || [];
      const headers = ["id", "title", "company_name", "location_city", "location_country", "source", "posted_at", "seniority_level", "employment_type", "work_mode", "description", "enrichment_status", "quality_score", "salary_min", "salary_max", "industry_domain"];

      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        const values = headers.map((h) => {
          let val = (row as any)[h];
          if (h === "description" && val) val = val.substring(0, 1000);
          return escapeCsv(val);
        });
        csv += values.join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="nexus_jobs_export_${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    }

    if (path === "/export/skills" && req.method === "GET") {
      const { min_frequency = "2" } = req.query as Record<string, string>;
      const minFreq = parseInt(min_frequency);

      // Get total jobs count
      const { count: totalJobs } = await supabase.from("jobs").select("*", { count: "exact", head: true });

      // Get all skills with counts
      const { data: skills, error } = await supabase
        .from("job_skills")
        .select("skill_name, taxonomy_skill_id, confidence_score");
      if (error) return res.status(500).json({ error: error.message });

      const skillMap: Record<string, { taxonomy_skill_id: string | null; count: number; totalConfidence: number }> = {};
      for (const s of skills || []) {
        const name = s.skill_name || "Unknown";
        if (!skillMap[name]) skillMap[name] = { taxonomy_skill_id: s.taxonomy_skill_id, count: 0, totalConfidence: 0 };
        skillMap[name].count++;
        skillMap[name].totalConfidence += s.confidence_score || 0;
      }

      const total = totalJobs || 1;
      const rows = Object.entries(skillMap)
        .filter(([_, v]) => v.count >= minFreq)
        .map(([name, v]) => ({
          skill_name: name,
          taxonomy_skill_id: v.taxonomy_skill_id || "",
          frequency: v.count,
          pct_of_total_jobs: Math.round((v.count / total) * 1000) / 10,
          avg_confidence: Math.round((v.totalConfidence / v.count) * 100) / 100,
        }))
        .sort((a, b) => b.frequency - a.frequency);

      const headers = ["skill_name", "taxonomy_skill_id", "frequency", "pct_of_total_jobs", "avg_confidence"];
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        csv += headers.map((h) => escapeCsv((row as any)[h])).join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="nexus_skills_export_${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    }

    return undefined;
}
