import type { ProviderResult } from "./base";
import { supabase } from "../supabase";

const APIFY_BASE = "https://api.apify.com/v2";

function getToken(): string {
  return process.env.APIFY_API_KEY || "";
}

/** Run a single Apify actor call with the given keywords string. Returns extracted job items. */
async function runSingleApifyCall(
  keywordsStr: string,
  config: Record<string, unknown>,
  token: string,
): Promise<{ items: unknown[]; error?: string }> {
  const runRes = await fetch(
    `${APIFY_BASE}/acts/practicaltools~linkedin-jobs/runs?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords: keywordsStr,
        location: config.location || "India",
        maxPages: Math.ceil(((config.limit as number) || 25) / 10),
        ...(config.date_posted === "past_24h" ? { timePosted: "r86400" } :
            config.date_posted === "past_week" ? { timePosted: "r604800" } :
            config.date_posted === "past_month" ? { timePosted: "r2592000" } : {}),
      }),
    }
  );

  if (!runRes.ok) {
    const errText = await runRes.text();
    return { items: [], error: `Apify start failed: ${runRes.status} ${errText}` };
  }

  const runData = await runRes.json() as { data: { id: string; defaultDatasetId: string; status: string } };
  const runId = runData.data.id;
  const datasetId = runData.data.defaultDatasetId;

  // Poll for completion (max 5 minutes)
  let status = runData.data.status;
  let pollCount = 0;
  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED" && pollCount < 60) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(
      `${APIFY_BASE}/acts/practicaltools~linkedin-jobs/runs/${runId}?token=${token}`
    );
    if (pollRes.ok) {
      const pollData = await pollRes.json() as { data: { status: string } };
      status = pollData.data.status;
    }
    pollCount++;
  }

  if (status !== "SUCCEEDED") {
    return { items: [], error: `Apify run ended with status: ${status}` };
  }

  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}`
  );

  if (!itemsRes.ok) {
    return { items: [], error: `Failed to fetch dataset items: ${itemsRes.status}` };
  }

  const rawItems = await itemsRes.json() as any[];
  const items: unknown[] = [];
  for (const item of rawItems) {
    if (Array.isArray(item.jobs)) {
      items.push(...item.jobs);
    } else {
      items.push(item);
    }
  }
  return { items };
}

export async function runLinkedInJobsScraper(config: Record<string, unknown>): Promise<ProviderResult> {
  const startTime = Date.now();
  const token = getToken();
  const jobRoleIds = config.job_role_ids as string[] | undefined;

  try {
    // If job role IDs are provided, run one Apify call per role using synonym expansion
    if (jobRoleIds && jobRoleIds.length > 0) {
      const { data: roles, error: dbError } = await supabase
        .from("job_roles")
        .select("id, name, synonyms")
        .in("id", jobRoleIds);

      if (dbError) throw new Error(`Failed to look up job roles: ${dbError.message}`);
      if (!roles || roles.length === 0) throw new Error("No matching job roles found");

      const allItems: unknown[] = [];
      const errors: string[] = [];

      for (const role of roles) {
        // Build OR query from synonyms: "synonym1" OR "synonym2" OR ...
        const synonymQuery = (role.synonyms as string[])
          .map((s: string) => `"${s}"`)
          .join(" OR ");

        const { items, error } = await runSingleApifyCall(synonymQuery, config, token);

        if (error) {
          errors.push(`${role.name}: ${error}`);
          continue;
        }

        // Tag each result with the job_role_id
        for (const item of items) {
          (item as Record<string, unknown>).job_role_id = role.id;
          (item as Record<string, unknown>).job_role_name = role.name;
        }
        allItems.push(...items);
      }

      // Also run keywords if provided alongside roles
      if (config.search_keywords) {
        const { items } = await runSingleApifyCall(config.search_keywords as string, config, token);
        allItems.push(...items);
      }

      return {
        success: allItems.length > 0 || errors.length === 0,
        data: allItems,
        error: errors.length > 0 ? errors.join("; ") : undefined,
        credits_used: allItems.length,
        response_time_ms: Date.now() - startTime,
      };
    }

    // Fallback: original behavior with keywords
    const keywordsStr = (config.search_keywords || config.keywords || "software engineer") as string;
    const { items, error } = await runSingleApifyCall(keywordsStr, config, token);

    if (error) {
      return {
        success: false,
        error,
        credits_used: 0,
        response_time_ms: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: items,
      credits_used: items.length,
      response_time_ms: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
      credits_used: 0,
      response_time_ms: Date.now() - startTime,
    };
  }
}
