import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file if environment variables not already set
if (!process.env.SUPABASE_URL) {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env file not found, rely on environment variables
  }
}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
