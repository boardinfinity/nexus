-- Migration 043: College Dashboard perf — index UAE/GCC jobs scans
--
-- Context (cd-uowd14, 2026-05-15):
--   /api/public/college-dashboard/by-slug/uowd-9k3xr2vp times out at 60s.
--   Root cause: buildDashboardPayload pulls ~9k UAE/GCC rows from `jobs`
--   filtered by `location_country IN (...)` (15 variants). Without an index
--   on `location_country`, Postgres seq-scans the 21k-row table on every
--   dashboard load → trips statement_timeout under any load → cascading 522s
--   from the REST gateway.
--
--   Code already parallelized (commit 6a88746) but the underlying scan
--   remains the bottleneck.
--
-- Apply method: CREATE INDEX CONCURRENTLY — no table lock, safe in prod.
-- Must be run OUTSIDE a transaction. In Supabase SQL Editor:
--   - Toggle "Run as single transaction" OFF, or
--   - Run each statement separately with the Run button between each.
-- CLI alternative (cleanest):
--   supabase db push --linked
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_jobs_location_country;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_jobs_location_country_v2;

-- 1. Primary index on location_country (covers WHERE location_country IN (...))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_location_country
  ON public.jobs (location_country)
  WHERE location_country IS NOT NULL;

-- 2. Composite index for "v2 analyzed UAE/GCC jobs" queries (Mix / recent-feed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_location_country_v2
  ON public.jobs (location_country, analysis_version)
  WHERE analysis_version = 'v2' AND location_country IS NOT NULL;

-- 3. Refresh planner stats so the new indexes are picked up immediately
ANALYZE public.jobs;
