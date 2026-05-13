-- =============================================================================
-- Migration 041 — discovered_titles increment RPC
-- Author:    amb-jobs-pipeline (Abhay)
-- Date:      2026-05-13
-- Purpose:   Supports the /pipelines/jobs/discovery-harvest endpoint by providing
--            an atomic increment for observed_count on titles that re-appear
--            across discovery runs. Called fire-and-forget from the harvest
--            handler.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS increment_discovered_title_counts(uuid, text, text);
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION increment_discovered_title_counts(
  p_run_id  uuid,
  p_country text,
  p_source  text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE discovered_titles
  SET observed_count = observed_count + 1,
      last_seen_at   = NOW()
  WHERE country = p_country
    AND source  = p_source
    AND run_id  = p_run_id
    AND last_seen_at > NOW() - INTERVAL '5 minutes';
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

COMMENT ON FUNCTION increment_discovered_title_counts IS
  'Called from /pipelines/jobs/discovery-harvest after upsert. Bumps observed_count on rows touched within the last 5 minutes (heuristic for upsert-as-update).';

-- Grant execute to authenticated (the harvest endpoint runs as authenticated user)
GRANT EXECUTE ON FUNCTION increment_discovered_title_counts TO authenticated;

COMMIT;
