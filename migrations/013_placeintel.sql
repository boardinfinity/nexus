-- ============================================================
-- Migration 013: PlaceIntel — Campus Placement Intelligence
-- ============================================================
-- IMPORTANT: Run this against the Nexus Supabase project (jlgstbucwawuntatrgvy)
-- This ALTERS the existing colleges table (does NOT recreate it)
-- and creates new placement-related tables.
-- ============================================================

-- 1. Alter existing colleges table — add PlaceIntel columns
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS board_hub_account_id UUID;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS verified_domains TEXT[];
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS nirf_rank INTEGER;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS account_type TEXT;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS priority TEXT;

CREATE INDEX IF NOT EXISTS idx_colleges_board_hub_id ON colleges(board_hub_account_id);

-- 2. Placement respondents (college staff who fill the form)
CREATE TABLE IF NOT EXISTS placement_respondents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    designation TEXT,
    phone TEXT,
    otp_hash TEXT,
    otp_expires_at TIMESTAMPTZ,
    is_verified BOOLEAN DEFAULT false,
    domain_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Placement profiles (1 per college, updated over time)
CREATE TABLE IF NOT EXISTS placement_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE UNIQUE,
    submitted_by UUID REFERENCES placement_respondents(id),
    academic_year TEXT,

    -- General placement info
    has_placement_cell BOOLEAN DEFAULT true,
    placement_cell_name TEXT,
    placement_cell_head TEXT,
    placement_cell_email TEXT,
    placement_cell_phone TEXT,

    -- Calendar
    placement_season_start TEXT,
    placement_season_end TEXT,
    ppt_season_start TEXT,
    ppt_season_end TEXT,
    internship_drive_start TEXT,
    internship_drive_end TEXT,

    -- General policies
    one_year_internship BOOLEAN DEFAULT false,
    dream_offer_policy TEXT,
    min_ctc_expectation NUMERIC(12,0),
    max_ctc_expectation NUMERIC(12,0),
    median_ctc_last_year NUMERIC(12,0),
    highest_ctc_last_year NUMERIC(12,0),
    overall_placement_rate NUMERIC(5,2),
    total_students_eligible INTEGER,
    total_students_placed INTEGER,

    -- Recruiter engagement
    total_companies_visited INTEGER,
    top_recruiters TEXT[],
    sectors_hiring TEXT[],

    -- Process
    selection_process_notes TEXT,
    resume_format TEXT,

    -- Status
    status TEXT DEFAULT 'draft',
    completeness_score NUMERIC(5,1) DEFAULT 0,
    submitted_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Placement programs (per-program placement data)
CREATE TABLE IF NOT EXISTS placement_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES placement_profiles(id) ON DELETE CASCADE,
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,

    program_name TEXT NOT NULL,
    specialization TEXT,
    duration_years NUMERIC(3,1),
    intake_count INTEGER,

    placement_rate NUMERIC(5,2),
    students_eligible INTEGER,
    students_placed INTEGER,
    students_opted_higher_studies INTEGER,
    students_entrepreneurship INTEGER,

    min_ctc NUMERIC(12,0),
    max_ctc NUMERIC(12,0),
    avg_ctc NUMERIC(12,0),
    median_ctc NUMERIC(12,0),

    internship_mandatory BOOLEAN DEFAULT false,
    internship_duration_months INTEGER,
    internship_semester TEXT,
    avg_internship_stipend NUMERIC(10,0),
    internship_conversion_rate NUMERIC(5,2),

    typical_skills TEXT[],
    certifications_common TEXT[],
    projects_required BOOLEAN DEFAULT false,
    avg_cgpa NUMERIC(4,2),
    min_cgpa_for_placement NUMERIC(4,2),
    backlog_policy TEXT,

    top_recruiters_for_program TEXT[],
    preferred_sectors TEXT[],

    historical_data JSONB DEFAULT '[]',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(profile_id, program_name, specialization)
);

CREATE INDEX IF NOT EXISTS idx_placement_programs_profile ON placement_programs(profile_id);
CREATE INDEX IF NOT EXISTS idx_placement_programs_college ON placement_programs(college_id);

-- 5. Placement cycles (individual drives/events)
CREATE TABLE IF NOT EXISTS placement_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES placement_profiles(id) ON DELETE CASCADE,
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,

    cycle_name TEXT,
    cycle_type TEXT NOT NULL,
    academic_year TEXT,
    start_date DATE,
    end_date DATE,
    programs_included TEXT[],

    companies_invited INTEGER,
    companies_visited INTEGER,
    offers_made INTEGER,
    offers_accepted INTEGER,

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
