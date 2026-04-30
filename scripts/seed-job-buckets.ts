/**
 * Seed canonical job buckets from the JSON templates in `data/`.
 *
 * Usage:
 *   npx tsx scripts/seed-job-buckets.ts                 # all templates
 *   npx tsx scripts/seed-job-buckets.ts data/job_buckets_seed_tier2_mba.json
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY env vars.
 *
 * Behavior:
 *   - Inserts buckets with status='candidate' (governed approval flow).
 *   - Idempotent: ON CONFLICT (bucket_code) DO NOTHING + alias upsert by (bucket_id, alias_norm).
 *   - Does NOT auto-validate. Run admin promotion separately when ready.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DEFAULT_FILES = [
  "data/job_buckets_seed_tier2_mba.json",
  "data/job_buckets_seed_tier1_mba.json",
  "data/job_buckets_seed_uae_gcc.json",
];

function normalizeAlias(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

interface SeedBucket {
  bucket_code: string;
  name: string;
  description?: string;
  function_id?: string | null;
  family_id?: string | null;
  industry_id?: string | null;
  seniority_level?: string | null;
  standardized_title?: string | null;
  company_type?: string | null;
  geography_scope?: string | null;
  nature_of_work?: string | null;
  exclusion_rules?: string[];
  aliases?: string[];
  evidence_companies?: string[];
}

interface SeedFile {
  scope?: string;
  source?: string;
  buckets: Array<SeedBucket | { _TODO: string }>;
}

async function seedFile(path: string): Promise<{ inserted: number; skipped: number; aliases: number }> {
  const content = JSON.parse(readFileSync(resolve(path), "utf-8")) as SeedFile;
  const scope = content.scope || "cross_program";
  const source = content.source || path;
  let inserted = 0;
  let skipped = 0;
  let aliasesInserted = 0;

  for (const item of content.buckets) {
    if ("_TODO" in item) continue;
    const b = item as SeedBucket;
    if (!b.bucket_code) {
      console.warn(`[seed] skipping bucket without bucket_code in ${path}`);
      continue;
    }

    // Upsert bucket
    const { data: existing } = await supabase
      .from("job_buckets")
      .select("id")
      .eq("bucket_code", b.bucket_code)
      .maybeSingle();

    let bucketId: string | null = existing?.id ?? null;

    if (!existing) {
      const { data: ins, error } = await supabase
        .from("job_buckets")
        .insert({
          bucket_code: b.bucket_code,
          name: b.name,
          description: b.description ?? null,
          bucket_scope: scope,
          function_id: b.function_id ?? null,
          family_id: b.family_id ?? null,
          industry_id: b.industry_id ?? null,
          seniority_level: b.seniority_level ?? null,
          standardized_title: b.standardized_title ?? null,
          company_type: b.company_type ?? null,
          geography_scope: b.geography_scope ?? null,
          nature_of_work: b.nature_of_work ?? null,
          exclusion_rules: b.exclusion_rules ?? [],
          status: "candidate",
          source,
          created_by: "seed:job_buckets",
        })
        .select("id")
        .single();

      if (error) {
        console.error(`[seed] insert failed for ${b.bucket_code}: ${error.message}`);
        continue;
      }
      bucketId = ins.id;
      inserted++;
    } else {
      skipped++;
    }

    // Aliases
    if (bucketId && b.aliases?.length) {
      const aliasRows = b.aliases.map(a => ({
        bucket_id: bucketId!,
        alias: a,
        alias_norm: normalizeAlias(a),
        source: "seed",
        confidence: 1.0,
      }));
      const { error: aliasErr, count } = await supabase
        .from("job_bucket_aliases")
        .upsert(aliasRows, { onConflict: "bucket_id,alias_norm", count: "exact", ignoreDuplicates: true });
      if (aliasErr) console.error(`[seed] alias upsert error for ${b.bucket_code}: ${aliasErr.message}`);
      else aliasesInserted += count ?? aliasRows.length;
    }
  }

  return { inserted, skipped, aliases: aliasesInserted };
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : DEFAULT_FILES;
  let total = { inserted: 0, skipped: 0, aliases: 0 };
  for (const f of files) {
    console.log(`\n[seed] ${f}`);
    try {
      const r = await seedFile(f);
      console.log(`[seed]   inserted=${r.inserted} skipped(existing)=${r.skipped} aliases=${r.aliases}`);
      total.inserted += r.inserted;
      total.skipped += r.skipped;
      total.aliases += r.aliases;
    } catch (e: any) {
      console.error(`[seed] failed: ${e.message}`);
    }
  }
  console.log(`\n[seed] TOTAL inserted=${total.inserted} skipped=${total.skipped} aliases=${total.aliases}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
