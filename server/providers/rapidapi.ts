import type { ProviderResult } from "./base";

const JSEARCH_BASE = "https://jsearch.p.rapidapi.com/search";

export async function searchGoogleJobs(config: Record<string, unknown>): Promise<ProviderResult> {
  const startTime = Date.now();
  const apiKey = process.env.RAPIDAPI_KEY || "";

  try {
    const params = new URLSearchParams({
      query: (config.query as string) || "software engineer in India",
      page: String(config.page || 1),
      num_pages: String(config.num_pages || 1),
    });

    if (config.date_posted) {
      params.set("date_posted", config.date_posted as string);
    }
    if (config.employment_type) {
      params.set("employment_types", config.employment_type as string);
    }

    const res = await fetch(`${JSEARCH_BASE}?${params}`, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        error: `RapidAPI failed: ${res.status} ${errText}`,
        credits_used: 1,
        response_time_ms: Date.now() - startTime,
      };
    }

    const data = await res.json() as { data: unknown[] };
    const items = data.data || [];
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
