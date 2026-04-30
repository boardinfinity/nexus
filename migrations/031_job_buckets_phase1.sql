-- Migration 031: Job Buckets — Phase 0/1 Schema Foundation
--
-- Goal: introduce a normalized job bucket entity, plus the supporting
-- aliases / evidence / skill-map / overlay / review-queue / merge-history
-- tables, and add the formalized classification + bucket linkage columns
-- on the `jobs` table.
--
-- Non-destructive: keeps legacy `jobs.bucket` text column untouched.
-- Idempotent: uses IF NOT EXISTS / ON CONFLICT throughout so it can be
-- re-applied safely.
--
-- Design notes
-- ─────────────
-- * `job_buckets` is the canonical role-archetype entity. References to
--   `job_functions(id)`, `job_families(id)`, `job_industries(id)` are
--   text-keyed and follow the patterns introduced by migration 025.
-- * `bucket_id` on `jobs` is nullable and ON DELETE SET NULL so removing
--   a bucket never cascades into job rows.
-- * Status is a free `text` column with a CHECK constraint instead of a
--   PG ENUM, matching migration 016's "enum -> text" convention.
-- * RLS mirrors migration 025: authenticated SELECT for read tables,
--   service role for writes (we keep writes to the API/server using the
--   service-role key as is done elsewhere in this codebase).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Formalized classification + bucket linkage columns on `jobs`
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS standardized_title          text,
  ADD COLUMN IF NOT EXISTS company_type                text,
  ADD COLUMN IF NOT EXISTS geography                   text,
  ADD COLUMN IF NOT EXISTS classification_raw          jsonb,
  ADD COLUMN IF NOT EXISTS classification_reason       text,
  ADD COLUMN IF NOT EXISTS bucket_id                   uuid,
  ADD COLUMN IF NOT EXISTS bucket_match_confidence     numeric(4,3),
  ADD COLUMN IF NOT EXISTS bucket_match_reason         jsonb,
  ADD COLUMN IF NOT EXISTS bucket_status_at_assignment text,
  ADD COLUMN IF NOT EXISTS bucket_assigned_at          timestamptz;

-- Note: legacy `jobs.bucket` (free-text) is intentionally preserved.

-- ─────────────────────────────────────────────────────────────────────
-- 2. Canonical bucket table
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_buckets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_code         text UNIQUE NOT NULL,
  name                text NOT NULL,
  description         text,
  bucket_scope        text NOT NULL DEFAULT 'cross_program',
  function_id         text REFERENCES job_functions(id),
  family_id           text REFERENCES job_families(id),
  industry_id         text REFERENCES job_industries(id),
  seniority_level     text,
  standardized_title  text,
  company_type        text,
  geography_scope     text,
  nature_of_work      text,
  exclusion_rules     text[] DEFAULT '{}',
  status              text NOT NULL DEFAULT 'candidate',
  confidence_threshold numeric(4,3) DEFAULT 0.750,
  mention_count       integer DEFAULT 0,
  company_count       integer DEFAULT 0,
  evidence_count      integer DEFAULT 0,
  source              text,
  first_seen_at       timestamptz DEFAULT now(),
  validated_at        timestamptz,
  validated_by        text,
  deprecated_at       timestamptz,
  merged_into_id      uuid REFERENCES job_buckets(id),
  created_by          text,
  updated_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT job_buckets_status_chk
    CHECK (status IN ('candidate', 'validated', 'deprecated', 'merged'))
);

-- Now that `job_buckets` exists, finalize the FK from `jobs.bucket_id`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_bucket_id_fkey'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_bucket_id_fkey
      FOREIGN KEY (bucket_id) REFERENCES job_buckets(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Aliases (title variants)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   uuid NOT NULL REFERENCES job_buckets(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  alias_norm  text NOT NULL,
  source      text,
  confidence  numeric(4,3) DEFAULT 1.000,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (bucket_id, alias_norm)
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Evidence (JDs / companies that support a bucket)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id     uuid NOT NULL REFERENCES job_buckets(id) ON DELETE CASCADE,
  job_id        uuid REFERENCES jobs(id) ON DELETE SET NULL,
  company_name  text,
  match_score   numeric(4,3),
  match_reason  jsonb,
  evidence_type text DEFAULT 'jd_match',
  created_at    timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Skill map (bucket × child taxonomy skill)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_skill_map (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id           uuid NOT NULL REFERENCES job_buckets(id) ON DELETE CASCADE,
  taxonomy_skill_id   uuid NOT NULL REFERENCES taxonomy_skills(id) ON DELETE CASCADE,
  requirement_type    text DEFAULT 'required',
  required_level      smallint,
  evidence_source     text,
  confidence          numeric(4,3) DEFAULT 0.700,
  program_overlay_id  uuid,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (bucket_id, taxonomy_skill_id, program_overlay_id),
  CONSTRAINT job_bucket_skill_map_req_type_chk
    CHECK (requirement_type IN ('required', 'preferred', 'nice_to_have'))
);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Overlays (program / college / geography variants)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_overlays (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id           uuid NOT NULL REFERENCES job_buckets(id) ON DELETE CASCADE,
  overlay_type        text NOT NULL,
  program_type        text,
  college_segment     text,
  geography           text,
  access_level        smallint,
  ctc_min             numeric(12,2),
  ctc_median          numeric(12,2),
  ctc_max             numeric(12,2),
  ctc_currency        text DEFAULT 'INR',
  hiring_process      text,
  prep_focus          text,
  ideal_profile       text,
  question_bank_refs  text[],
  evidence_count      integer DEFAULT 0,
  metadata            jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT job_bucket_overlays_type_chk
    CHECK (overlay_type IN ('program', 'college', 'geography', 'cohort'))
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. Review queue (candidate buckets and ambiguous matches)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_review_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id         uuid REFERENCES job_buckets(id) ON DELETE SET NULL,
  job_id            uuid REFERENCES jobs(id) ON DELETE SET NULL,
  reason            text NOT NULL,
  proposed_action   text,
  candidates        jsonb,
  match_score       numeric(4,3),
  classification    jsonb,
  status            text NOT NULL DEFAULT 'pending',
  assigned_to       text,
  resolution        text,
  resolved_at       timestamptz,
  resolved_by       text,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT job_bucket_review_status_chk
    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'merged', 'needs_more_data'))
);

-- ─────────────────────────────────────────────────────────────────────
-- 8. Merge / deprecation history
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_bucket_merge_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_bucket_id  uuid REFERENCES job_buckets(id) ON DELETE SET NULL,
  target_bucket_id  uuid REFERENCES job_buckets(id) ON DELETE SET NULL,
  action            text NOT NULL,
  notes             text,
  performed_by      text,
  performed_at      timestamptz DEFAULT now(),
  CONSTRAINT job_bucket_merge_action_chk
    CHECK (action IN ('merge', 'deprecate', 'rename', 'restore'))
);

-- ─────────────────────────────────────────────────────────────────────
-- 9. Indexes
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_jobs_bucket_id              ON jobs(bucket_id);
CREATE INDEX IF NOT EXISTS idx_jobs_bucket_status_at_assignment ON jobs(bucket_status_at_assignment);
CREATE INDEX IF NOT EXISTS idx_jobs_standardized_title     ON jobs(standardized_title);
CREATE INDEX IF NOT EXISTS idx_jobs_geography              ON jobs(geography);
CREATE INDEX IF NOT EXISTS idx_jobs_company_type           ON jobs(company_type);

CREATE INDEX IF NOT EXISTS idx_job_buckets_status          ON job_buckets(status);
CREATE INDEX IF NOT EXISTS idx_job_buckets_function        ON job_buckets(function_id);
CREATE INDEX IF NOT EXISTS idx_job_buckets_family          ON job_buckets(family_id);
CREATE INDEX IF NOT EXISTS idx_job_buckets_industry        ON job_buckets(industry_id);
CREATE INDEX IF NOT EXISTS idx_job_buckets_scope           ON job_buckets(bucket_scope);
CREATE INDEX IF NOT EXISTS idx_job_buckets_geo             ON job_buckets(geography_scope);
CREATE INDEX IF NOT EXISTS idx_job_buckets_seniority       ON job_buckets(seniority_level);

CREATE INDEX IF NOT EXISTS idx_job_bucket_aliases_norm     ON job_bucket_aliases(alias_norm);
CREATE INDEX IF NOT EXISTS idx_job_bucket_aliases_bucket   ON job_bucket_aliases(bucket_id);

CREATE INDEX IF NOT EXISTS idx_job_bucket_evidence_bucket  ON job_bucket_evidence(bucket_id);
CREATE INDEX IF NOT EXISTS idx_job_bucket_evidence_job     ON job_bucket_evidence(job_id);
CREATE INDEX IF NOT EXISTS idx_job_bucket_evidence_company ON job_bucket_evidence(company_name);

CREATE INDEX IF NOT EXISTS idx_job_bucket_skill_map_bucket ON job_bucket_skill_map(bucket_id);
CREATE INDEX IF NOT EXISTS idx_job_bucket_skill_map_skill  ON job_bucket_skill_map(taxonomy_skill_id);

CREATE INDEX IF NOT EXISTS idx_job_bucket_overlays_bucket  ON job_bucket_overlays(bucket_id);
CREATE INDEX IF NOT EXISTS idx_job_bucket_overlays_program ON job_bucket_overlays(program_type);
CREATE INDEX IF NOT EXISTS idx_job_bucket_overlays_geo     ON job_bucket_overlays(geography);

CREATE INDEX IF NOT EXISTS idx_job_bucket_review_status    ON job_bucket_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_bucket_review_bucket    ON job_bucket_review_queue(bucket_id);

CREATE INDEX IF NOT EXISTS idx_job_bucket_merge_target     ON job_bucket_merge_history(target_bucket_id);
CREATE INDEX IF NOT EXISTS idx_job_bucket_merge_source     ON job_bucket_merge_history(source_bucket_id);

-- ─────────────────────────────────────────────────────────────────────
-- 10. Row Level Security
-- ─────────────────────────────────────────────────────────────────────
-- Pattern follows migration 025: authenticated users can SELECT, but
-- writes go through the API using the service_role key (which bypasses
-- RLS). Candidate buckets are filtered out of the read policy so that
-- regular authenticated clients only see validated rows. The service
-- role / admin paths in the API will read `job_buckets` directly via
-- supabase-js, which uses the service-role key and bypasses RLS.

ALTER TABLE job_buckets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_aliases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_evidence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_skill_map     ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_overlays      ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_review_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bucket_merge_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_buckets'
      AND policyname = 'auth_read_job_buckets_validated'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "auth_read_job_buckets_validated"
      ON job_buckets FOR SELECT TO authenticated
      USING (status = 'validated')
    $POL$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_bucket_aliases'
      AND policyname = 'auth_read_job_bucket_aliases'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "auth_read_job_bucket_aliases"
      ON job_bucket_aliases FOR SELECT TO authenticated USING (true)
    $POL$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_bucket_skill_map'
      AND policyname = 'auth_read_job_bucket_skill_map'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "auth_read_job_bucket_skill_map"
      ON job_bucket_skill_map FOR SELECT TO authenticated USING (true)
    $POL$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_bucket_overlays'
      AND policyname = 'auth_read_job_bucket_overlays'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "auth_read_job_bucket_overlays"
      ON job_bucket_overlays FOR SELECT TO authenticated USING (true)
    $POL$;
  END IF;
END$$;

-- Evidence, review queue, and merge history are admin/service-role only;
-- no SELECT policy is created for `authenticated`, so anon/auth clients
-- cannot read them by default.
