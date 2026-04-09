-- Migration 025: Intelligence Framework Schema
-- P1: Job classification, enhanced JD fields, skill lifecycle, skill hierarchy

-- ============================================================
-- 1. New columns on `jobs` table
-- ============================================================
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_function       text,
  ADD COLUMN IF NOT EXISTS job_family         text,
  ADD COLUMN IF NOT EXISTS job_industry       text,
  ADD COLUMN IF NOT EXISTS bucket             text,
  ADD COLUMN IF NOT EXISTS sub_role           text,
  ADD COLUMN IF NOT EXISTS experience_min     integer,
  ADD COLUMN IF NOT EXISTS experience_max     integer,
  ADD COLUMN IF NOT EXISTS education_req      text,
  ADD COLUMN IF NOT EXISTS jd_quality         text,
  ADD COLUMN IF NOT EXISTS classification_confidence  numeric(3,2),
  ADD COLUMN IF NOT EXISTS analysis_version   text,
  ADD COLUMN IF NOT EXISTS analyzed_at        timestamptz;

-- ============================================================
-- 2. New columns on `taxonomy_skills` table
-- ============================================================
ALTER TABLE taxonomy_skills
  ADD COLUMN IF NOT EXISTS status             text DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS mention_count      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_count      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_skill_id    uuid REFERENCES taxonomy_skills(id),
  ADD COLUMN IF NOT EXISTS aliases            text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_auto_created    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS validated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS first_seen_at      timestamptz DEFAULT now();

-- ============================================================
-- 3. New columns on `job_skills` table
-- ============================================================
ALTER TABLE job_skills
  ADD COLUMN IF NOT EXISTS is_required        boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS skill_tier         text;

-- ============================================================
-- 4. Reference table: job_functions (26 LinkedIn-aligned codes)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_functions (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text
);

INSERT INTO job_functions (id, name) VALUES
  ('FN-ACC', 'Accounting'),
  ('FN-ADM', 'Administrative'),
  ('FN-ART', 'Arts & Design'),
  ('FN-BDV', 'Business Development'),
  ('FN-CON', 'Consulting'),
  ('FN-CSU', 'Customer Success'),
  ('FN-EDU', 'Education'),
  ('FN-ENG', 'Engineering'),
  ('FN-ENT', 'Entrepreneurship'),
  ('FN-FIN', 'Finance'),
  ('FN-HLT', 'Healthcare'),
  ('FN-HRM', 'Human Resources'),
  ('FN-ITS', 'Information Technology'),
  ('FN-LGL', 'Legal'),
  ('FN-MKT', 'Marketing'),
  ('FN-MED', 'Media & Communications'),
  ('FN-OPS', 'Operations'),
  ('FN-PRD', 'Product Management'),
  ('FN-PGM', 'Program Management'),
  ('FN-PUR', 'Purchasing'),
  ('FN-QAL', 'Quality Assurance'),
  ('FN-REL', 'Real Estate'),
  ('FN-RES', 'Research'),
  ('FN-SAL', 'Sales'),
  ('FN-DAT', 'Data & Analytics'),
  ('FN-GEN', 'General Management')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Reference table: job_families (20 BI-custom codes)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_families (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text
);

INSERT INTO job_families (id, name) VALUES
  ('JF-01', 'Strategy & Consulting'),
  ('JF-02', 'Finance & Accounting'),
  ('JF-03', 'Marketing & Brand'),
  ('JF-04', 'Sales & Business Development'),
  ('JF-05', 'Supply Chain & Logistics'),
  ('JF-06', 'FMCG & Retail'),
  ('JF-07', 'Human Resources'),
  ('JF-08', 'Data Science & Analytics'),
  ('JF-09', 'Software Engineering'),
  ('JF-10', 'Product Management'),
  ('JF-11', 'Media & Content'),
  ('JF-12', 'Healthcare & Pharma'),
  ('JF-13', 'Education & Training'),
  ('JF-14', 'Legal & Compliance'),
  ('JF-15', 'Real Estate'),
  ('JF-16', 'Energy & Sustainability'),
  ('JF-17', 'Manufacturing & Engineering'),
  ('JF-18', 'Government & Public Sector'),
  ('JF-19', 'Entrepreneurship & Startups'),
  ('JF-20', 'General Management')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6. Reference table: job_industries (15 India-specific codes)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_industries (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text
);

INSERT INTO job_industries (id, name) VALUES
  ('IND-01', 'IT & Software'),
  ('IND-02', 'BFSI'),
  ('IND-03', 'E-Commerce & Internet'),
  ('IND-04', 'FMCG & Retail'),
  ('IND-05', 'Consulting & Professional Services'),
  ('IND-06', 'Manufacturing'),
  ('IND-07', 'Healthcare & Pharma'),
  ('IND-08', 'Energy & Utilities'),
  ('IND-09', 'Real Estate & Construction'),
  ('IND-10', 'Media & Entertainment'),
  ('IND-11', 'Education & EdTech'),
  ('IND-12', 'Automotive'),
  ('IND-13', 'Telecom'),
  ('IND-14', 'Government & PSU'),
  ('IND-15', 'Others')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 7. Skill auto-create function: upsert_skill()
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_skill(
  p_name text,
  p_category text DEFAULT 'skill',
  p_tier text DEFAULT 'competency'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_normalized text;
BEGIN
  -- Normalize: lowercase, trim, collapse whitespace
  v_normalized := trim(lower(regexp_replace(p_name, '\s+', ' ', 'g')));

  -- Try exact match first
  SELECT id INTO v_id FROM taxonomy_skills
  WHERE lower(trim(name)) = v_normalized
  LIMIT 1;

  -- Try alias match
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM taxonomy_skills
    WHERE v_normalized = ANY(aliases)
    LIMIT 1;
  END IF;

  -- Create if not found
  IF v_id IS NULL THEN
    INSERT INTO taxonomy_skills (
      id, name, category, status, is_auto_created, first_seen_at, created_at
    ) VALUES (
      gen_random_uuid(),
      trim(p_name),
      p_category,
      'unverified',
      true,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 8. Skill validation function: validate_skills()
-- ============================================================
CREATE OR REPLACE FUNCTION validate_skills()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH skill_stats AS (
    SELECT
      js.taxonomy_skill_id,
      COUNT(*) as mention_count,
      COUNT(DISTINCT j.company_name) as company_count
    FROM job_skills js
    JOIN jobs j ON j.id = js.job_id
    WHERE js.taxonomy_skill_id IS NOT NULL
    GROUP BY js.taxonomy_skill_id
  ),
  updated AS (
    UPDATE taxonomy_skills ts
    SET
      mention_count = ss.mention_count,
      company_count = ss.company_count,
      status = CASE
        WHEN ts.status = 'unverified'
          AND ss.mention_count >= 10
          AND ss.company_count >= 3
        THEN 'validated'
        ELSE ts.status
      END,
      validated_at = CASE
        WHEN ts.status = 'unverified'
          AND ss.mention_count >= 10
          AND ss.company_count >= 3
        THEN now()
        ELSE ts.validated_at
      END
    FROM skill_stats ss
    WHERE ts.id = ss.taxonomy_skill_id
    RETURNING ts.id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 9. Indexes
-- ============================================================

-- Jobs classification queries
CREATE INDEX IF NOT EXISTS idx_jobs_job_function     ON jobs(job_function);
CREATE INDEX IF NOT EXISTS idx_jobs_job_family       ON jobs(job_family);
CREATE INDEX IF NOT EXISTS idx_jobs_job_industry     ON jobs(job_industry);
CREATE INDEX IF NOT EXISTS idx_jobs_jd_quality       ON jobs(jd_quality);
CREATE INDEX IF NOT EXISTS idx_jobs_analysis_version ON jobs(analysis_version);

-- Skill lifecycle queries
CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_status  ON taxonomy_skills(status);
CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_parent  ON taxonomy_skills(parent_skill_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_skills_mention ON taxonomy_skills(mention_count DESC);

-- ============================================================
-- 10. Row Level Security
-- ============================================================
ALTER TABLE job_functions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_families   ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_industries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_job_functions"  ON job_functions  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_job_families"   ON job_families   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_job_industries" ON job_industries FOR SELECT TO authenticated USING (true);
