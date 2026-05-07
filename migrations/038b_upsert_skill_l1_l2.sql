-- ============================================================
-- Migration 038b: upsert_skill l1/l2 params + fuzzy-match helpers
-- Author:  Track B / thread jdenh001
-- Date:    2026-05-07
-- Depends: 038_analyze_jd_runs_and_l2_to_l1 (fuzzystrmatch / pg_trgm)
--
-- This migration is part of the 038 reservation (same feature group:
-- JD enrichment L1/L2 wiring). Suffix "b" avoids re-using the exact
-- number since migration 038 was already written to disk.
--
-- What this does:
--   1. Ensures fuzzystrmatch extension is enabled (for levenshtein()).
--      pg_trgm is already installed (verified: version 1.6 active).
--   2. Replaces upsert_skill() with a backwards-compatible version that
--      accepts optional p_l1 text and p_l2 text parameters.
--      When provided, these are set on the newly created row.
--      Existing callers that omit p_l1/p_l2 are unaffected.
--   3. Adds find_similar_skill(p_name, p_threshold, p_limit) RPC that
--      the API uses to run the pg_trgm similarity fuzzy pre-filter.
--   4. Adds append_skill_alias(p_skill_id, p_alias) RPC that appends
--      a new alias to taxonomy_skills.aliases[] with a NOT EXISTS guard
--      (prevents duplicates) and increments mention_count.
--
-- ROLLBACK NOTES
-- --------------
-- To undo: restore the original upsert_skill from migration 025 and
-- DROP FUNCTION IF EXISTS find_similar_skill(text, float, int);
-- DROP FUNCTION IF EXISTS append_skill_alias(uuid, text);
-- The fuzzystrmatch extension can be left installed (it is harmless).
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Enable fuzzystrmatch (provides levenshtein(), soundex() etc.)
--    Idempotent — no-op if already installed.
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;


-- ────────────────────────────────────────────────────────────
-- 2. Replace upsert_skill() — add optional p_l1 / p_l2 params
--    Backwards compatible: old callers that omit p_l1/p_l2 still work.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_skill(
  p_name     text,
  p_category text    DEFAULT 'skill',
  p_tier     text    DEFAULT 'competency',
  p_l1       text    DEFAULT NULL,
  p_l2       text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id         uuid;
  v_normalized text;
BEGIN
  -- Normalize: lowercase, trim, collapse whitespace
  v_normalized := trim(lower(regexp_replace(p_name, '\s+', ' ', 'g')));

  -- 1. Try exact match
  SELECT id INTO v_id FROM taxonomy_skills
  WHERE lower(trim(name)) = v_normalized
  LIMIT 1;

  -- 2. Try alias match
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM taxonomy_skills
    WHERE v_normalized = ANY(aliases)
    LIMIT 1;
  END IF;

  -- 3. Create if not found, setting l1/l2 when provided
  IF v_id IS NULL THEN
    INSERT INTO taxonomy_skills (
      id, name, category, status, is_auto_created,
      l1, l2,
      first_seen_at, created_at
    ) VALUES (
      gen_random_uuid(),
      trim(p_name),
      p_category,
      'unverified',
      true,
      p_l1,   -- NULL when called by legacy callers
      p_l2,   -- NULL when called by legacy callers
      now(),
      now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 3. find_similar_skill() — pg_trgm similarity pre-filter
--    Called by the API fuzzy-match step in processSkill().
--    Returns rows where similarity(name, p_name) >= p_threshold,
--    ordered by similarity DESC, limited to p_limit results.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_similar_skill(
  p_name      text,
  p_threshold float  DEFAULT 0.7,
  p_limit     int    DEFAULT 3
)
RETURNS TABLE (
  id         uuid,
  name       text,
  aliases    text[],
  sim        float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ts.id,
    ts.name,
    ts.aliases,
    similarity(lower(trim(ts.name)), lower(trim(p_name))) AS sim
  FROM taxonomy_skills ts
  WHERE similarity(lower(trim(ts.name)), lower(trim(p_name))) >= p_threshold
  ORDER BY sim DESC
  LIMIT p_limit;
$$;


-- ────────────────────────────────────────────────────────────
-- 4. append_skill_alias() — safely append a new alias variant
--    Called when a fuzzy-match succeeds. Guards against duplicates
--    via a NOT EXISTS check. Also increments mention_count.
--    Returns TRUE if the alias was added, FALSE if it already existed.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION append_skill_alias(
  p_skill_id  uuid,
  p_alias     text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_alias_norm text;
  v_added      boolean := false;
BEGIN
  v_alias_norm := lower(trim(p_alias));

  -- Only append if the alias is not already present
  UPDATE taxonomy_skills
  SET
    aliases       = array_append(aliases, v_alias_norm),
    mention_count = COALESCE(mention_count, 0) + 1,
    updated_at    = now()
  WHERE id = p_skill_id
    AND NOT (v_alias_norm = ANY(COALESCE(aliases, '{}'::text[])));

  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added > 0;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 5. GIN index on aliases[] for fast containment queries
--    (Already exists from migration 025 — CREATE INDEX IF NOT EXISTS
--    is idempotent, so safe to include here as a safety net.)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_aliases_gin
  ON public.taxonomy_skills USING GIN (aliases);

-- pg_trgm trigram index on name for similarity() queries
CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_name_trgm
  ON public.taxonomy_skills USING GIN (lower(name) gin_trgm_ops);
