import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const APIFY_API_KEY = process.env.APIFY_API_KEY || "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set");
}
export const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
export const CRON_SECRET = process.env.CRON_SECRET || "";
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
