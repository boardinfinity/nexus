# Nexus — Migration Log

**The next migration number is: `032`** (reserve before writing SQL).

| # | File | Date | Author | Summary |
|---|---|---|---|---|
| 025 | `025_intelligence_framework.sql` | 2026-04-09 | abhay | 12 cols on jobs (job_function, job_family, job_industry, bucket, sub_role, experience_min/max, education_req, jd_quality, confidence, analysis_version, analyzed_at). 8 cols on taxonomy_skills (status, mention_count, company_count, parent_skill_id, aliases, is_auto_created, validated_at, first_seen_at). 2 cols on job_skills (is_required, skill_tier). Reference tables: job_functions (26), job_families (20), job_industries (15). upsert_skill() + validate_skills() SECURITY DEFINER functions. 8 indexes. RLS on reference tables. |
| 026 | `026_*.sql` | — | — | (reserve / placeholder — fill in actual content) |
| 027 | `027_job_roles.sql` | 2026-04-14 | abhay | `job_roles` table (84 roles, 791 synonyms imported from Airtable) + `jobs.job_role_id` FK. |
| 028 | `028_jobs_richer_fields.sql` | 2026-04-14 | abhay | `is_remote`, `job_publisher`, `apply_platforms`, `qualifications[]`, `responsibilities[]`, `benefits[]`, `salary_text`, `title_normalized`, `company_name_normalized` on jobs. |
| 029 | `029_colleges_extension.sql` | 2026-04-15 | abhay | `degree_level`, `ranking_source`, `ranking_year`, `ranking_score`, `linkedin_slug` on colleges + NIRF MBA Top 50 seed. |
| 030 | `030_survey_admin_v2.sql` | 2026-04-29 | abhay | New tables: `surveys`, `survey_invites`, `email_queue`. FK-bind `survey_respondents.survey_id`, `survey_responses.survey_id`, `survey_skill_ratings.survey_id` (NOT NULL). Unique on `(survey_id, lower(email))` for invites + respondents. Legacy v1 archived row preserved (`00000000-0000-0000-0000-00000000beef`). |
| 031 | `031_job_buckets_phase1.sql` | 2026-04-30 | abhay | Bucketization Phase 0/1. Adds `jobs.standardized_title`, `jobs.company_type`, `jobs.geography`, `jobs.bucket_id`, `jobs.bucket_match_confidence`, `jobs.bucket_match_reason`, `jobs.bucket_status_at_assignment`. New tables: `job_buckets`, `job_bucket_aliases`, `job_bucket_evidence`, `job_bucket_skill_map`, `job_bucket_overlays`, `job_bucket_review_queue`, `job_bucket_merge_history`. RLS hides candidate buckets from non-admin users. |

---

## Reservation queue (next)

| # | Reserved For | Reserved By | Status |
|---|---|---|---|
| 032 | Alumni Insights core | TBD | available |
| 033 | Alumni Insights seed | TBD | available |
| 034 | Bucket validation cycle audit columns | TBD | available |

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
