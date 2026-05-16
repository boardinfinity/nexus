# Nexus — Migration Log

**The next migration number is: `045`** (reserve before writing SQL).

> Tracked migrations (`list_migrations`): 5 entries. The remaining SQL files in `/migrations/` were applied earlier or via dashboard — they exist on the DB but aren't in the Supabase migration tracker.

---

## Applied (chronological)

| # | File | Applied | Author | Summary |
|---|---|---|---|---|
| 025 | `025_intelligence_framework.sql` | 2026-04-09 | abhay | 12 cols on jobs (job_function, job_family, job_industry, bucket, sub_role, experience_min/max, education_req, jd_quality, confidence, analysis_version, analyzed_at). 8 cols on taxonomy_skills. 2 cols on job_skills. Reference tables: job_functions (26), job_families (20), job_industries (15). upsert_skill() + validate_skills() SECURITY DEFINER. 8 indexes. RLS on reference tables. |
| 026 | `026_bulk_pipeline_helpers.sql` | 2026-04 | abhay | Bulk pipeline helper functions. |
| 027 | `027_job_role_taxonomy.sql` | 2026-04-14 | abhay | `job_roles` table (84 roles, 791 synonyms imported from Airtable) + `jobs.job_role_id` FK. |
| 028 | `028_google_jobs_fields.sql` | 2026-04-14 | abhay | `is_remote`, `job_publisher`, `apply_platforms`, `qualifications[]`, `responsibilities[]`, `benefits[]`, `salary_text`, `title_normalized`, `company_name_normalized`. |
| 029 | `029_college_master_list.sql` | 2026-04-15 | abhay | `degree_level`, `ranking_source`, `ranking_year`, `ranking_score`, `linkedin_slug` on colleges + NIRF MBA Top 50 seed. |
| 030 | `030_survey_admin_v2.sql` | 2026-04-29 | abhay | New tables: `surveys`, `survey_invites`, `email_queue`. FK-bind `survey_respondents.survey_id`, `survey_responses.survey_id`, `survey_skill_ratings.survey_id` (NOT NULL). Unique on `(survey_id, lower(email))`. |
| 031 | `031_job_buckets_phase1.sql` | 2026-04-30 | abhay | Bucketization Phase 0/1. `jobs.standardized_title`, `company_type`, `geography`, `bucket_id`, `bucket_match_confidence`, `bucket_match_reason`, `bucket_status_at_assignment`. New tables: `job_buckets`, `job_bucket_aliases`, `job_bucket_evidence`, `job_bucket_skill_map`, `job_bucket_overlays`, `job_bucket_review_queue`, `job_bucket_merge_history`. RLS hides candidate buckets. |
| 032 | `032_survey_status_published.sql` | 2026-05-05 | abhay | Survey status `published` value added to CHECK constraint. **Tracked** in `list_migrations`. |
| 033 | `033_taxonomy_4category_model.sql` | 2026-05-06 | abhay | Taxonomy 4-category L1/L2 model. `l1`, `l2`, `domain_tag`, `india_relevance` on `taxonomy_skills` with CHECK constraints. 5 indexes + partial unique. Bulk-inserts 1,419 net-new contemporary skills. source=`nexus_taxonomy_v2_2026_05`. |
| 037 | `037_taxonomy_legacy_backfill_and_regions.sql` | 2026-05-06 | abhay | Taxonomy legacy backfill + regions. `regions text[]` + GIN. Deterministic backfill l1/l2 for 8,887 legacy rows. Seeds regions from `india_relevance`. Replaces `get_taxonomy_stats()`. Final state then: 0 null l1, 10,307 total. (Today total taxonomy_skills = 41,630.) |
| 038 | `038_analyze_jd_runs_and_l2_to_l1.sql` | 2026-05-07 | jdenh001 | `analyze_jd_runs` table (pipeline call-level logging, 5 indexes) + `l2_to_l1_lookup` table (10-row L2→L1 seed). RLS: read=authenticated, write=admin. |
| 038b | `038b_upsert_skill_l1_l2.sql` | 2026-05-07 | jdenh001 | Extends upsert_skill() with optional p_l1/p_l2 params. Adds `find_similar_skill()` (pg_trgm) + `append_skill_alias()`. Enables `fuzzystrmatch`. GIN on aliases[] + trigram on name. |
| 039 | `039_campus_upload_batches.sql` | 2026-05-07 | jdenh001 | Campus upload batches. New table `campus_upload_batches` (id, college_id FK, program, job_type CHECK, drive_year, source, ctc_tag, status CHECK, uploaded_by FK auth.users, total_files, jds_committed, timestamps). `jobs.upload_batch_id` FK. 3 indexes. RLS: admin full; college_rep read+insert+update scoped to `restricted_college_ids`. |
| 040 | `040_job_pipeline_p2.sql` | 2026-05-13 | amb-jobs | Job Collection P2: `jobs.last_seen_at`, `role_match_score`, `discovery_source`. New tables: `discovered_titles` (unmatched harvested), `discovery_runs` (sweep run log). 6 indexes. RLS: read=authenticated, write=admin. |
| 041 | `041_discovered_titles_increment_rpc.sql` | 2026-05-13 | amb-jobs | `increment_discovered_title_counts(p_run_id, p_country, p_source)` SECURITY DEFINER. Supports discovery-harvest. EXECUTE to authenticated. |
| **042** | `042_college_regions.sql` | 2026-05-14 | cd-uowd14 | **Tracked**. `college_regions` table mapping colleges to `country_variant` strings as they appear in `jobs.country`. Cols: id, college_id FK, country_variant, country_label, is_primary, created_at. Unique on (college_id, country_variant). RLS: authenticated read, service_role full. Supports College Dashboard Live Jobs section. |
| **043** | `043_upsert_skill_external_id.sql` | 2026-05-14 | cd-uowd14 | **Tracked**. Adds external_id support to `upsert_skill()` for ETL/import flows. |
| 043b | `043_jobs_country_perf_idx.sql` | 2026-05-15 | cd-uowd14 | **(Also numbered 043 — duplicate file in repo, applied separately.)** Adds `idx_jobs_location_country` (partial, WHERE NOT NULL) and `idx_jobs_location_country_v2` (composite location_country + analysis_version='v2'). CONCURRENTLY. Eliminated 60s dashboard timeout. |
| **044** | `044_campus_excel_support.sql` | 2026-05-14 | cd-uowd14 | **Tracked**. Campus Excel ingest v2 support (`d1896da`) — extended schema for camjdbcab (`college_dashboard_share_tokens` table for replacing hardcoded `DEMO_SLUGS`; share-token issuance/validation flow). |

### Drift notes

- 2 files in repo numbered `043` — `043_upsert_skill_external_id.sql` (tracked) and `043_jobs_country_perf_idx.sql` (applied separately, not in tracker). Treat the perf-idx one as `043b` going forward; rename in repo at next opportunity.
- Migrations 014-024, 026, 027 etc. exist as SQL files but aren't in `list_migrations` (applied pre-tracker). Don't re-apply.

---

## Reservation queue (next)

| # | Reserved For | Reserved By | Status |
|---|---|---|---|
| 045 | Sentry release tagging table + audit_dashboard_events (Norms 6 + 10) | TBD | available |
| 046 | Open | TBD | available |
| 047 | Open | TBD | available |

---

## How to add a migration (current protocol)

1. Reserve a number here with status `in progress` + thread short_id.
2. Write SQL in `/migrations/<NNN>_<feature>.sql` (repo root, not `/tmp`).
3. **Always include a rollback block at the top.** Per Norm 7, destructive migrations require `pg_dump` first.
4. Apply via `supabase` MCP `apply_migration` OR `supabase db push` CLI. **Never via `execute_sql`.**
5. Verify with `list_migrations` and `get_advisors security` — baseline must remain 0 ERROR.
6. Move row to the main table above with applied date.
7. Update `/docs/STATUS.md` with a 1-line entry.
8. If RLS changed: update `/docs/RLS.md`.

## Conventions

- Always include rollback notes in a comment block at the top of the file.
- RLS additions must be documented in `RLS.md`.
- Renames + drops require explicit user approval — flag in tracker before applying.
- Destructive ops require pre-migration `pg_dump` per Norm 7.
- New RPC: explicit `REVOKE ALL FROM PUBLIC` then `GRANT EXECUTE TO authenticated, service_role` per Norm 4. `REVOKE FROM anon, authenticated` alone is a no-op.
