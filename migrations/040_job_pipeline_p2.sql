-- =============================================================================
-- Migration 040 — Job Collection Pipeline P2
-- Author:    amb-jobs-pipeline (Abhay)
-- Date:      2026-05-13
-- Purpose:   Schema support for job freshness, role-match scoring, and the
--            discovery sweep engine (12 domain keywords + ~20 industry queries
--            running in parallel with the bulk collection).
--
-- Adds (additive only — no drops, no renames):
--   1. jobs.last_seen_at         timestamptz  — most recent observation of this job
--   2. jobs.role_match_score     numeric(3,2) — 0.30 to 1.00 (already computed
--                                               in code, currently stored in
--                                               raw_data._role_match_score)
--   3. jobs.discovery_source     text         — NULL for bulk; 'domain_sweep' or
--                                               'industry_sweep:<industry>' for
--                                               discovery-engine rows
--   4. discovered_titles         table        — unmatched titles harvested from
--                                               discovery sweeps; feed into
--                                               weekly review for new job family
--                                               candidates
--   5. discovery_runs            table        — run log for sweep executions
--                                               (one row per sweep query)
--
-- Indexes: 6 total (3 on jobs, 2 on discovered_titles, 1 on discovery_runs).
-- RLS:     read=authenticated, write=admin (consistent with M038/M039 pattern).
--
-- Rollback:
--   ALTER TABLE jobs DROP COLUMN IF EXISTS last_seen_at;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS role_match_score;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS discovery_source;
--   DROP INDEX IF EXISTS idx_jobs_last_seen_at;
--   DROP INDEX IF EXISTS idx_jobs_role_match_score;
--   DROP INDEX IF EXISTS idx_jobs_discovery_source;
--   DROP TABLE IF EXISTS discovered_titles;
--   DROP TABLE IF EXISTS discovery_runs;
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. jobs columns
-- -----------------------------------------------------------------------------

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS last_seen_at      timestamptz,
  ADD COLUMN IF NOT EXISTS role_match_score  numeric(3,2),
  ADD COLUMN IF NOT EXISTS discovery_source  text;

COMMENT ON COLUMN jobs.last_seen_at IS
  'Most recent timestamp this job was observed by any collection run. Updated on every successful insert or re-fetch. Drives auto-close logic (deferred feature).';

COMMENT ON COLUMN jobs.role_match_score IS
  'Title-to-role confidence in [0.30, 1.00]. 1.00=exact synonym match, 0.80=substring, 0.60=token overlap, 0.30=fallback. Computed by computeRoleMatchScore() in api/lib/helpers.ts.';

COMMENT ON COLUMN jobs.discovery_source IS
  'NULL for bulk-pipeline rows. Set to "domain_sweep" or "industry_sweep:<industry>" when harvested by the discovery engine. Used to segregate exploratory vs targeted runs.';

CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at
  ON jobs (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_jobs_role_match_score
  ON jobs (role_match_score DESC NULLS LAST)
  WHERE role_match_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_discovery_source
  ON jobs (discovery_source)
  WHERE discovery_source IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. discovery_runs — one row per sweep query execution
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_runs (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type          text           NOT NULL CHECK (run_type IN ('domain', 'industry')),
  country           text           NOT NULL,         -- 'UAE' | 'Saudi' | 'India'
  query             text           NOT NULL,         -- e.g. 'engineer' or 'fintech'
  source            text           NOT NULL DEFAULT 'linkedin' CHECK (source IN ('linkedin', 'google_jobs')),
  pipeline_run_id   uuid           REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  jobs_found        integer        NOT NULL DEFAULT 0,
  new_titles        integer        NOT NULL DEFAULT 0,  -- titles not in job_roles or its synonyms
  status            text           NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  error_message     text,
  started_at        timestamptz    NOT NULL DEFAULT NOW(),
  finished_at       timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE discovery_runs IS
  'Sweep engine run log. One row per (run_type, country, query) execution. Feeds into discovered_titles via the run_id linkage.';

CREATE INDEX IF NOT EXISTS idx_discovery_runs_country_started_at
  ON discovery_runs (country, started_at DESC);

-- -----------------------------------------------------------------------------
-- 3. discovered_titles — unmatched titles harvested by sweeps
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovered_titles (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text          NOT NULL,
  normalized_title    text          NOT NULL,
  country             text          NOT NULL,        -- 'UAE' | 'Saudi' | 'India'
  source              text          NOT NULL DEFAULT 'linkedin' CHECK (source IN ('linkedin', 'google_jobs')),
  run_id              uuid          REFERENCES discovery_runs(id) ON DELETE SET NULL,
  observed_count      integer       NOT NULL DEFAULT 1,
  status              text          NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'promoted', 'ignored', 'merged')),
  promoted_role_id    uuid          REFERENCES job_roles(id) ON DELETE SET NULL,
  notes               text,
  first_seen_at       timestamptz   NOT NULL DEFAULT NOW(),
  last_seen_at        timestamptz   NOT NULL DEFAULT NOW(),
  reviewed_at         timestamptz,
  reviewed_by         uuid,
  CONSTRAINT discovered_titles_unique_per_country_source
    UNIQUE (normalized_title, country, source)
);

COMMENT ON TABLE discovered_titles IS
  'Titles harvested by the discovery sweep engine that do not match any existing job_role name or synonym. Reviewed weekly; candidates become new job_roles or merge into existing ones.';

COMMENT ON COLUMN discovered_titles.status IS
  'candidate=new, awaiting review. promoted=converted to a new job_roles row (promoted_role_id set). ignored=rejected (noise / off-domain). merged=mapped as a synonym onto an existing job_role (promoted_role_id set).';

CREATE INDEX IF NOT EXISTS idx_discovered_titles_status_observed
  ON discovered_titles (status, observed_count DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_titles_country_last_seen
  ON discovered_titles (country, last_seen_at DESC);

-- -----------------------------------------------------------------------------
-- 4. RLS — read=authenticated, write=admin (consistent with M038/M039)
-- -----------------------------------------------------------------------------

ALTER TABLE discovery_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_titles    ENABLE ROW LEVEL SECURITY;

-- discovery_runs policies
DROP POLICY IF EXISTS discovery_runs_select_authenticated ON discovery_runs;
CREATE POLICY discovery_runs_select_authenticated
  ON discovery_runs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS discovery_runs_admin_write ON discovery_runs;
CREATE POLICY discovery_runs_admin_write
  ON discovery_runs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'admin'
    )
  );

-- discovered_titles policies
DROP POLICY IF EXISTS discovered_titles_select_authenticated ON discovered_titles;
CREATE POLICY discovered_titles_select_authenticated
  ON discovered_titles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS discovered_titles_admin_write ON discovered_titles;
CREATE POLICY discovered_titles_admin_write
  ON discovered_titles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nexus_users
      WHERE nexus_users.id = auth.uid()
        AND nexus_users.role = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Backfill role_match_score from existing raw_data._role_match_score
--    (P1 has already been writing this into raw_data; this surfaces it.)
-- -----------------------------------------------------------------------------

UPDATE jobs
SET role_match_score = CAST(raw_data ->> '_role_match_score' AS numeric(3,2))
WHERE role_match_score IS NULL
  AND raw_data ? '_role_match_score'
  AND (raw_data ->> '_role_match_score') ~ '^[0-9]+(\.[0-9]+)?$';

-- Optionally seed last_seen_at = posted_at where unset
UPDATE jobs
SET last_seen_at = COALESCE(posted_at, created_at)
WHERE last_seen_at IS NULL;

COMMIT;
