-- =============================================================================
-- Migration 043 — Fix upsert_skill: supply external_id + source on insert
-- Author:    camjdbcab
-- Date:      2026-05-15
--
-- Problem:
--   taxonomy_skills.external_id is NOT NULL with no default. The upsert_skill()
--   function (both overloads from migration 025 + 038b) inserts without
--   supplying external_id, which makes every auto-skill creation fail with
--   23502 "null value in column external_id". This silently breaks
--   analyze-jd's skill extraction across every consumer (JD Analyzer,
--   Campus Upload, etc.).
--
--   Discovered during Campus JD Upload smoke test (thread camjdbcab,
--   batch 456975b9-8744-4ec4-a148-a6ed33d1e898): both analyze_jd_runs sat
--   in status='queued' with error_message listing "upsert_skill failed for
--   <skill>: 23502" for every skill the LLM extracted.
--
-- Fix:
--   Replace both upsert_skill() overloads to:
--     * Compute external_id = 'nx-auto-' || encode(sha256(...), 'hex')[0:10]
--       deterministically from the normalized name. This makes re-runs
--       idempotent at the (external_id, source) unique-index level.
--     * Set source = 'auto' so the new rows are distinguishable from
--       the 'onet' and 'nexus_taxonomy_v2_2026_05' bulk imports and
--       don't collide with their external_id namespace.
--     * Use ON CONFLICT (external_id, source) DO NOTHING followed by a
--       second SELECT to safely handle the race where two concurrent
--       analyze-jd calls extract the same new skill.
--
--   Both overloads keep:
--     - SECURITY DEFINER (matches Phase 2 baseline)
--     - SET search_path = public, pg_catalog
--     - REVOKE EXECUTE FROM PUBLIC + GRANT to service_role only
--
-- Rollback:
--   Re-apply migration 038b to restore the broken-on-insert version.
--   Or DROP FUNCTION upsert_skill(text, text, text) and
--   DROP FUNCTION upsert_skill(text, text, text, text, text) then
--   restore from migration 025.
-- =============================================================================

BEGIN;

-- ─── 3-arg overload (legacy) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_skill(
  p_name     text,
  p_category text DEFAULT 'skill',
  p_tier     text DEFAULT 'competency'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id           uuid;
  v_normalized   text;
  v_external_id  text;
BEGIN
  v_normalized := trim(lower(regexp_replace(p_name, '\s+', ' ', 'g')));

  -- Deterministic external_id keyed on normalized name. Truncate sha256
  -- hex to 10 chars (same length pattern used by migration 033's
  -- 'nx-tax-v2-<10>' format). Collisions at 10 hex chars are vanishingly
  -- unlikely for our scale (<10K auto skills) and any collision is harmless
  -- since exact-match + alias-match already short-circuit before INSERT.
  -- pgcrypto.digest() lives in the extensions schema; qualify it explicitly
  -- because our pinned search_path doesn't include 'extensions'.
  v_external_id := 'nx-auto-' || substr(encode(extensions.digest(v_normalized, 'sha256'), 'hex'), 1, 10);

  -- 1. Exact match
  SELECT id INTO v_id FROM taxonomy_skills
  WHERE lower(trim(name)) = v_normalized
  LIMIT 1;

  -- 2. Alias match
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM taxonomy_skills
    WHERE v_normalized = ANY(aliases)
    LIMIT 1;
  END IF;

  -- 3. Create if not found
  IF v_id IS NULL THEN
    INSERT INTO taxonomy_skills (
      id, external_id, source,
      name, category, status, is_auto_created,
      first_seen_at, created_at
    ) VALUES (
      gen_random_uuid(),
      v_external_id,
      'auto',
      trim(p_name),
      p_category,
      'unverified',
      true,
      now(),
      now()
    )
    ON CONFLICT (external_id, source) DO NOTHING
    RETURNING id INTO v_id;

    -- If ON CONFLICT skipped the insert (race), re-fetch the existing row.
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM taxonomy_skills
      WHERE external_id = v_external_id AND source = 'auto'
      LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;


-- ─── 5-arg overload (with l1/l2, from migration 038b) ──────────────────────
CREATE OR REPLACE FUNCTION public.upsert_skill(
  p_name     text,
  p_category text DEFAULT 'skill',
  p_tier     text DEFAULT 'competency',
  p_l1       text DEFAULT NULL,
  p_l2       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id           uuid;
  v_normalized   text;
  v_external_id  text;
BEGIN
  v_normalized := trim(lower(regexp_replace(p_name, '\s+', ' ', 'g')));
  v_external_id := 'nx-auto-' || substr(encode(extensions.digest(v_normalized, 'sha256'), 'hex'), 1, 10);

  -- 1. Exact match
  SELECT id INTO v_id FROM taxonomy_skills
  WHERE lower(trim(name)) = v_normalized
  LIMIT 1;

  -- 2. Alias match
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM taxonomy_skills
    WHERE v_normalized = ANY(aliases)
    LIMIT 1;
  END IF;

  -- 3. Create if not found, setting l1/l2 when provided
  IF v_id IS NULL THEN
    INSERT INTO taxonomy_skills (
      id, external_id, source,
      name, category, status, is_auto_created,
      l1, l2,
      first_seen_at, created_at
    ) VALUES (
      gen_random_uuid(),
      v_external_id,
      'auto',
      trim(p_name),
      p_category,
      'unverified',
      true,
      p_l1,
      p_l2,
      now(),
      now()
    )
    ON CONFLICT (external_id, source) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM taxonomy_skills
      WHERE external_id = v_external_id AND source = 'auto'
      LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;


-- ─── Privileges (matches Phase 2 hardening baseline) ──────────────────────
REVOKE EXECUTE ON FUNCTION public.upsert_skill(text, text, text)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_skill(text, text, text, text, text)           FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upsert_skill(text, text, text)                       TO service_role;
GRANT  EXECUTE ON FUNCTION public.upsert_skill(text, text, text, text, text)           TO service_role;

COMMIT;
