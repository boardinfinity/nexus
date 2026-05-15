/**
 * Seed Nexus 90-role job collection schedules.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/seed-job-collection-schedules.ts
 *   DRY_RUN=0 npx tsx scripts/seed-job-collection-schedules.ts
 *
 * Requires SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY.
 * Idempotency is by exact schedule name: existing rows are updated, missing rows are inserted.
 */
import { createClient } from "@supabase/supabase-js";

type RoleRow = { id: string; name: string; family: string; synonyms?: string[] };
type Cadence = "daily" | "weekly" | "monthly";
type Source = "linkedin_jobs" | "google_jobs" | "bayt_jobs" | "naukrigulf_jobs";

const DRY_RUN = process.env.DRY_RUN !== "0";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceKey);

const DAILY_ROLE_NAMES = new Set([
  "Backend Developer", "Cloud Engineer", "Cyber Security Analyst", "Data Engineer",
  "Data Scientist", "DevOps Engineer", "Embedded Systems Eng (junior)", "Frontend Developer",
  "Full Stack Developer", "Game Developer", "GRC Analyst", "IAM Engineer",
  "Machine Learning Engineer", "Mobile Application Developer", "Network Engineer",
  "Penetration Tester", "Quality Assurance Engineer", "Security Operations Center Analyst",
  "Software Developer", "Systems Administrator",
  "Civil Engineer", "Electrical Engineer", "Electronics Engineer", "Maintenance Engineer",
  "Mechanical Engineer", "Mechatronics Engineer", "Quantity Surveying Assistant", "R&D Tech",
  "Robotics Engineer", "Structural Engineer",
  "Account Manager", "Accountant", "Audit Associate", "Business Analyst",
  "Business Development Manager", "Business Intelligence Analyst", "Credit Analyst",
  "CRM/Retention", "Data Analyst", "Digital Marketing Specialist", "Financial Analyst",
  "FinTech Analyst", "Human Resources Generalist", "Investment Banking Analyst",
  "Management Trainee", "Marketing Manager", "Operations Manager", "Performance Marketing Analyst",
  "Product Manager", "Project Manager", "Sales Executive", "SEO Specialist",
  "Strategy Analyst", "Supply Chain Analyst", "Talent Acquisition Specialist", "Tax Associate",
]);

const MONTHLY_ROLE_NAMES = new Set([
  "Academic Researcher (aligned to chosen discipline)", "Behavioural Analyst", "Clinical Educator",
  "Counsellor", "Curriculum Developer", "Journalist", "Motion Graphics Designer",
  "Multimedia Producer", "Nurse Manager", "Quality & Patient Safety Assistant",
  "Registered Nurse", "Teacher", "Video Editor",
]);

function cadenceForRole(role: RoleRow): Cadence {
  if (DAILY_ROLE_NAMES.has(role.name)) return "daily";
  if (MONTHLY_ROLE_NAMES.has(role.name)) return "monthly";
  return "weekly";
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function nextDailyUtc(hour: number, minute = 0): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function nextWeeklyUtc(dayOfWeek: number, hour: number, minute = 0): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  const delta = (dayOfWeek - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + delta);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

function nextMonthlyUtc(hour: number, minute = 0): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, hour, minute, 0, 0));
  if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

function cronFor(cadence: Cadence, dayOfWeek: number, hour: number, minute = 0): string | null {
  if (cadence === "daily") return `${minute} ${hour} * * *`;
  if (cadence === "weekly") return `${minute} ${hour} * * ${dayOfWeek}`;
  return null;
}

function nextRunFor(cadence: Cadence, dayOfWeek: number, hour: number, minute = 0): string {
  if (cadence === "daily") return nextDailyUtc(hour, minute);
  if (cadence === "weekly") return nextWeeklyUtc(dayOfWeek, hour, minute);
  return nextMonthlyUtc(hour, minute);
}

const sourceBatchSize: Record<Source, number> = {
  linkedin_jobs: 25,
  google_jobs: 18,
  bayt_jobs: 15,
  naukrigulf_jobs: 15,
};

function baseConfig(source: Source, country: "India" | "United Arab Emirates" | "Saudi Arabia", roleIds: string[], cadence: Cadence): Record<string, any> {
  const dateWindow = cadence === "daily" ? "24h" : cadence === "weekly" ? "week" : "month";
  if (source === "linkedin_jobs") {
    return {
      job_role_ids: roleIds,
      location: country,
      date_posted: dateWindow,
      limit: cadence === "daily" ? 100 : 150,
      experience_level: "2,3,4",
      work_type: "1",
      fetch_description: true,
      sort_by: "DD",
      scheduler_rollout: "job_collection_90_roles_v1",
    };
  }
  if (source === "google_jobs") {
    const code = country === "India" ? "IN" : country === "United Arab Emirates" ? "AE" : "SA";
    return {
      job_role_ids: roleIds,
      country: code,
      date_posted: cadence === "daily" ? "today" : cadence === "weekly" ? "week" : "month",
      employment_types: "FULLTIME",
      num_pages: cadence === "daily" ? 3 : 5,
      max_queries: 18,
      scheduler_rollout: "job_collection_90_roles_v1",
    };
  }
  if (source === "bayt_jobs") {
    return {
      job_role_ids: roleIds,
      country: country === "United Arab Emirates" ? "UAE" : "Saudi Arabia",
      days_old: cadence === "daily" ? 1 : cadence === "weekly" ? 7 : 30,
      limit: 200,
      incremental: true,
      scheduler_rollout: "job_collection_90_roles_v1",
    };
  }
  return {
    job_role_ids: roleIds,
    location: country === "United Arab Emirates" ? "UAE" : "Saudi Arabia",
    limit: 200,
    incremental: true,
    scheduler_rollout: "job_collection_90_roles_v1",
  };
}

function sourceLabel(source: Source): string {
  return {
    linkedin_jobs: "LinkedIn",
    google_jobs: "Google Jobs",
    bayt_jobs: "Bayt",
    naukrigulf_jobs: "NaukriGulf",
  }[source];
}

async function main() {
  const { data: roles, error } = await supabase
    .from("job_roles")
    .select("id, name, family, synonyms")
    .order("family", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  if (!roles || roles.length !== 90) throw new Error(`Expected 90 job roles, found ${roles?.length || 0}`);

  const byCadence: Record<Cadence, RoleRow[]> = { daily: [], weekly: [], monthly: [] };
  for (const role of roles as RoleRow[]) byCadence[cadenceForRole(role)].push(role);

  const plan: any[] = [];
  const countries: Array<{
    country: "India" | "United Arab Emirates" | "Saudi Arabia";
    prefix: string;
    sources: Source[];
    startHour: number;
    weeklyDow: number;
  }> = [
    { country: "India", prefix: "India", sources: ["linkedin_jobs", "google_jobs"], startHour: 18, weeklyDow: 0 },
    { country: "United Arab Emirates", prefix: "UAE", sources: ["linkedin_jobs", "google_jobs", "bayt_jobs", "naukrigulf_jobs"], startHour: 21, weeklyDow: 1 },
    { country: "Saudi Arabia", prefix: "Saudi", sources: ["linkedin_jobs", "google_jobs", "bayt_jobs", "naukrigulf_jobs"], startHour: 0, weeklyDow: 2 },
  ];

  for (const c of countries) {
    let slot = 0;
    for (const source of c.sources) {
      for (const cadence of ["daily", "weekly", "monthly"] as Cadence[]) {
        const groups = chunk(byCadence[cadence], sourceBatchSize[source]);
        groups.forEach((group, index) => {
          const hour = (c.startHour + Math.floor(slot / 2)) % 24;
          const minute = (slot % 2) * 30;
          slot++;
          plan.push({
            name: `Nexus 90 ${c.prefix} ${sourceLabel(source)} ${cadence} ${index + 1}`,
            pipeline_type: source,
            config: baseConfig(source, c.country, group.map(r => r.id), cadence),
            frequency: cadence,
            cron_expression: cronFor(cadence, c.weeklyDow, hour, minute),
            is_active: true,
            next_run_at: nextRunFor(cadence, c.weeklyDow, hour, minute),
            created_by: "job90sch",
            role_count: group.length,
            roles: group.map(r => r.name),
          });
        });
      }
    }
  }

  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    role_counts: Object.fromEntries(Object.entries(byCadence).map(([k, v]) => [k, v.length])),
    schedule_count: plan.length,
    schedules: plan.map(p => ({ name: p.name, pipeline_type: p.pipeline_type, frequency: p.frequency, cron_expression: p.cron_expression, role_count: p.role_count, next_run_at: p.next_run_at })),
  }, null, 2));

  if (DRY_RUN) return;

  for (const schedule of plan) {
    const { role_count, roles: roleNames, ...row } = schedule;
    const { data: existing, error: lookupError } = await supabase
      .from("pipeline_schedules")
      .select("id")
      .eq("name", row.name)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const payload = { ...row, updated_at: new Date().toISOString() };
    if (existing?.id) {
      const { error: updateError } = await supabase.from("pipeline_schedules").update(payload).eq("id", existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from("pipeline_schedules").insert(payload);
      if (insertError) throw insertError;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
