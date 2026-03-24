import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthResult } from "../lib/auth";
import { supabase } from "../lib/supabase";

export async function handleDataQualityRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (path === "/data-quality/stats" && req.method === "GET") {
    // Use RPCs and aggregation queries instead of fetching all rows
    const [distResult, countResult] = await Promise.all([
      supabase.rpc("get_quality_score_distribution"),
      supabase.from("jobs").select("id", { count: "exact", head: true }),
    ]);

    if (distResult.error) return res.status(500).json({ error: distResult.error.message });

    const totalJobs = countResult.count || 0;

    // Get duplicate count via a filtered count query
    const { count: duplicates } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("is_duplicate", true);

    const uniqueJobs = totalJobs - (duplicates || 0);

    // Map RPC buckets to distribution format
    const bucketMap: Record<string, number> = {};
    for (const row of distResult.data || []) {
      bucketMap[row.bucket] = Number(row.count);
    }
    const distribution = [
      { range: "0-20", count: bucketMap["0-20"] || 0 },
      { range: "21-40", count: bucketMap["21-40"] || 0 },
      { range: "41-60", count: bucketMap["41-60"] || 0 },
      { range: "61-80", count: bucketMap["61-80"] || 0 },
      { range: "81-100", count: bucketMap["81-100"] || 0 },
    ];

    // Compute average from distribution
    const bucketMidpoints: Record<string, number> = { "0-20": 10, "21-40": 30, "41-60": 50, "61-80": 70, "81-100": 90 };
    let weightedSum = 0;
    for (const d of distribution) {
      weightedSum += d.count * (bucketMidpoints[d.range] || 0);
    }
    const avgScore = totalJobs > 0 ? Math.round(weightedSum / totalJobs) : 0;

    return res.json({
      total_jobs: totalJobs,
      duplicates: duplicates || 0,
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
