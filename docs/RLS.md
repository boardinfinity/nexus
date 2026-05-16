# Nexus — RLS Policy Log

Track every RLS addition/change here. RLS is **additive only**; never remove a policy without explicit approval.

> Per Norm 4 (Security First): every new table MUST have RLS enabled + tight policies. No `TO public USING(true)`. Every new RPC MUST explicitly `REVOKE ALL FROM PUBLIC` then `GRANT EXECUTE TO authenticated, service_role`.

---

## Current advisor baseline (2026-05-17)

| Level | Count | Detail |
|---|---|---|
| ERROR | **0** | ✅ baseline |
| WARN | 1 | `pg_trgm` extension in `public` schema — DEFERRED (moving breaks migrations 038b RPCs) |
| INFO | 38 | `rls_enabled_no_policy` on most app tables — **by design** for service-role-only architecture (zero client `.rpc()` calls; all reads via server). Documented expectation. |

The 38 INFO-level lints are a known pattern: every public-facing app table (`jobs`, `alumni`, `surveys`, `colleges`, etc.) has RLS enabled (so anon/authenticated can't read directly) but **no explicit policies** (because all reads route through the server with the service role). This is safe **as long as Norm 4 invariant holds: zero `.rpc()` from the client.**

If we ever decide to allow direct client reads (e.g., for a public widget), we must add explicit policies first.

---

## Reference tables (Intelligence Framework P1, migration 025)

- `job_functions`, `job_families`, `job_industries`: read-only for all authenticated users; write only for admin.

## Surveys (Survey Admin v2, migration 030)

- `surveys`: full read for editor/admin. SPOC (`college_rep`) can only see surveys whose `college_id` is in their `restricted_college_ids`. Enforcement is **server-authoritative** in code via `assertSurveyInScope`. Database RLS is layered on top for defense-in-depth.
- `survey_invites`, `survey_respondents`, `survey_responses`, `survey_skill_ratings`: same scoping pattern via FK to `surveys`.
- `email_queue`: server-only writes.

## Job Buckets (Bucketization, migration 031)

- `job_buckets`: Validated buckets (`status='validated'`) are visible to all authenticated users. Candidate buckets (`status='candidate'`) are hidden — visible only to admin/super_admin.
- `job_bucket_review_queue`: admin-only.
- `job_bucket_merge_history`: admin-only read.
- `job_bucket_evidence`, `job_bucket_skill_map`, `job_bucket_overlays`, `job_bucket_aliases`: public read for validated buckets; candidate-bucket rows hidden.

## JD Analysis runs (migration 038)

- `analyze_jd_runs`: read = authenticated, write = admin.
- `l2_to_l1_lookup`: read = authenticated, write = admin.

## Campus uploads (migration 039)

- `campus_upload_batches`: admin full access; `college_rep` read+insert+update scoped to their `restricted_college_ids`; **no DELETE policy for college_rep**.

## Job Pipeline P2 (migrations 040, 041)

- `discovered_titles`: read = authenticated, write = admin.
- `discovery_runs`: read = authenticated, write = admin.
- `increment_discovered_title_counts()` RPC: SECURITY DEFINER. EXECUTE granted to authenticated. **(Pre-dates Norm 4; should be tightened — revoke from PUBLIC, grant to authenticated + service_role explicitly.)**

## College Dashboard (migration 042)

- `college_regions`: authenticated read, service_role full.

## Skill ETL (migration 043)

- `upsert_skill()` extended with `external_id` — same grants as base function (SECURITY DEFINER, EXECUTE to authenticated).

## Campus Excel + share tokens (migration 044)

- `college_dashboard_share_tokens`: service-role only (server issues + validates tokens). **No client access.**
- `campus_excel_tasks`: admin full access; college_rep scoped via `restricted_college_ids`.
- `campus_vacancies`: admin full access; college_rep scoped via `restricted_college_ids`.

## Mutation paths (server-side enforcement)

- All bucket mutation paths require `editor` or `admin` permission (enforced server-side, not via RLS alone).
- Survey structural endpoints (`POST/PATCH/clone/parse-doc/generate`) are blocked for `college_rep` via `blockCollegeRep` middleware.
- Survey schema mutation is blocked once `surveys.locked_at` is set, except for label/copy edits (verified via `isOnlyLabelEdit` structural diff).
- Every new server route should apply `requireReader` (read) or `requireWriter` (write) per Norm 4.

---

## Storage buckets

- All buckets are **private by default** (per Norm 4). Public access only via signed URLs.
- Document any new bucket here with: name, purpose, RLS on `storage.objects` for that bucket prefix.

---

## Audit logging (Norm 10 — pending)

- `audit_dashboard_events` table reserved for migration 045. Will log every public-dashboard view + share-token use (who, what, when, IP).

---

## Adding/changing a policy

1. Document the existing policy here before changing it.
2. Write the change in a migration (NEVER ad-hoc via dashboard for production).
3. Test with an `auth.uid()` mock or a test user.
4. Run `get_advisors security` and confirm baseline is preserved (0 ERROR, ≤1 WARN).
5. Update this file.
6. Update `/docs/STATUS.md`.
