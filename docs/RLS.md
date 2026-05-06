# Nexus — RLS Policy Log

Track every RLS addition/change here. RLS is **additive only**; never remove a policy without explicit approval.

---

## Reference tables (Intelligence Framework P1)

- `job_functions`, `job_families`, `job_industries`: read-only for all authenticated users; write only for admin.

## Surveys (Survey Admin v2)

- `surveys`: full read for editor/admin. SPOC (`college_rep`) can only see surveys whose `college_id` is in their `restricted_college_ids`. Enforcement is **server-authoritative** in code via `assertSurveyInScope`. Database RLS is layered on top for defense-in-depth.
- `survey_invites`, `survey_respondents`, `survey_responses`, `survey_skill_ratings`: same scoping pattern via FK to `surveys`.
- `email_queue`: server-only writes.

## Job Buckets (Bucketization Phase 1)

- `job_buckets`: Validated buckets (`status='validated'`) are visible to all authenticated users. Candidate buckets (`status='candidate'`) are hidden — visible only to admin/super_admin.
- `job_bucket_review_queue`: admin-only.
- `job_bucket_merge_history`: admin-only read.
- `job_bucket_evidence`, `job_bucket_skill_map`, `job_bucket_overlays`, `job_bucket_aliases`: public read for validated buckets; candidate-bucket rows hidden.

## Mutation paths

- All bucket mutation paths require `editor` or `admin` permission (enforced server-side, not via RLS alone).
- Survey structural endpoints (`POST/PATCH/clone/parse-doc/generate`) are blocked for `college_rep` via `blockCollegeRep` middleware.
- Survey schema mutation is blocked once `surveys.locked_at` is set, except for label/copy edits (verified via `isOnlyLabelEdit` structural diff).

---

## Adding/changing a policy

1. Document the existing policy here before changing it.
2. Write the change in a migration (NEVER ad-hoc via dashboard for production).
3. Test with an `auth.uid()` mock or a test user.
4. Update this file.
5. Update `/docs/STATUS.md`.
