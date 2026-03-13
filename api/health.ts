import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      supabaseReady: !!supabase
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
