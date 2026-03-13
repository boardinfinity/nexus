// Waterfall enrichment engine - stub for future provider cascade logic
// This will attempt multiple providers in sequence until enrichment succeeds

export interface WaterfallConfig {
  entity_type: "company" | "person";
  entity_id: string;
  providers: string[];
}

export async function runWaterfallEnrichment(_config: WaterfallConfig): Promise<{
  success: boolean;
  provider_used?: string;
  data?: unknown;
  error?: string;
}> {
  // Stub: In production, this would iterate through providers
  // trying each one until data is found
  return {
    success: false,
    error: "Waterfall enrichment not yet implemented - providers Apollo, Proxycurl, Hunter.io pending integration",
  };
}
