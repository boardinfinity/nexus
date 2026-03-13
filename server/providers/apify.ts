import type { ProviderResult } from "./base";

const APIFY_BASE = "https://api.apify.com/v2";

function getToken(): string {
  return process.env.APIFY_API_KEY || "";
}

export async function runLinkedInJobsScraper(config: Record<string, unknown>): Promise<ProviderResult> {
  const startTime = Date.now();
  const token = getToken();

  try {
    // Start the actor run
    const runRes = await fetch(
      `${APIFY_BASE}/acts/practicaltools~linkedin-jobs/runs?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchKeywords: config.search_keywords || "software engineer",
          location: config.location || "India",
          dateSincePosted: config.date_posted || "past month",
          jobType: config.employment_type || "full-time",
          limit: config.limit || 25,
        }),
      }
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      return {
        success: false,
        error: `Apify start failed: ${runRes.status} ${errText}`,
        credits_used: 0,
        response_time_ms: Date.now() - startTime,
      };
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
      return {
        success: false,
        error: `Apify run ended with status: ${status}`,
        credits_used: 1,
        response_time_ms: Date.now() - startTime,
      };
    }

    // Fetch results
    const itemsRes = await fetch(
      `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}`
    );

    if (!itemsRes.ok) {
      return {
        success: false,
        error: `Failed to fetch dataset items: ${itemsRes.status}`,
        credits_used: 1,
        response_time_ms: Date.now() - startTime,
      };
    }

    const items = await itemsRes.json() as unknown[];
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
