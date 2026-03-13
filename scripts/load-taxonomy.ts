import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jlgstbucwawuntatrgvy.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_KEY is required. Set it in .env or environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DATA_DIR = path.resolve(__dirname, "../data");

function parseTSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] || "").trim();
    });
    return row;
  });
}

async function loadContentModel(): Promise<Map<string, { name: string; description: string }>> {
  const rows = parseTSV(path.join(DATA_DIR, "onet_content_model.txt"));
  const map = new Map<string, { name: string; description: string }>();
  for (const row of rows) {
    map.set(row["Element ID"], {
      name: row["Element Name"],
      description: row["Description"],
    });
  }
  return map;
}

async function loadSkillsKnowledgeAbilities(contentModel: Map<string, { name: string; description: string }>) {
  const files: Array<{ file: string; category: string; prefix: string }> = [
    { file: "onet_skills.txt", category: "skill", prefix: "2.A" },
    { file: "onet_knowledge.txt", category: "knowledge", prefix: "2.C" },
    { file: "onet_abilities.txt", category: "ability", prefix: "1.A" },
  ];

  const allRecords: Array<{
    external_id: string;
    name: string;
    category: string;
    subcategory: string | null;
    description: string | null;
    source: string;
    is_hot_technology: boolean;
    is_in_demand: boolean;
    aliases: string[];
  }> = [];

  const seen = new Set<string>();

  for (const { file, category } of files) {
    const rows = parseTSV(path.join(DATA_DIR, file));
    for (const row of rows) {
      const elementId = row["Element ID"];
      if (seen.has(elementId)) continue;
      seen.add(elementId);

      const cm = contentModel.get(elementId);
      // Derive subcategory from parent element in content model
      const parentId = elementId.split(".").slice(0, -1).join(".");
      const parentCm = contentModel.get(parentId);

      allRecords.push({
        external_id: elementId,
        name: row["Element Name"] || cm?.name || elementId,
        category,
        subcategory: parentCm?.name || null,
        description: cm?.description || null,
        source: "onet",
        is_hot_technology: false,
        is_in_demand: false,
        aliases: [],
      });
    }
  }

  console.log(`Upserting ${allRecords.length} skills/knowledge/abilities...`);

  // Batch upsert in chunks of 100
  for (let i = 0; i < allRecords.length; i += 100) {
    const batch = allRecords.slice(i, i + 100);
    const { error } = await supabase
      .from("taxonomy_skills")
      .upsert(batch, { onConflict: "external_id,source" });
    if (error) {
      console.error(`Error upserting batch at ${i}:`, error.message);
    } else {
      console.log(`  Upserted ${Math.min(i + 100, allRecords.length)}/${allRecords.length}`);
    }
  }

  return allRecords.length;
}

async function loadTechSkills() {
  const rows = parseTSV(path.join(DATA_DIR, "onet_tech_skills.txt"));

  // Deduplicate by Example name (case-insensitive)
  const techMap = new Map<string, {
    name: string;
    subcategory: string;
    isHot: boolean;
    isInDemand: boolean;
  }>();

  for (const row of rows) {
    const name = row["Example"];
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = techMap.get(key);
    const isHot = row["Hot Technology"] === "Y";
    const isInDemand = row["In Demand"] === "Y";

    if (!existing) {
      techMap.set(key, {
        name,
        subcategory: row["Commodity Title"] || "",
        isHot,
        isInDemand,
      });
    } else {
      // Merge: keep hot/in-demand if any row has it
      if (isHot) existing.isHot = true;
      if (isInDemand) existing.isInDemand = true;
    }
  }

  const records = Array.from(techMap.entries()).map(([key, val]) => ({
    external_id: `tech_${key.replace(/[^a-z0-9]/g, "_")}`,
    name: val.name,
    category: "technology",
    subcategory: val.subcategory || null,
    description: null,
    source: "onet",
    is_hot_technology: val.isHot,
    is_in_demand: val.isInDemand,
    aliases: [] as string[],
  }));

  console.log(`Upserting ${records.length} technology skills...`);

  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const { error } = await supabase
      .from("taxonomy_skills")
      .upsert(batch, { onConflict: "external_id,source" });
    if (error) {
      console.error(`Error upserting tech batch at ${i}:`, error.message);
    } else {
      console.log(`  Upserted ${Math.min(i + 100, records.length)}/${records.length}`);
    }
  }

  return records.length;
}

async function main() {
  console.log("Loading O*NET taxonomy data...");
  console.log(`Data directory: ${DATA_DIR}`);

  // Verify data files exist
  const requiredFiles = ["onet_content_model.txt", "onet_skills.txt", "onet_knowledge.txt", "onet_abilities.txt", "onet_tech_skills.txt"];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(DATA_DIR, f))) {
      console.error(`Missing data file: ${f}`);
      process.exit(1);
    }
  }

  const contentModel = await loadContentModel();
  console.log(`Loaded ${contentModel.size} content model entries`);

  const skaCount = await loadSkillsKnowledgeAbilities(contentModel);
  const techCount = await loadTechSkills();

  console.log(`\nDone! Loaded ${skaCount} skills/knowledge/abilities + ${techCount} technologies = ${skaCount + techCount} total taxonomy entries.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
