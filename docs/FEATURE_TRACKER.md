# Nexus — Feature & Sub-Feature Tracker (Technical Mirror)

This is the technical mirror of the Notion "Nexus Feature Tracker" database. It is updated alongside Notion at every meaningful change.

**Notion is canonical for product/roadmap state; this file is canonical for technical state.** They should always agree on Status.

> **Notion master page:** [Nexus Intelligence Framework — Design Decisions & Roadmap](https://www.notion.so/infylearn/Nexus-Intelligence-Framework-Design-Decisions-Roadmap-3386386a961f8105b92bfe05b5a17597)
> **Notion Feature Tracker DB:** [data_source_id `8be4532a-2d07-4eb0-9a4a-b82aa6594a04`](https://www.notion.so/4291fc8a6d794f1e884efd0f27703ec3)

Legend: ✅ live · 🟡 in progress · ⚪ not started · 🔴 blocked · 🟣 paused

---

## P0 — Foundation

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Apify migration (RapidAPI removed) | ✅ | — | 2026-04-15 | dd9795c | All 4 actors live |
| Daily cron + scheduler reliability | ✅ | — | 2026-04-15 | 32440c8 | 1 schedule/tick, midnight UTC |
| Pipeline timeout guard | ✅ | — | 2026-04-15 | — | executePipeline error reporting added |
| Pre-existing TS errors triage | ⚪ | — | — | — | Ignore unless touching: placeintel-admin, users, schedules, people-alumni |

## P1 — Intelligence Framework

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Migration 025 schema | ✅ | — | 2026-04-09 | — | 12 cols on jobs, 8 on taxonomy_skills, 2 on job_skills |
| Reference tables (Functions/Families/Industries) | ✅ | — | 2026-04-09 | — | 26/20/15 seeded with RLS |
| upsert_skill() + validate_skills() | ✅ | — | 2026-04-09 | — | SECURITY DEFINER. Extended in 038b (l1/l2) and 043 (external_id). |
| /taxonomy API endpoints | ✅ | — | 2026-04-09 | — | reference-data, validate-skills, skills/unverified |
| Taxonomy 4-category L1/L2 model | ✅ | — | 2026-05-06 | 4b48c9c | Migration 033. 1,419 net-new contemporary skills. |
| Taxonomy legacy backfill + regions | ✅ | — | 2026-05-06 | 6237894 | Migration 037. 0 null l1 across legacy rows. |
| Taxonomy admin UI v2 (L1 chips + L2 dropdown + region filter) | ✅ | — | 2026-05-06 | 6237894 | `/taxonomy` accepts l1, l2, regions, source_filter |

## P2 — Enhanced JD Analysis Pipeline

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Track A — backend hardening (unified pipeline + 038 + runs endpoint) | ✅ | jdenh001 | 2026-05-07 | 6a1cecf | All 3 entry points (manual_single, async_batch, bulk_upload) route through canonical pipeline. |
| Track B — L1/L2 + fuzzy synonyms | ✅ | jdenh001 | 2026-05-07 | b6230ae | Prompt v2.2, 038b, 0 null l1 across 10,307 v2-tagged skills. |
| Track C — frontend transparency | ✅ | jdenh001 | 2026-05-07 | dffb624 | 716→459 lines, 7 sub-components, tooltips/badges/disclosures. |
| Track D — bulk campus upload | ✅ | jdenh001 | 2026-05-07 | 3d1d6ec | Migration 039, /upload/campus 4-step wizard. **Reference impl for Norm 1 async-uploader.** |
| Track E — /jd-analyzer/runs admin dashboard | ✅ | jdenh001 | 2026-05-07 | 2ce15e4 | 7-card KPI strip, drill-down, 10s auto-refresh. |
| JD Analysis (real-time) wired through v2.2 | ✅ | da29cd30 | 2026-05-15 | 85a47dc | runAnalyzeJd() v2.2 in executeJDEnrichment() bulk pipeline. GPT-4.1 mini Batch + bucket resolver + analyze_jd_runs. |
| JD bulk pipeline — proper fix (stateless cron, watchdog, JDBatchStatus) | ✅ | da29cd30 | 2026-05-15 | a787150 | Removed drain chain. Stateless 5-min cron. Zombie watchdog. Batch size 8. |
| Bucket resolver — 3-tier (validated/candidate/auto_create) | ✅ | da29cd30 | 2026-05-15 | 4929e2f | validated ≥50% → auto_assign, candidate ≥50% → tentative, else → auto_create. Cap 100/run. |
| JD Fetch — Google Search + GPT-4.1 mini extraction (Phase 3) | ✅ | jdf003 | 2026-05-15 | 0e71c94 | 3-strategy: direct URL → Google+GPT → no_jd_found. Location-aware queries. |

## P3 — External Enrichment

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| AmbitionBox CTC pipeline | ⚪ | — | — | — | $9/1K records |
| Glassdoor salary + interview pipeline | ⚪ | — | — | — | $5/1K records |
| Apollo company-level enrichment | ⚪ | — | — | — | Free 1K/month |
| Propagation logic (Title × Seniority × Company) | ⚪ | — | — | — | Fanout |

## P3b — Schedulers & Job Collection

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Job Collection — 90-role cadence rollout | ✅ | job90sch | 2026-05-15 | cef419b + 9bd944b + live-db | **64 active schedules in Supabase.** 90 distinct roles; 56 daily / 21 weekly / 13 monthly. India = LinkedIn + Google. UAE/Saudi = LinkedIn + Google + Bayt + NaukriGulf. |
| Bayt + NaukriGulf executors | ✅ | me-jobs | 2026-05-14 | d7cf5c3 + ca8dedb | New pipeline_types. Frontend forms. No migration needed. |
| ME pipeline P0/P1/P2 (async decouple, salary currency, multi-country) | ✅ | me-jobs | 2026-05-14 | 4bc931f | 4 tabbed UI. |
| Job Pipeline P2 — last_seen_at, role_match_score, discovery_source, discovered_titles, discovery_runs | ✅ | amb-jobs | 2026-05-13 | 040 applied | Migration 040 + 041. |
| Discovery-sweep + harvest endpoints | ✅ | amb-jobs | 2026-05-13 | 922d6d6 | 96 runs, 2,932 jobs, 1,829 discovered_titles. |
| Bulk-dispatch endpoint | 🟡 | amb-jobs | 2026-05-13 | — | Hit 300s timeout in 270-launch test. Use sequential pattern. |
| JD fetch auto-trigger on tick | ✅ | jdf003 | 2026-05-15 | c55610d | checkAndRunJdFetchCron(). |

## P4 — Frontend Intelligence

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Nexus Flow — unified pipeline dashboard (Phase 4+2) | ✅ | nf42 | 2026-05-15 | d908714 | 4 stage cards (Sources/Repo/JD Fetch/Analysis), Stage 4 intelligence panel, Phase 2 batch submit inline. |
| Bucket Explorer page | ⚪ | — | — | — | /buckets with full filter set |
| Bucket Detail page | ⚪ | — | — | — | /buckets/:id |
| Skill Intelligence Card | ⚪ | — | — | — | Surfaced on Job + Skill pages |
| Enhanced Dashboard | ⚪ | — | — | — | Bucket-based demand trends |
| Career path visualization | ⚪ | — | — | — | P6 |
| Job Drawer Intelligence card | ✅ | ui-discovery | 2026-05-13 | — | Mapped role + match score + bucket + discovery source + JD status + last seen |
| /discovered-titles admin page | ✅ | ui-discovery | 2026-05-13 | — | Status/country filters + promote/ignore |

## P5 — Code Quality & Reliability

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Split pipelines.ts into modules | ⚪ | — | — | — | — |
| API caching | 🟡 | cd-uowd14 | 2026-05-15 | b3ba3eb | Edge cache on public college-dashboard routes |
| TypeScript fixes | ⚪ | — | — | — | placeintel-admin, users, schedules, people-alumni — ignore unless touching |
| **Rate limiting (Upstash Redis)** | 🟡 | norms-may17 | 2026-05-17 | — | Per Norm 8. In progress. |
| **Sentry observability (client + server)** | 🟡 | norms-may17 | 2026-05-17 | — | Per Norm 6. In progress. |
| **Weekly cost/infra digest cron** | 🟡 | norms-may17 | 2026-05-17 | — | Per Norm 9. Sun 23:00 IST. In progress. |
| **Supabase branching workflow** | 🟡 | norms-may17 | 2026-05-17 | — | Per Norm 11. Vercel Preview + Supabase branches. Docs in place; awaiting dashboard click. |

## P5b — Upload Reliability (Norm 1 enforcement)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| CSV upload watchdog (expireStuckUploads on /scheduler/tick, 30 min threshold) | ✅ | amb-uprc09 | 2026-05-14 | 9abbc6f | Truthful skipped counters + watchdog + dedup-as-completed. **Norm 1 reference impl.** |
| Campus upload batches (async, college-rep scoped) | ✅ | jdenh001 | 2026-05-07 | 3d1d6ec | Migration 039. /upload/campus 4-step wizard. |
| UAE/GCC skill extraction (Vercel re-entrant) | ✅ | cd-uowd14 | 2026-05-14 | 4c0b6c6 | `/admin/extract-uae-job-skills/{start,tick,stop}`, CRON_SECRET-gated public tick. **Norm 1 reference impl.** |
| Audit + retrofit ALL uploaders to Norm 1 | ⚪ | TBD | — | — | `/upload`, `/upload/campus`, `/upload/<any-future>` — verify async-first compliance. |

## P6 — Profile Correlation + SLM

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Career path mining | ⚪ | — | — | — | Future |
| Skill gap analysis | ⚪ | — | — | — | Future |
| Nexus SLM (Qwen-2.5-3B fine-tune) | ⚪ | — | — | — | Marketing positioning landed; technical work future |

---

## Job Bucketization (P1.5 — running between P1 and P2)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Phase 0: schema cleanup + classification fields | ✅ | — | 2026-04-30 | PR #7 | Migration 031 |
| Phase 1: bucket tables + jobs.bucket_id | ✅ | — | 2026-04-30 | PR #7 | 7 normalized tables, RLS |
| Phase 2: seed curated buckets | ✅ | — | 2026-04-30 | PR #7 | Tier-1 (20), Tier-2 (16), UAE/GCC (5) — all candidate |
| Phase 3: resolver integration | ✅ | — | 2026-04-30 | PR #7 | Deterministic, explainable scoring |
| Phase 3.5: 3-tier resolver (validated/candidate/auto_create) | ✅ | da29cd30 | 2026-05-15 | 4929e2f | Auto-create flow grew job_buckets from 41 → 3,186. |
| First validation cycle (promote candidates) | 🟡 | — | — | — | 3,186 buckets; need batch-validate UI + queue review |
| Phase 4: admin review queue UI | 🟡 | — | — | — | Approve/merge/reject/edit |
| Phase 5: Bucket Explorer + Detail | ⚪ | — | — | — | Frontend Intelligence (P4) |

---

## Surveys (independent track)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Survey Admin v2 (migration 030, schema-driven) | ✅ | — | 2026-04-29 | — | 10 question types, OTP, Mandrill |
| AI wizard (Brief/Doc/Clone) | ✅ | — | 2026-04-29 | 94ae222 | Claude Sonnet 4.6 with JSON-schema tool use |
| SPOC role enforcement | ✅ | — | 2026-04-29 | 310aec3 | 3-layer (requirePermission, blockCollegeRep, assertSurveyInScope) |
| Mandrill switchover | ✅ | — | 2026-04-29 | fa40b95 | Replaced Resend |
| UOWD Employer + Industry survey | 🟡 | — | 2026-05-06 | — | Deployed; nexus-bi Git integration issues |
| UOWD Alumni + Faculty survey | 🟡 | — | — | — | Pending |
| Survey status `published` value | ✅ | — | 2026-05-05 | — | Migration 032 |
| CSV export of respondent data | ⚪ | — | — | — | Future |
| Mandrill volume monitoring | ⚪ | — | — | — | Alert at 80% of 500/day cap — fits Norm 3 |
| AI question rewrites | ⚪ | — | — | — | Future |
| Email digests for SPOCs | ⚪ | — | — | — | Future |

---

## Alumni Insights (independent track)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Alumni Insights v1 spec | ✅ | — | 2026-04-30 | — | 5-layer pipeline |
| Migration 0001_alumni_insights_core.sql | 🟡 | — | — | — | Application status TBD |
| Migration 0002_alumni_insights_seed.sql | 🟡 | — | — | — | Application status TBD |
| Pagination fix in processAlumniResults | 🟡 | — | — | — | Apify scraped 10,959; Nexus only read 2,500 |
| Post-scrape education validation strengthening | 🟡 | — | — | — | Full + short college name pattern matching |
| 5-layer aggregator | ⚪ | — | — | — | Person → bucketing → aggregation |
| Anonymous public reports endpoint | ⚪ | — | — | — | Per college |
| placeintel dependency clarification | 🔴 | — | — | — | Blocked: unclear what placeintel uses |

---

## College Dashboard (cd-uowd14)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Phase 0 — 8-panel consolidated endpoint + UOWD demo | ✅ | cd-uowd14 | 2026-05-14 | e000b47 | Public slug `/c/uowd-9k3xr2vp/dashboard`. 40 programs / 181 courses / 1,388 mapped skills / 9,502 alumni. |
| UAE/GCC skill extraction worker | ✅ | cd-uowd14 | 2026-05-14 | 4c0b6c6 | Vercel re-entrant `/admin/extract-uae-job-skills/{start,tick,stop}`. |
| Perf #1 — Wave A/B/C parallelization | ✅ | cd-uowd14 | 2026-05-15 | 6a88746 | 60s timeout fix. /by-slug 3s, /jobs 9.4s. |
| Perf #2 — Migration 043 country index | ✅ | cd-uowd14 | 2026-05-15 | 275bf31 | CONCURRENTLY index on jobs.location_country. |
| Perf #3 — Edge cache (s-maxage=300, SWR=600) | ✅ | cd-uowd14 | 2026-05-15 | b3ba3eb | React-Query staleTime 5min + gcTime 30min. |
| Migration 042 — college_regions | ✅ | cd-uowd14 | 2026-05-14 | — | Drops hard-coded country lists. |
| Migration 044 — campus_excel_support + share_tokens | ✅ | cd-uowd14 | 2026-05-14 | — | `college_dashboard_share_tokens` replaces hardcoded DEMO_SLUGS. |
| Phase 1+ — additional panels, more colleges, audit log | ⚪ | — | — | — | Per Norm 10, add audit_dashboard_events. |

---

## Master Data

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| /masters Job Roles tab | ✅ | — | 2026-04-14 | — | Full CRUD |
| /masters Colleges tab | ✅ | — | 2026-04-15 | — | Migration 029, NIRF Top 50 |
| /masters Buckets section | ✅ | — | 2026-04-30 | PR #7 | Read of job_buckets (now 3,186 rows) |
| Job Role Master refresh (May 2026) | ✅ | — | 2026-05-05 | — | 90 distinct records |
| /masters Skills tab (read-only count) | ⚪ | — | — | — | 41,630 today |
| /masters Job Families / Industries / Functions tabs | ⚪ | — | — | — | Read-only counts |

---

## Marketing

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Nexus marketing page (13 sections) | ✅ | mkt-may15 | 2026-05-15 | — | https://nexus-marketing-silk.vercel.app · Includes Nexus SLM positioning |
| Vercel apex `boardinfinity.com` blocker | 🔴 | — | — | — | Claimed by another team; blocks www.nexus subdomain claim from Abhay's personal account |

---

## How to use this file

1. Before working on a sub-feature, find its row.
2. Set `Owner Thread` to your thread short_id.
3. Set `Status` to 🟡.
4. Update `Last Update`, `Commit`, `Notes` after each push.
5. At thread close: set `Status` to ✅ / 🟣 / 🔴 and write the next-action in `Notes`.
6. **Mirror every change in the Notion "Nexus Feature Tracker" database via `notion_mcp` (NEVER browser_task).**
