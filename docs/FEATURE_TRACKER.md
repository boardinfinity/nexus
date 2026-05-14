# Nexus — Feature & Sub-Feature Tracker (Technical Mirror)

This is the technical mirror of the Notion "Nexus Feature Tracker" database. It is updated alongside Notion at every meaningful change. **Notion is canonical for product/roadmap state; this file is canonical for technical state.** They should always agree on Status.

Legend: ✅ live · 🟡 in progress · ⚪ not started · 🔴 blocked · 🟣 paused

---

## P0 — Foundation

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Apify migration (RapidAPI removed) | ✅ | — | 2026-04-15 | dd9795c | All 4 actors live |
| Daily cron + scheduler reliability | ✅ | — | 2026-04-15 | 32440c8 | 1 schedule/tick, midnight UTC |
| Pipeline timeout guard | ✅ | — | 2026-04-15 | — | executePipeline error reporting added |
| Pre-existing TS errors triage | ⚪ | — | — | — | Ignore unless touching those files |

## P1 — Intelligence Framework

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Migration 025 schema | ✅ | — | 2026-04-09 | — | 12 cols on jobs, 8 on taxonomy_skills, 2 on job_skills |
| Reference tables (Functions/Families/Industries) | ✅ | — | 2026-04-09 | — | 26/20/15 seeded with RLS |
| upsert_skill() + validate_skills() | ✅ | — | 2026-04-09 | — | SECURITY DEFINER |
| /taxonomy API endpoints | ✅ | — | 2026-04-09 | — | reference-data, validate-skills, skills/unverified |

## P2 — Enhanced JD Analysis Pipeline

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| JD Analysis (Real-time) — /pipelines/jd trigger & UX | ✅ | da29cd30 | 2026-05-15 | 85a47dc | Wire runAnalyzeJd() v2.2 into executeJDEnrichment() bulk pipeline. gpt-4.1-mini + L1/L2 + bucket resolver + analyze_jd_runs. Cap 40/run, concurrency=3, queue-drain pattern. |
| Wire v2 prompt into pipeline | ⚪ | — | — | — | 3 JDs/call, GPT-4.1 mini Batch |
| Three-tier extraction (hard/knowledge/competency) | ⚪ | — | — | — | 10 categories, max 15 skills |
| upsert_skill() integration in extraction | ⚪ | — | — | — | Auto-create as 'unverified' |
| Post-extraction validation | ⚪ | — | — | — | Auto-promote at 10 mentions / 3 companies |
| 18K+ JD backfill runner | ⚪ | — | — | — | Vercel timeout-safe chunking |

## P3 — External Enrichment

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| AmbitionBox CTC pipeline | ⚪ | — | — | — | $9/1K records |
| Glassdoor salary + interview pipeline | ⚪ | — | — | — | $5/1K records |
| Apollo company-level enrichment | ⚪ | — | — | — | Free 1K/month |
| Propagation logic | ⚪ | — | — | — | Title × Seniority × Company fanout |

## P4 — Frontend Intelligence

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Bucket Explorer page | ⚪ | — | — | — | /buckets with full filter set |
| Bucket Detail page | ⚪ | — | — | — | /buckets/:id |
| Skill Intelligence Card | ⚪ | — | — | — | Surfaced on Job + Skill pages |
| Enhanced Dashboard | ⚪ | — | — | — | Bucket-based demand trends |
| Career path visualization | ⚪ | — | — | — | P6 |

## P5 — Code Quality

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Split pipelines.ts into modules | ⚪ | — | — | — | — |
| API caching | ⚪ | — | — | — | — |
| TypeScript fixes | ⚪ | — | — | — | placeintel-admin, users, schedules |
| Rate limiting | ⚪ | — | — | — | — |

## P6 — Profile Correlation + SLM

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Career path mining | ⚪ | — | — | — | Future |
| Skill gap analysis | ⚪ | — | — | — | Future |
| SLM training data + fine-tuning | ⚪ | — | — | — | Future |

---

## Job Bucketization (P1.5 — running between P1 and P2)

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| Phase 0: schema cleanup + classification fields | ✅ | — | 2026-04-30 | PR #7 | Migration 031 |
| Phase 1: bucket tables + jobs.bucket_id | ✅ | — | 2026-04-30 | PR #7 | 7 normalized tables, RLS |
| Phase 2: seed curated buckets | ✅ | — | 2026-04-30 | PR #7 | Tier-1 (20), Tier-2 (16), UAE/GCC (5) — all candidate |
| Phase 3: resolver integration | ✅ | — | 2026-04-30 | PR #7 | Deterministic, explainable scoring |
| First validation cycle (promote candidates) | 🟡 | — | — | — | 0 validated yet; needs dry-run review |
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
| CSV export of respondent data | ⚪ | — | — | — | Future |
| Mandrill volume monitoring | ⚪ | — | — | — | Alert at 80% of 500/day cap |
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
| 5-layer aggregator | ⚪ | — | — | — | Person analysis → bucketing → aggregation |
| Anonymous public reports endpoint | ⚪ | — | — | — | Per college |
| placeintel dependency clarification | 🔴 | — | — | — | Blocked: unclear what placeintel uses |

---

## Master Data

| Sub-Feature | Status | Owner Thread | Last Update | Commit | Notes |
|---|---|---|---|---|---|
| /masters Job Roles tab | ✅ | — | 2026-04-14 | — | Full CRUD |
| /masters Colleges tab | ✅ | — | 2026-04-15 | — | Migration 029, NIRF Top 50 |
| /masters Buckets section | ✅ | — | 2026-04-30 | PR #7 | Read of job_buckets |
| Job Role Master refresh (May 2026) | ✅ | — | 2026-05-05 | — | 90 distinct records |
| /masters Skills tab (read-only count) | ⚪ | — | — | — | 8,888 |
| /masters Job Families / Industries / Functions tabs | ⚪ | — | — | — | Read-only counts |

---

## How to use this file

1. Before working on a sub-feature, find its row.
2. Set `Owner Thread` to your thread short_id.
3. Set `Status` to 🟡.
4. Update `Last Update`, `Commit`, `Notes` after each push.
5. At thread close: set `Status` to ✅ / 🟣 / 🔴 and write the next-action in `Notes`.
6. Mirror every change in the Notion "Nexus Feature Tracker" database.
