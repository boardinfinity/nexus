-- Migration 037: Legacy taxonomy backfill + regions[] column + extended stats RPC
--
-- Three goals:
--   1. Add `regions text[]` column on taxonomy_skills (multi-select region tagging — India, Global, UAE/GCC, SEA, US, EU, etc.)
--   2. Backfill l1/l2 for the 8,887 legacy O*NET rows via deterministic mapping (skip the v2 batch which already has values)
--   3. Backfill regions: v2 batch -> use india_relevance to seed regions; legacy rows -> 'Global'
--   4. Extend get_taxonomy_stats() RPC to also return by_l1, by_l2 (per L1), and by_region
--
-- Mapping rules for legacy backfill (categorical, deterministic):
--   legacy category 'technology' -> l1='TECHNICAL SKILLS', l2='Tool'
--     (Most O*NET 'technology' rows are commercial software / tools. Programming languages / frameworks
--      that should be l2='Technology' will be re-tagged in a follow-up curation pass — not in this migration.)
--   legacy category 'ability'    -> l1='COMPETENCIES',     l2='Ability'
--   legacy category 'skill'      -> l1='COMPETENCIES',     l2='Skill'
--   legacy category 'knowledge'  -> l1='KNOWLEDGE',        l2='Knowledge'
--
-- Idempotent: only updates rows where l1 IS NULL.

BEGIN;

-- ============================================================
-- 1. SCHEMA: regions text[] column
-- ============================================================
ALTER TABLE public.taxonomy_skills
  ADD COLUMN IF NOT EXISTS regions text[] DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN public.taxonomy_skills.regions IS
  'Multi-select region tags. Values: India, Global, UAE/GCC, SEA, US, EU, etc. Empty array means unspecified.';

CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_regions_gin
  ON public.taxonomy_skills USING GIN (regions);

-- ============================================================
-- 2. BACKFILL l1/l2 on the 8,887 legacy rows (where l1 IS NULL)
-- ============================================================
UPDATE public.taxonomy_skills
SET
  l1 = CASE
    WHEN category = 'technology' THEN 'TECHNICAL SKILLS'
    WHEN category = 'ability'    THEN 'COMPETENCIES'
    WHEN category = 'skill'      THEN 'COMPETENCIES'
    WHEN category = 'knowledge'  THEN 'KNOWLEDGE'
    ELSE NULL
  END,
  l2 = CASE
    WHEN category = 'technology' THEN 'Tool'
    WHEN category = 'ability'    THEN 'Ability'
    WHEN category = 'skill'      THEN 'Skill'
    WHEN category = 'knowledge'  THEN 'Knowledge'
    ELSE NULL
  END
WHERE l1 IS NULL
  AND category IN ('technology','ability','skill','knowledge');

-- ============================================================
-- 3. BACKFILL regions
--    v2 rows: derive from india_relevance
--      india_specific  -> ARRAY['India']
--      india_strong    -> ARRAY['India','Global']  (relevant in India + globally)
--      global          -> ARRAY['Global']
--    legacy rows: ARRAY['Global'] (O*NET is US-derived but globally generic)
-- ============================================================
UPDATE public.taxonomy_skills
SET regions = CASE
  WHEN india_relevance = 'india_specific' THEN ARRAY['India']
  WHEN india_relevance = 'india_strong'   THEN ARRAY['India','Global']
  ELSE ARRAY['Global']
END
WHERE regions IS NULL OR regions = ARRAY[]::text[];

-- ============================================================
-- 4. Extend get_taxonomy_stats() RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_taxonomy_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM taxonomy_skills),
    'by_category', (
      SELECT COALESCE(json_object_agg(category, cnt), '{}'::json)
      FROM (
        SELECT category, COUNT(*) AS cnt
        FROM taxonomy_skills
        GROUP BY category
        ORDER BY cnt DESC
      ) sub
    ),
    'by_l1', (
      SELECT COALESCE(json_object_agg(l1, cnt), '{}'::json)
      FROM (
        SELECT COALESCE(l1, '_unmapped') AS l1, COUNT(*) AS cnt
        FROM taxonomy_skills
        GROUP BY l1
      ) sub
    ),
    'by_l2', (
      -- nested: { 'TECHNICAL SKILLS': { 'Tool': N, 'Technology': N, 'Methodology': N }, ... }
      SELECT COALESCE(json_object_agg(l1, l2_obj), '{}'::json)
      FROM (
        SELECT
          COALESCE(l1, '_unmapped') AS l1,
          json_object_agg(COALESCE(l2, '_unmapped'), cnt) AS l2_obj
        FROM (
          SELECT l1, l2, COUNT(*) AS cnt
          FROM taxonomy_skills
          GROUP BY l1, l2
        ) inner_q
        GROUP BY l1
      ) outer_q
    ),
    'by_region', (
      -- unnest regions array, count
      SELECT COALESCE(json_object_agg(region, cnt), '{}'::json)
      FROM (
        SELECT unnest(regions) AS region, COUNT(*) AS cnt
        FROM taxonomy_skills
        WHERE regions IS NOT NULL AND array_length(regions, 1) > 0
        GROUP BY region
        ORDER BY cnt DESC
      ) sub
    ),
    'hot_technologies', (
      SELECT COUNT(*) FROM taxonomy_skills WHERE is_hot_technology = true
    ),
    'top_skills', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT skill_name AS name, COUNT(*) AS job_count
        FROM job_skills
        GROUP BY skill_name
        ORDER BY job_count DESC
        LIMIT 20
      ) t
    )
  );
$function$;

COMMIT;

-- ============================================================
-- POST-CHECKS
-- ============================================================
-- All rows should now have l1/l2
-- SELECT COUNT(*) FROM public.taxonomy_skills WHERE l1 IS NULL;
--
-- L1 distribution after backfill (expected: TECHNICAL SKILLS ~9,575, COMPETENCIES ~334, KNOWLEDGE ~219, CREDENTIAL 111)
-- SELECT l1, COUNT(*) FROM public.taxonomy_skills GROUP BY l1 ORDER BY 2 DESC;
--
-- Regions distribution
-- SELECT unnest(regions) AS region, COUNT(*) FROM public.taxonomy_skills GROUP BY 1 ORDER BY 2 DESC;
--
-- All extended stats payload
-- SELECT get_taxonomy_stats();
