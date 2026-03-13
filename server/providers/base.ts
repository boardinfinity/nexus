export interface ProviderResult {
  success: boolean;
  data?: unknown[];
  error?: string;
  credits_used: number;
  response_time_ms: number;
}

export interface Provider {
  name: string;
  execute(config: Record<string, unknown>): Promise<ProviderResult>;
}
