#!/usr/bin/env node
/**
 * Apply pending SQL migrations to Supabase via the exec_sql RPC.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node scripts/apply-migrations.js
 *
 * Or with a .env file in the project root.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load .env if present
try {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (_) {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const MIGRATIONS = [
  "016_enum_to_text.sql",
  "017_scale_rpcs.sql",
  "018_college_list_rpc.sql",
];

async function applyMigration(filename) {
  const filePath = path.resolve(__dirname, "..", "migrations", filename);
  const sql = fs.readFileSync(filePath, "utf8");

  console.log(`\n--- Applying ${filename} ---`);

  // Try exec_sql RPC first (executes arbitrary SQL)
  const { data, error } = await supabase.rpc("exec_sql", { sql });

  if (error) {
    // If exec_sql doesn't exist or fails, try via REST API
    console.warn(`  exec_sql RPC failed: ${error.message}`);
    console.warn(`  Trying statement-by-statement via exec_sql...`);

    // Split into individual statements (rough split on semicolons not inside $$ blocks)
    const statements = splitStatements(sql);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;

      const { error: stmtErr } = await supabase.rpc("exec_sql", { sql: stmt });
      if (stmtErr) {
        // Some ALTER statements may fail if already applied (idempotent)
        console.warn(`  Statement ${i + 1} warning: ${stmtErr.message}`);
      } else {
        console.log(`  Statement ${i + 1} OK`);
      }
    }
  } else {
    console.log(`  SUCCESS: ${filename} applied`);
  }
}

function splitStatements(sql) {
  // Split on semicolons that are NOT inside $$ blocks
  const results = [];
  let current = "";
  let inDollarBlock = false;

  const lines = sql.split("\n");
  for (const line of lines) {
    // Track $$ blocks
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + "\n";

    if (!inDollarBlock && line.trimEnd().endsWith(";")) {
      results.push(current);
      current = "";
    }
  }
  if (current.trim()) results.push(current);
  return results;
}

async function main() {
  console.log("Applying pending migrations to Supabase...");
  console.log(`URL: ${SUPABASE_URL}`);

  for (const migration of MIGRATIONS) {
    try {
      await applyMigration(migration);
    } catch (err) {
      console.error(`FAILED: ${migration}`, err.message);
    }
  }

  console.log("\nDone.");
}

main();
