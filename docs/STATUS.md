# Nexus — Rolling STATUS Log

Append a 1-line entry after every meaningful ship. **Most-recent first.** Format:
`YYYY-MM-DD · <feature/short_id> · <commit-sha> · <one-line summary>`

> **Source of truth:** This file lives in **two places** — Space (for thread context) and `/docs/STATUS.md` in `boardinfinity/nexus` (for repo context). Both must stay in lockstep.

---

## Current ground truth (as of 2026-05-17)

| Metric | Value | Source |
|---|---|---|
| `jobs` count | 59,497 | Supabase live |
| `jobs` with posted_at | 57,195 | Supabase live |
| `jobs` UAE/GCC (AE/SA/QA/OM/KW/BH) | 2,729 | Supabase live |
| `alumni` count | 18,636 | Supabase live |
| `taxonomy_skills` count | 41,630 | Supabase live |
| `colleges` count | 982 | Supabase live |
| `job_buckets` count | 3,186 | Supabase live |
| `surveys` count | 6 | Supabase live |
| `pipeline_runs` count | 1,253 | Supabase live |
| `pipeline_schedules` count | 83 | Supabase live |
| `secondary_reports` count | 31 | Supabase live |
| Latest migration applied (tracked) | `044_campus_excel_support` | `list_migrations` |
| Next migration number | **045** | per repo `/migrations` |
| Security advisors: ERROR | 0 | `get_advisors` |
| Security advisors: WARN | 1 (`pg_trgm` in public — deferred) | `get_advisors` |
| Security advisors: INFO | 38 (RLS-enabled-no-policy — by design, service-role architecture) | `get_advisors` |
| Supabase compute | **Medium** (~$60/mo) — upgraded from Nano during UOWD demo | Plan |
| Vercel plan | **Pro** · `maxDuration: 300` | Plan |
| HIBP password breach check | enabled | Supabase Auth |
| Repo (canonical) | `github.com/boardinfinity/nexus` | n/a |
| Mirror (read-only) | `github.com/abhay-boardi/nexus` | n/a |

---

## 2026

### May (active month)

- 2026-05-15 · job90sch · `9bd944b` · Docs: mark 90-role rollout active. Final closeout of scheduler activation cycle.
- 2026-05-15 · job90sch · `live-db` · Activated 64 active schedules in Supabase: 90 distinct roles; 56 daily / 21 weekly / 13 monthly; India = LinkedIn + Google; UAE/Saudi = LinkedIn + Google + Bayt + NaukriGulf. `pipeline_schedules` now at 83 rows.
- 2026-05-15 · job90sch · `cef419b` · Job collection scheduler 90-role rollout support: compact Google role queries, schedules API/UI accepts Bayt + NaukriGulf + monthly cadence, idempotent 90-role seed script.
- 2026-05-15 · run-history · `5f7e352` · JD fetch/analysis result breakdown, correct View Jobs links, missing pipeline labels; track fetched/no_jd_found counters in pipeline_runs.config.
- 2026-05-15 · scheduler · `c55610d` · Add `checkAndRunJdFetchCron()` — JD fetch was never auto-triggered on tick because no schedule row existed.
- 2026-05-15 · nexus-flow · `d47601a` + `7025d44` + `65e0009` · Flatten nexus-flow into single component; rename props to avoid minifier ReferenceError on production build.
- 2026-05-15 · nexus-flow · `d908714` · **Phase 4+2 — unified pipeline dashboard.** 4-stage view (Sources/Repo/JD Fetch/Analysis), Stage 4 intelligence (buckets, discovered titles, 7d trend), Phase 2 batch submit wired inline, responsive layout, extended queue-status API (24 parallel Supabase queries).
- 2026-05-15 · jd-fetch · `0e71c94` · **Phase 3 — Google Search + GPT-4.1 mini extraction**, no_jd_found status, location-aware queries, geoToSearchLocation() helper, 3-strategy logic (direct URL → Google+GPT → no_jd_found).
- 2026-05-15 · jd-bulk · `db9103e` · Import resolveBucket in pipelines.ts (was missing — caused ReferenceError for all 100 backfill jobs per page).
- 2026-05-15 · jd-bulk · `eda1ad9` · Backfill always fetches offset=0 (prevent pagination drift on shrinking set).
- 2026-05-15 · jd-bulk · `f90a036` · Add `/pipelines/jd/backfill-buckets` endpoint — resolver-only backfill for 3,656 v2 jobs.
- 2026-05-15 · jd-bulk · `96d8b34` · Raise jd_enrichment PER_INVOCATION_CAP 40→100 (5.3s/job ÷ CONC=3 × 100 ≈ 177s, fits 300s cap).
- 2026-05-15 · jd-bulk · `70f3936` · Perf: pre-load bucket catalog once before chunk loop (300 DB calls → 3 per batch).
- 2026-05-15 · jd-bulk · `1f24427` + `bb46e68` · Sync LLM prompt codes with DB FKs (FN-PRD/CSU/ITS/LGL/QAL/REL); FK guard in createCandidateBucket; hard-filter fn/family/industry mismatches.
- 2026-05-15 · jd-bulk · `4929e2f` · **Phase 1: 3-tier bucket resolver** (validated ≥50% → auto_assign, candidate ≥50% → tentative, else → auto_create). Batch cap 100. View Jobs fix. Analyze JD drawer shows ClassificationCard + BucketMappingCard + SkillsCard.
- 2026-05-15 · jd-bulk · `a787150` · **JD bulk pipeline proper fix** — remove drain chain, stateless 5-min cron, zombie watchdog, JDBatchStatus UI, batchSize 8.
- 2026-05-15 · cd-uowd14 · `3a0ac20` · Closeout — Perf #1 + mig 044 written + 22 Phase 1-5 rows in Notion.
- 2026-05-15 · cd-uowd14 · `b3ba3eb` · **Perf #1 — edge cache** (s-maxage=300, SWR=600) on public `/by-slug` + `/jobs`; React-Query staleTime 5min + gcTime 30min.
- 2026-05-15 · cd-uowd14 · `7439b46` · Dashboard timeout resolution — Wave A/B/C refactor + compute upgrade to Medium. /by-slug now 3s, /jobs 9.4s.
- 2026-05-15 · cd-uowd14 · `275bf31` · Migration 043 — index `jobs.location_country` to fix College Dashboard 60s timeout. CONCURRENTLY.
- 2026-05-15 · cd-uowd14 · `6a88746` · Parallelize buildDashboardPayload into Wave A/B/C + merge duplicate UAE/GCC jobs pulls to fix 60s gateway timeout.
- 2026-05-15 · jd-bulk · `3659c42` · Fix QueueStatus active_batch type — object not string, fix .slice() crash.
- 2026-05-14 · me-jobs · `4bc931f` · P0 async decouple + timeout raises (all 4 executors), P1 salary currency fix + incrementalMode default, P2 multi-country schedules, tabbed UI (4 tabs).
- 2026-05-14 · audit · — · 3 clay_linkedin CSV uploads stuck mid-batch on client-side abandonment → marked failed; opened `amb-uprc09` for watchdog work.
- 2026-05-14 · amb-uprc09 · `9abbc6f` · **Upload fix: truthful skipped counters + expireStuckUploads watchdog wired into `/scheduler/tick` (30-min threshold) + finalizeUpload treats fully-deduped re-uploads as completed + UI copy fixes.** (Reference impl of Norm 1 for the next uploader.)
- 2026-05-14 · cd-uowd14 · `e000b47` · **College Dashboard Phase 0 v0 for UOWD.** 8-panel public endpoint at `/c/uowd-9k3xr2vp/dashboard`. Vercel verified: 40 programs / 181 courses / 1,388 mapped skills / 9,502 alumni. Demo URL live.
- 2026-05-14 · cd-uowd14 · `4c0b6c6` · **UAE/GCC skill extraction worker** — Vercel re-entrant. Endpoints: POST `/admin/extract-uae-job-skills/{start,tick,stop}`, GET `/status`. 25 jobs/tick × concurrency=5, ~4min budget, resumable via `analysis_version!='v2'`, reuses `batch_jobs`. CRON_SECRET-gated public tick for self-recursion.
- 2026-05-14 · me-jobs · `ca8dedb` · Restored Bayt + NaukriGulf executors (clobbered by concurrent push 19f6b17).
- 2026-05-14 · me-jobs · `d7cf5c3` · **Bayt + NaukriGulf executors + frontend forms.** pipeline_type: `bayt_jobs` | `naukrigulf_jobs`. No migration needed.
- 2026-05-13 · amb-jobs · `922d6d6` · P3 closeout. `/pipelines/jobs/recover-bulk-roles` (harvests 30 role datasets per bulk pipeline_run, pre/post snapshot pattern to compensate for processLinkedInResults overwrite). 9 bulk runs recovered → 1,629 bulk jobs. Discovery-harvest 96/96 in chunked mode → 1,829 discovered_titles. Fresh 24h: 5,104.
- 2026-05-13 · amb-jobs · — · Bulk-dispatch + discovery-sweep fired. **Discovery-sweep WORKED** (96 runs, 2,932 jobs). **Bulk-dispatch FAILED** with 300s timeout — 270 Apify launches × fire-and-forget exceeded budget. Lesson: never fan out >30 parallel Apify launches in a single request.
- 2026-05-13 · amb-jobs · — · P3 routes added: `/pipelines/jobs/bulk-dispatch`, `/discovery-sweep`, `/discovery-harvest`. Plumbed `discovery_source` through executeLinkedInJobs + processLinkedInResults + executeGoogleJobs.
- 2026-05-13 · amb-jobs · — · **Migration 040 applied** (`last_seen_at` on 22,118 rows). Promoted `role_match_score` + `last_seen_at` writes into new columns on LinkedIn + Google insert paths.
- 2026-05-13 · amb-jobs · — · **P2 migration 040 reserved + written** (`jobs.last_seen_at`, `role_match_score`, `discovery_source`; `discovered_titles` + `discovery_runs` tables).
- 2026-05-13 · amb-jobs · — · P1 LinkedIn mapping patches (qualifications, responsibilities, benefits, salary_text, is_remote, work_type, application_url multi-key); persist job_role_id at insert; OR-query overflow detection; COALESCE company URL backfill.
- 2026-05-13 · ui-discovery · — · Job drawer Intelligence card (mapped role, match score, mapped bucket, discovery source, JD status, last seen). New `/discovered-titles` admin page (status/country filters, promote/ignore actions).
- 2026-05-07 · jd-analyzer-enhancement-COMPLETE · `affaf26+16de0f3+dffb624+e1aa504+2ce15e4` · **All 5 tracks shipped.** Track A backend hardening (unified pipeline + 038 + runs endpoint) · Track B L1/L2 + fuzzy synonyms (prompt v2.2 + 038b + 0 null l1 across 10,307 v2-tagged skills) · Track C frontend transparency (jd-analyzer.tsx 716→459 lines + 7 sub-components) · Track D bulk campus upload (039 + /upload/campus 4-step wizard) · Track E `/jd-analyzer/runs` admin dashboard. All Feature Tracker rows = Done. Owner thread `jdenh001`.
- 2026-05-06 · taxonomy · `6237894` · Taxonomy admin UI v2 — L1 chips + smart L2 dropdown + multi-region filter + Source filter. Migration 037: `regions text[]` GIN, backfill l1/l2 for 8,887 legacy rows, seeds regions. **Note today's count is 41,630 total taxonomy_skills (corpus grew).**
- 2026-05-06 · taxonomy · `4b48c9c` · **Migration 033 — 4-category L1/L2 model.** l1+l2+domain_tag+india_relevance on taxonomy_skills. Bulk inserts 1,419 net-new modern skills (AI/ML 413, Modern SWE 351, Business/Ops 406, EdTech 173, Cross-cutting 79; 143 India-tagged).
- 2026-05-06 · uowd-survey · `bd929ff` · UOWD survey 25 preset skill rows + optional taxonomy add-more picker.
- 2026-05-06 · setup · `5c8faee` · Created `/docs/` folder with all state files. Established Notion+/docs hybrid coordination model. Seeded Notion Feature Tracker DB (60 rows).
- 2026-05-05 · job-role-master · — · Replaced `public.job_roles` from May-2026 75-row CSV; restored 15 legacy entries; deduped synonyms → 90 distinct records.

### April

- 2026-04-30 · bucketization · PR #7 · Phase 0/1 merged. Migration 031, 7 bucket tables, deterministic resolver, dry-run endpoint, JD Analyzer Bucket Mapping panel. Seeded 41 candidate buckets. **(Note: `job_buckets` is now 3,186 due to auto-create flow.)**
- 2026-04-30 · alumni-insights · — · Spec finalized; migrations `0001_alumni_insights_core.sql` + `0002_alumni_insights_seed.sql` ready. Application status TBD.
- 2026-04-29 · surveys · — · Survey Admin v2 shipped. Migration 030, JSONB schema-driven runtime, OTP gate, Mandrill mailer, AI wizard (Brief/Doc/Clone), SPOC scoping with 3-layer enforcement.
- 2026-04-15 · scheduler · `32440c8` · Reduced to 1 schedule per tick; daily cron at midnight UTC.
- 2026-04-15 · scheduler · `af98838` · Vercel-aware throttling.
- 2026-04-15 · scheduler · `dd9795c` · Removed duplicate inline tick handler; delegated to scheduler.ts.
- 2026-04-15 · alumni-scraper · — · Rebuilt with college selection from master list, post-scrape education validation.
- 2026-04-14 · jobs-pipeline · — · LinkedIn + Google Jobs rebuilt on Apify-only; 22-country dropdown; richer fields.
- 2026-04-14 · job-roles · — · Migration 027: 84 roles + 791 synonyms imported from Airtable; `jobs.job_role_id` FK.
- 2026-04-14 · masters-ui · — · `/masters` page with Job Roles + Colleges tabs.
- 2026-04-09 · intelligence-framework · — · Migration 025: P1 schema for Intelligence Framework. 26 functions, 20 families, 15 industries seeded. `upsert_skill()` + `validate_skills()`.
- 2026-04-03 · marketing · — · Nexus product marketing wireframe + Nexus University one-pager.

### May 17 — Audit & Norms (this session)

- 2026-05-17 · norms · — · **Codified 12 Global Norms** in `nexus_global_norms.md`. Refreshed all Space state files (STATUS, FEATURE_TRACKER, MIGRATIONS, MODELS, RLS, ENV, recent_dev_digest). Patching 3 Space-scoped skills. Wiring Sentry, Upstash rate-limiting, weekly cost/infra digest cron. Staging workflow documented (Vercel Preview + Supabase Branches).
