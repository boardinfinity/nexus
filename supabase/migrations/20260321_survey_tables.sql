-- Feature 8: Survey Forms - Database Tables
-- Run this migration against your Supabase PostgreSQL database

-- Ensure uuid extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Survey Respondents (OTP-based auth, separate from main app)
CREATE TABLE IF NOT EXISTS survey_respondents (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email             TEXT        UNIQUE NOT NULL,
    full_name         TEXT,
    company_name      TEXT,
    designation       TEXT,
    industry          TEXT,
    company_size      TEXT,
    years_of_experience INTEGER,
    location_city     TEXT,
    location_country  TEXT,
    auth_otp          TEXT,
    auth_otp_expires  TIMESTAMPTZ,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. Survey Responses (generic section/question storage with JSONB values)
CREATE TABLE IF NOT EXISTS survey_responses (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    respondent_id   UUID        REFERENCES survey_respondents(id) NOT NULL,
    section_key     TEXT        NOT NULL,
    question_key    TEXT        NOT NULL,
    response_type   TEXT        NOT NULL,
    response_value  JSONB       NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_response_unique
    ON survey_responses (respondent_id, section_key, question_key);

-- 3. Survey Skill Ratings (dedicated table for the skill rating matrix)
CREATE TABLE IF NOT EXISTS survey_skill_ratings (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    respondent_id        UUID        REFERENCES survey_respondents(id) NOT NULL,
    skill_name           TEXT        NOT NULL,
    taxonomy_skill_id    UUID        REFERENCES taxonomy_skills(id),
    importance_rating    SMALLINT    CHECK (importance_rating BETWEEN 1 AND 5),
    demonstration_rating SMALLINT    CHECK (demonstration_rating BETWEEN 1 AND 5),
    is_custom_skill      BOOLEAN     DEFAULT false,
    created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_ratings_unique
    ON survey_skill_ratings (respondent_id, skill_name);

CREATE INDEX IF NOT EXISTS idx_skill_ratings_respondent
    ON survey_skill_ratings (respondent_id);

CREATE INDEX IF NOT EXISTS idx_skill_ratings_skill
    ON survey_skill_ratings (taxonomy_skill_id);
