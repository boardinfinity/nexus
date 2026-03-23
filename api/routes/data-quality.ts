import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleDataQualityRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (path === "/data-quality/stats" && req.method === "GET") {
    // Quality score distribution and duplicate stats
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("quality_score, is_duplicate");
    if (error) return res.status(500).json({ error: error.message });

    const allJobs = jobs || [];
    const totalJobs = allJobs.length;
    const duplicates = allJobs.filter((j: any) => j.is_duplicate).length;
    const uniqueJobs = totalJobs - duplicates;
    const scores = allJobs.map((j: any) => j.quality_score || 0);
    const avgScore = totalJobs > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / totalJobs) : 0;

    // Distribution buckets
    const distribution = [
      { range: "0-20", count: 0 },
      { range: "21-40", count: 0 },
      { range: "41-60", count: 0 },
      { range: "61-80", count: 0 },
      { range: "81-100", count: 0 },
    ];
    for (const s of scores) {
      if (s <= 20) distribution[0].count++;
      else if (s <= 40) distribution[1].count++;
      else if (s <= 60) distribution[2].count++;
      else if (s <= 80) distribution[3].count++;
      else distribution[4].count++;
    }

    return res.json({
      total_jobs: totalJobs,
      duplicates,
      unique_jobs: uniqueJobs,
      avg_quality_score: avgScore,
      distribution,
    });
  }

  if (path === "/data-quality/duplicates" && req.method === "GET") {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Get duplicate groups via RPC
    const { data: groups, error } = await supabase.rpc("find_duplicate_groups");
    if (error) return res.status(500).json({ error: error.message });

    const allGroups = groups || [];
    const total = allGroups.length;
    const paged = allGroups.slice(offset, offset + limitNum);

    // Fetch job details for the paged groups
    const allJobIds: string[] = [];
    for (const g of paged) {
      for (const id of g.job_ids) allJobIds.push(id);
    }

    let jobDetails: Record<string, any> = {};
    if (allJobIds.length > 0) {
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("id, title, company_name, location_city, source, quality_score, is_duplicate, duplicate_of")
        .in("id", allJobIds);
      for (const j of jobsData || []) {
        jobDetails[j.id] = j;
      }
    }

    const enrichedGroups = paged.map((g: any) => ({
      dedup_key: g.dedup_key,
      jobs: g.job_ids.map((id: string) => jobDetails[id] || { id }),
    }));

    return res.json({ data: enrichedGroups, total, page: pageNum, limit: limitNum });
  }
}
