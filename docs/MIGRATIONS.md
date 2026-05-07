# Nexus — Migration Log

**The next migration number is: `040`** (reserve before writing SQL).

| # | File | Date | Author | Summary |
|---|---|---|---|---|
| 025 | `025_intelligence_framework.sql` | 2026-04-09 | abhay | 12 cols on jobs (job_function, job_family, job_industry, bucket, sub_role, experience_min/max, education_req, jd_quality, confidence, analysis_version, analyzed_at). 8 cols on taxonomy_skills (status, mention_count, company_count, parent_skill_id, aliases, is_auto_created, validated_at, first_seen_at). 2 cols on job_skills (is_required, skill_tier). Reference tables: job_functions (26), job_families (20), job_industries (15). upsert_skill() + validate_skills() SECURITY DEFINER functions. 8 indexes. RLS on reference tables. |
| 026 | `026_*.sql` | — | — | (reserve / placeholder — fill in actual content) |
| 027 | `027_job_roles.sql` | 2026-04-14 | abhay | `job_roles` table (84 roles, 791 synonyms imported from Airtable) + `jobs.job_role_id` FK. |
| 028 | `028_jobs_richer_fields.sql` | 2026-04-14 | abhay | `is_remote`, `job_publisher`, `apply_platforms`, `qualifications[]`, `responsibilities[]`, `benefits[]`, `salary_text`, `title_normalized`, `company_name_normalized` on jobs. |
| 029 | `029_colleges_extension.sql` | 2026-04-15 | abhay | `degree_level`, `ranking_source`, `ranking_year`, `ranking_score`, `linkedin_slug` on colleges + NIRF MBA Top 50 seed. |
| 030 | `030_survey_admin_v2.sql` | 2026-04-29 | abhay | New tables: `surveys`, `survey_invites`, `email_queue`. FK-bind `survey_respondents.survey_id`, `survey_responses.survey_id`, `survey_skill_ratings.survey_id` (NOT NULL). Unique on `(survey_id, lower(email))` for invites + respondents. Legacy v1 archived row preserved (`00000000-0000-0000-0000-00000000beef`). |
| 031 | `031_job_buckets_phase1.sql` | 2026-04-30 | abhay | Bucketization Phase 0/1. Adds `jobs.standardized_title`, `jobs.company_type`, `jobs.geography`, `jobs.bucket_id`, `jobs.bucket_match_confidence`, `jobs.bucket_match_reason`, `jobs.bucket_status_at_assignment`. New tables: `job_buckets`, `job_bucket_aliases`, `job_bucket_evidence`, `job_bucket_skill_map`, `job_bucket_overlays`, `job_bucket_review_queue`, `job_bucket_merge_history`. RLS hides candidate buckets from non-admin users. |
| 032 | `032_survey_status_published.sql` | — | — | (already in repo — backfill summary when known) |
| 033 | `033_taxonomy_4category_model.sql` | 2026-05-06 | abhay | Taxonomy 4-category L1/L2 model. Adds `l1`, `l2`, `domain_tag`, `india_relevance` cols on `taxonomy_skills` with CHECK constraints (4-value l1 enum, 10-value l2 enum, valid l1+l2 pair, domain enum, india enum). 5 indexes + 1 partial unique index for v2 batch. Bulk-inserts 1,419 net-new contemporary skills (AI/ML 413, Modern SWE 351, Business/Ops 406, EdTech 173, Cross-cutting 79; 143 India-tagged). Existing 8,887 legacy rows untouched. source=`nexus_taxonomy_v2_2026_05`. |
| 037 | `037_taxonomy_legacy_backfill_and_regions.sql` | 2026-05-06 | abhay | Taxonomy legacy backfill + regions. Adds `regions text[]` column on `taxonomy_skills` + GIN index. Bulk deterministic backfill of `l1`/`l2` for 8,887 legacy rows (technology→TECHNICAL SKILLS/Tool, skill→COMPETENCIES/Skill, ability→COMPETENCIES/Ability, knowledge→KNOWLEDGE/Knowledge). Seeds `regions` from `india_relevance` (india_specific→[India], india_strong→[India,Global], else→[Global]). Replaces `get_taxonomy_stats()` to return `by_l1`, `by_l2` (nested), `by_region`. Final state: 0 null l1, 0 null regions, 10,307 total. |

---

## Reservation queue (next)

| # | Reserved For | Reserved By | Status |
|---|---|---|---|
| 034 | Alumni Insights core (re-reserve) | TBD | available |
| 035 | Alumni Insights seed (re-reserve) | TBD | available |
| 036 | Bucket validation cycle audit columns | TBD | available |
| 038 | `038_analyze_jd_runs_and_l2_to_l1.sql` | 2026-05-07 | jdenh001 (Track A) | analyze_jd_runs table (pipeline call-level logging, 5 indexes) + l2_to_l1_lookup table (10-row L2→L1 seed). RLS: read=authenticated, write=admin. NOT applied yet — pending user CLI apply. |
| 038b | `038b_upsert_skill_l1_l2.sql` | 2026-05-07 | jdenh001 (Track B) | Extends upsert_skill() with optional p_l1/p_l2 params (backwards compat). Adds find_similar_skill() RPC (pg_trgm similarity pre-filter) and append_skill_alias() RPC (fuzzy-merge alias append + mention_count increment). Enables fuzzystrmatch extension. GIN index on aliases[] + trigram index on name. NOT applied yet — pending user CLI apply. |
| 039 | campus_upload_batches + jobs.upload_batch_id FK | jdenh001 | reserved (in progress) |
| 040 | _(open)_ | TBD | available |

> Note: Two earlier migration files exist for Alumni Insights as `0001_alumni_insights_core.sql` and `0002_alumni_insights_seed.sql`. Before applying, decide whether to renumber to fit the main sequence (032/033) or keep as a separate alumni_insights namespace.

---

## How to add a migration

1. Check this file for the next number.
2. Add a row in the Reservation queue with status "in progress" + your thread short_id.
3. Write SQL in `/tmp/nexus-amb/migrations/<NNN>_<feature>.sql`.
4. Apply via Supabase CLI/dashboard (NOT via execute_sql).
5. Once applied, move the row up to the main table with the date and summary.
6. Update `/docs/STATUS.md` with a new entry.

---

## Conventions

- Always include rollback notes in a comment block at the top of the file.
- RLS additions must be documented in `/docs/RLS.md`.
- Renames + drops require explicit user approval — flag in tracker before applying.
