-- ============================================================
-- Migration 038: analyze_jd_runs (call-level logging) + l2_to_l1_lookup
-- Author:  Track A / thread jdenh001
-- Date:    2026-05-07
-- Depends: 037_taxonomy_legacy_backfill_and_regions
--
-- ROLLBACK NOTES
-- --------------
-- Run the following to undo this migration:
--
--   DROP TABLE IF EXISTS public.analyze_jd_runs;
--   DROP TABLE IF EXISTS public.l2_to_l1_lookup;
--
-- Then re-enable any downstream FK references that were added
-- referencing these tables (none exist yet in 038 scope).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. analyze_jd_runs — one row per call into the unified pipeline
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analyze_jd_runs (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source of the request
  source            text         NOT NULL
                    CHECK (source IN ('manual_single', 'async_batch', 'bulk_upload', 'campus_upload')),

  -- Optional FK to the jobs table (nullable — paste-only calls have no job yet)
  job_id            uuid         REFERENCES public.jobs(id) ON DELETE SET NULL,

  -- Batch grouping key (e.g. OpenAI batch_id or campus upload session uuid)
  batch_id          text,

  -- Lifecycle status
  status            text         NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),

  -- Input diagnostics
  input_chars       integer,
  model             text,
  prompt_version    text,

  -- Timing
  latency_ms        integer,

  -- Skill extraction counts
  skills_extracted  integer,
  skills_new        integer,

  -- Bucket resolution results
  bucket_match      text,
  bucket_confidence numeric(5,4),

  -- Partial-enrichment flag
  -- TRUE when ≥1 of {function, family, industry, bucket, skill_count < 3} is NULL
  was_partial       boolean      NOT NULL DEFAULT false,

  -- Error details (populated on failure or partial)
  error_message     text,

  -- Audit
  created_by        uuid,          -- Supabase auth.uid() at call time
  created_at        timestamptz  NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

-- Indexes for the Track E dashboard and filtering
CREATE INDEX IF NOT EXISTS idx_analyze_jd_runs_created_at
  ON public.analyze_jd_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analyze_jd_runs_source
  ON public.analyze_jd_runs (source);

CREATE INDEX IF NOT EXISTS idx_analyze_jd_runs_status
  ON public.analyze_jd_runs (status);

CREATE INDEX IF NOT EXISTS idx_analyze_jd_runs_job_id
  ON public.analyze_jd_runs (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyze_jd_runs_batch_id
  ON public.analyze_jd_runs (batch_id)
  WHERE batch_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 2. l2_to_l1_lookup — deterministic L2 → L1 mapping
--    Seeded from the prompt's category enum (see CONTEXT.md)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.l2_to_l1_lookup (
  l2   text  PRIMARY KEY,
  l1   text  NOT NULL
);

-- Seed (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO public.l2_to_l1_lookup (l2, l1) VALUES
  -- TECHNICAL SKILLS
  ('Technology',   'TECHNICAL SKILLS'),
  ('Tool',         'TECHNICAL SKILLS'),
  ('Methodology',  'TECHNICAL SKILLS'),
  ('Language',     'TECHNICAL SKILLS'),
  -- KNOWLEDGE
  ('Knowledge',    'KNOWLEDGE'),
  ('Domain',       'KNOWLEDGE'),
  -- COMPETENCIES
  ('Skill',        'COMPETENCIES'),
  ('Competency',   'COMPETENCIES'),
  ('Ability',      'COMPETENCIES'),
  -- CREDENTIAL
  ('Certification','CREDENTIAL')
ON CONFLICT (l2) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. RLS policies
-- ────────────────────────────────────────────────────────────

-- analyze_jd_runs
ALTER TABLE public.analyze_jd_runs ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all runs (for Track E dashboard)
CREATE POLICY "read_all_authenticated_analyze_jd_runs"
  ON public.analyze_jd_runs FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can INSERT / UPDATE / DELETE
CREATE POLICY "admin_write_analyze_jd_runs"
  ON public.analyze_jd_runs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'super_admin')
    )
  );

-- Service-role bypass for API writes (SECURITY DEFINER path via API)
-- The API server uses the service_role key so RLS is bypassed server-side;
-- the policies above protect direct user access.

-- l2_to_l1_lookup
ALTER TABLE public.l2_to_l1_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all_authenticated_l2_to_l1"
  ON public.l2_to_l1_lookup FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_write_l2_to_l1"
  ON public.l2_to_l1_lookup FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'super_admin')
    )
  );
