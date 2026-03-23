-- Feature 12: College Intelligence Engine
-- Process academic catalog PDFs to build structured college/program/course/skill intelligence
-- MANUAL STEP: Create a 'college-catalogs' storage bucket in Supabase Dashboard
-- Go to Storage > New Bucket > Name: "college-catalogs" > Public: No

-- Enable pg_trgm for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Colleges (universities/institutions)
CREATE TABLE IF NOT EXISTS colleges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    short_name TEXT,
    country TEXT,
    city TEXT,
    website TEXT,
    logo_url TEXT,
    catalog_year TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Schools (departments/faculties within a college)
CREATE TABLE IF NOT EXISTS college_schools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(college_id, name)
);
CREATE INDEX IF NOT EXISTS idx_college_schools_college ON college_schools(college_id);

-- Programs (degree programs)
CREATE TABLE IF NOT EXISTS college_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID NOT NULL REFERENCES college_schools(id) ON DELETE CASCADE,
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    degree_type TEXT NOT NULL,
    abbreviation TEXT,
    major TEXT,
    duration_years NUMERIC,
    total_credit_points INTEGER,
    qf_emirates_level INTEGER,
    delivery_mode TEXT,
    description TEXT,
    learning_outcomes TEXT[],
    intake_sessions TEXT[],
    uowd_code TEXT,
    double_major_provision TEXT,
    metadata JSONB DEFAULT '{}',
    processing_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(college_id, name)
);
CREATE INDEX IF NOT EXISTS idx_college_programs_school ON college_programs(school_id);
CREATE INDEX IF NOT EXISTS idx_college_programs_college ON college_programs(college_id);
CREATE INDEX IF NOT EXISTS idx_college_programs_degree ON college_programs(degree_type);

-- Courses (individual subjects)
CREATE TABLE IF NOT EXISTS college_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    credit_points INTEGER DEFAULT 6,
    description TEXT,
    hours_format TEXT,
    prerequisites TEXT,
    prerequisite_codes TEXT[],
    department_prefix TEXT,
    level INTEGER,
    topics_covered TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(college_id, code)
);
CREATE INDEX IF NOT EXISTS idx_college_courses_college ON college_courses(college_id);
CREATE INDEX IF NOT EXISTS idx_college_courses_code ON college_courses(code);
CREATE INDEX IF NOT EXISTS idx_college_courses_prefix ON college_courses(department_prefix);

-- Program-Course junction (which courses belong to which programs)
CREATE TABLE IF NOT EXISTS program_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES college_programs(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES college_courses(id) ON DELETE CASCADE,
    course_type TEXT NOT NULL,
    year_of_study INTEGER,
    recommended_term TEXT,
    is_required BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',

    UNIQUE(program_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_program_courses_program ON program_courses(program_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_course ON program_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_type ON program_courses(course_type);

-- Course skills (AI-extracted skills per course, mapped to taxonomy)
CREATE TABLE IF NOT EXISTS course_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES college_courses(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    skill_category TEXT,
    taxonomy_skill_id UUID REFERENCES taxonomy_skills(id),
    confidence NUMERIC DEFAULT 0.8,
    source TEXT DEFAULT 'ai_extraction',
    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(course_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_course_skills_course ON course_skills(course_id);
CREATE INDEX IF NOT EXISTS idx_course_skills_taxonomy ON course_skills(taxonomy_skill_id);
CREATE INDEX IF NOT EXISTS idx_course_skills_category ON course_skills(skill_category);

-- Catalog uploads (track PDF processing)
CREATE TABLE IF NOT EXISTS catalog_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id UUID REFERENCES colleges(id),
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT,
    total_pages INTEGER,
    status TEXT DEFAULT 'uploaded',
    progress JSONB DEFAULT '{}',
    extraction_results JSONB DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== RPC FUNCTIONS ====================

-- Program skill heatmap: programs × skill categories → count
CREATE OR REPLACE FUNCTION get_program_skill_heatmap(p_college_id UUID)
RETURNS TABLE(program_name TEXT, skill_category TEXT, skill_count BIGINT) AS $$
  SELECT cp.name, cs.skill_category, COUNT(DISTINCT cs.id)
  FROM college_programs cp
  JOIN program_courses pc ON pc.program_id = cp.id
  JOIN course_skills cs ON cs.course_id = pc.course_id
  WHERE cp.college_id = p_college_id
  GROUP BY cp.name, cs.skill_category
  ORDER BY cp.name, skill_count DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Program skill comparison: side-by-side skill comparison across programs
CREATE OR REPLACE FUNCTION get_program_skill_comparison(p_program_ids UUID[])
RETURNS TABLE(
  skill_name TEXT,
  skill_category TEXT,
  program_names TEXT[],
  program_count INTEGER
) AS $$
  SELECT
    cs.skill_name,
    cs.skill_category,
    ARRAY_AGG(DISTINCT cp.name),
    COUNT(DISTINCT cp.id)::INTEGER
  FROM course_skills cs
  JOIN program_courses pc ON pc.course_id = cs.course_id
  JOIN college_programs cp ON cp.id = pc.program_id
  WHERE cp.id = ANY(p_program_ids)
  GROUP BY cs.skill_name, cs.skill_category
  ORDER BY program_count DESC, cs.skill_name;
$$ LANGUAGE sql SECURITY DEFINER;

-- Skill gaps: taxonomy skills not covered by any course at a college
CREATE OR REPLACE FUNCTION get_skill_gaps(p_college_id UUID)
RETURNS TABLE(taxonomy_skill_name TEXT, taxonomy_category TEXT) AS $$
  SELECT ts.name, ts.category
  FROM taxonomy_skills ts
  WHERE NOT EXISTS (
    SELECT 1 FROM course_skills cs
    JOIN college_courses cc ON cc.id = cs.course_id
    WHERE cc.college_id = p_college_id
    AND cs.taxonomy_skill_id = ts.id
  )
  ORDER BY ts.category, ts.name;
$$ LANGUAGE sql SECURITY DEFINER;
