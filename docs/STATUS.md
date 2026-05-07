# Nexus — Rolling STATUS Log

Append a 1-line entry after every meaningful ship. Most-recent first. Format:
`YYYY-MM-DD · <feature> · <commit-sha> · <one-line summary>`

---

## 2026

- 2026-05-07 · jd-analyzer-enhancement · — · Kicked off Analyze JD enhancement cycle (Whimsical board). 5 tracks: A backend hardening, B L1/L2 skills + synonyms, C frontend transparency, D bulk campus upload, E runs dashboard. Reserved migrations 038 (analyze_jd_runs + l2_to_l1) and 039 (campus_upload_batches). 5 Feature Tracker rows under P2 JD Pipeline owned by thread jdenh001.
- 2026-05-06 · taxonomy · 6237894 · Taxonomy admin UI v2: replaced category tabs with L1 chips (4) + smart L2 dropdown (valid pairs only) + multi-region filter + Source filter (v2/legacy). API `/taxonomy` accepts `l1`, `l2`, `regions`, `source_filter`; `/taxonomy/stats` returns `by_l1`, `by_l2`, `by_region`. Migration 037: adds `regions text[]` (GIN), backfills l1/l2 for 8,887 legacy rows (technology→Tool, skill→Skill, ability→Ability, knowledge→Knowledge), seeds regions from `india_relevance`, extends `get_taxonomy_stats()`. Final L1 distribution: TECHNICAL SKILLS 9,574 / COMPETENCIES 334 / KNOWLEDGE 288 / CREDENTIAL 111 = 10,307.
- 2026-05-06 · taxonomy · 4b48c9c · Migration 033: 4-category L1/L2 model on `taxonomy_skills` (l1+l2+domain_tag+india_relevance cols + CHECK constraints + indexes) and bulk insert of 1,419 net-new modern skills (AI/ML 413, Modern SWE 351, Business/Ops 406, EdTech 173, Cross-cutting 79; 143 India-tagged). Existing 8,887 legacy rows untouched.
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
2026-05-06 · bd929ff · UOWD survey: 25 preset skill rows (text-only) + optional taxonomy add-more picker
