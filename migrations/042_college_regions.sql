-- =============================================================================
-- Migration 042 — college_regions (college → country variants mapping)
-- Author:    cd-uowd14
-- Date:      2026-05-15
-- Purpose:   Store the country variants each college recruits from / cares
--            about, so the College Dashboard "Live Jobs" section can filter
--            jobs by country without a hard-coded list inside each route.
--
--            Stores raw country variants (strings as they appear in
--            jobs.country) — Option A. e.g. UOWD covers UAE/GCC, so it gets
--            rows for "United Arab Emirates", "UAE", "Dubai", "Saudi Arabia",
--            "Qatar", "Oman", "Bahrain", "Kuwait", etc.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.college_regions;
-- =============================================================================

BEGIN;

-- 1. Table
CREATE TABLE IF NOT EXISTS public.college_regions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  country_variant text NOT NULL,
  country_label   text NOT NULL,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.college_regions ENABLE ROW LEVEL SECURITY;

-- 2. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_college_regions_college_variant
  ON public.college_regions (college_id, country_variant);

CREATE INDEX IF NOT EXISTS idx_college_regions_college
  ON public.college_regions (college_id);

CREATE INDEX IF NOT EXISTS idx_college_regions_country_label
  ON public.college_regions (country_label);

-- 3. RLS policies
--    Admin full access; authenticated users get read (needed for dashboard).
--    Service role bypasses RLS, so the API can read/write freely.
CREATE POLICY "college_regions_authenticated_read"
  ON public.college_regions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "college_regions_service_role_full"
  ON public.college_regions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
