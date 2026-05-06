# Nexus — Rolling STATUS Log

Append a 1-line entry after every meaningful ship. Most-recent first. Format:
`YYYY-MM-DD · <feature> · <commit-sha> · <one-line summary>`

---

## 2026

- 2026-05-06 · setup · 5c8faee · Created /docs/ folder with STATUS.md, FEATURE_TRACKER.md, MIGRATIONS.md, ENV.md, RLS.md, MODELS.md. Established Notion+/docs hybrid coordination model, seeded Notion Feature Tracker DB (60 rows), refreshed universal thread context template.
- 2026-05-05 · job-role-master · — · Replaced public.job_roles from May-2026 75-row CSV; restored 15 legacy entries; deduped synonyms → 90 distinct records.
- 2026-04-30 · bucketization · PR #7 · Phase 0/1 merged. Migration 031, 7 bucket tables, deterministic resolver, dry-run endpoint, JD Analyzer Bucket Mapping panel. Seeded 41 candidate buckets.
- 2026-04-30 · alumni-insights · — · Spec finalized; migrations 0001_alumni_insights_core.sql + 0002_alumni_insights_seed.sql ready for application.
- 2026-04-29 · surveys · — · Survey Admin v2 shipped. Migration 030, JSONB schema-driven runtime, OTP gate, Mandrill mailer, AI wizard (Brief/Doc/Clone), SPOC scoping with 3-layer enforcement.
- 2026-04-15 · scheduler · 32440c8 · Reduced to 1 schedule per tick; daily cron at midnight UTC.
- 2026-04-15 · scheduler · af98838 · Vercel-aware throttling.
- 2026-04-15 · scheduler · dd9795c · Removed duplicate inline tick handler; delegated to scheduler.ts.
- 2026-04-15 · alumni-scraper · — · Rebuilt with college selection from master list, post-scrape education validation.
- 2026-04-14 · jobs-pipeline · — · LinkedIn + Google Jobs rebuilt on Apify-only; 22-country dropdown; richer fields.
- 2026-04-14 · job-roles · — · Migration 027: 84 roles + 791 synonyms imported from Airtable; jobs.job_role_id FK.
- 2026-04-14 · masters-ui · — · /masters page with Job Roles + Colleges tabs.
- 2026-04-09 · intelligence-framework · — · Migration 025: P1 schema for Intelligence Framework. 26 functions, 20 families, 15 industries seeded. upsert_skill() + validate_skills() functions.
- 2026-04-03 · marketing · — · Nexus product marketing wireframe + Nexus University one-pager.
