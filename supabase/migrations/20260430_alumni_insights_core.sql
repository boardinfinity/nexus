-- =============================================================================
-- Migration:  0001_alumni_insights_core.sql
-- Feature:    Alumni Insights — Core Schema
-- Description:
--   Introduces all tables required for the Alumni Insights feature in Nexus.
--   Covers the five-layer pipeline architecture:
--     Layer 1  — program_mapping_cache
--     Layer 2  — alumni_profile_snapshots (+ flat lifted columns)
--     Layer 3  — bucket_frameworks, buckets, bucket_companies,
--                 college_bucket_access, bucket_ctc_bands
--     Layer 4  — (uses existing tables + snapshots; no extra tables)
--     Layer 5  — insight_reports
--   Also includes college_peer_groups (stub for v1.1 peer comparison).
--
--   Design decisions locked (see alumni_insights_design_context.md):
--     Q1: CTC = bucket-implied bands only (bucket_ctc_bands); no per-person CTC.
--     Q2: During-college = date-overlap logic; classification is best-effort.
--     Q3: v1 = same-college YoY only; peer groups schema present for v1.1.
--     Q4: Generic framework-agnostic schema (bucket_frameworks → buckets).
--
-- Idempotency: All CREATE TABLE and CREATE INDEX use IF NOT EXISTS.
--              ALTER TABLE ADD COLUMN uses IF NOT EXISTS guard (PG 9.6+).
-- Safe to re-run: YES
-- Supabase project: Nexus (Board Infinity)
-- =============================================================================

-- Require the standard Supabase extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- LAYER 3 — BUCKET FRAMEWORK TABLES
-- (Created before alumni_profile_snapshots so FKs resolve in order)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- bucket_frameworks
--   One row per named framework (e.g., "Tier-1 MBA Placement Framework").
--   Multiple colleges can share a framework; a college can access multiple
--   frameworks via college_bucket_access.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bucket_frameworks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL UNIQUE,          -- e.g. 'tier1_mba'
    target_audience TEXT,                                  -- e.g. 'MBA graduates, India'
    version         TEXT        DEFAULT '1.0',
    description     TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bucket_frameworks IS
    'Named classification frameworks. Each framework contains 1-N buckets. '
    'Designed to be framework-agnostic: Tier-1 MBA, UOWD-specific, etc. slot in '
    'as separate rows without schema changes.';


-- ─────────────────────────────────────────────────────────────────────────────
-- buckets
--   Individual placement buckets within a framework (e.g., B01 = MBB Strategy).
--   domain groups buckets for aggregation (e.g., "Strategy & Management Consulting").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buckets (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    framework_id    UUID        NOT NULL REFERENCES bucket_frameworks(id) ON DELETE CASCADE,
    code            TEXT        NOT NULL,                  -- e.g. 'B01'
    name            TEXT        NOT NULL,                  -- e.g. 'MBB Strategy Consulting'
    domain          TEXT        NOT NULL,                  -- e.g. 'Strategy & Management Consulting'
    description     TEXT,
    typical_entry_role TEXT,                               -- e.g. 'Associate / Consultant'
    company_tier    TEXT,                                  -- e.g. 'Super (S)', 'Tier 1A'
    selectivity     TEXT,                                  -- free-text selectivity note
    sort_order      SMALLINT,                              -- display ordering within framework
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (framework_id, code)
);

COMMENT ON TABLE buckets IS
    'Individual placement buckets within a framework. B01-B20 for Tier-1 MBA, '
    'with code being framework-scoped (not globally unique).';

CREATE INDEX IF NOT EXISTS idx_buckets_framework_id
    ON buckets (framework_id);

CREATE INDEX IF NOT EXISTS idx_buckets_domain
    ON buckets (domain);


-- ─────────────────────────────────────────────────────────────────────────────
-- bucket_companies
--   Many-to-many: a company can map to one or more buckets across frameworks,
--   with a weight to indicate how strongly the company represents that bucket.
--   weight = 1.0 means the company is a canonical representative of the bucket.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bucket_companies (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id       UUID        NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    company_id      UUID        REFERENCES companies(id) ON DELETE SET NULL,
    company_name    TEXT        NOT NULL,                  -- denormalized for lookup without FK
    weight          FLOAT       NOT NULL DEFAULT 1.0       -- 0.0–1.0; 1.0 = canonical match
                                CHECK (weight BETWEEN 0.0 AND 1.0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bucket_id, company_name)
);

COMMENT ON TABLE bucket_companies IS
    'Maps companies to buckets. weight >= 0.7 used as deterministic shortcut in Layer 3 '
    'bucketing (avoids LLM call). company_name is denormalized so lookup works even '
    'when company_id is not yet resolved.';

CREATE INDEX IF NOT EXISTS idx_bucket_companies_bucket_id
    ON bucket_companies (bucket_id);

CREATE INDEX IF NOT EXISTS idx_bucket_companies_company_id
    ON bucket_companies (company_id)
    WHERE company_id IS NOT NULL;

-- Trigram index for fuzzy company name matching during bucketing shortcut
CREATE INDEX IF NOT EXISTS idx_bucket_companies_name_trgm
    ON bucket_companies USING gin (company_name gin_trgm_ops);


-- ─────────────────────────────────────────────────────────────────────────────
-- college_bucket_access
--   Controls which buckets are relevant/visible for a given college.
--   access_score 0–5: 0 = not applicable, 5 = highly relevant.
--   evidence stores supporting data (e.g., historical placement counts).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS college_bucket_access (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    bucket_id       UUID        NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    access_score    SMALLINT    NOT NULL DEFAULT 3
                                CHECK (access_score BETWEEN 0 AND 5),
    evidence        JSONB       DEFAULT '{}',              -- e.g. {"historical_placements": 42}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (college_id, bucket_id)
);

COMMENT ON TABLE college_bucket_access IS
    'Per-college relevance score for each bucket. access_score = 0 means the bucket '
    'is suppressed for this college dashboard. Populated manually or via the '
    'College-Bucket Matrix sheet of the framework.';

CREATE INDEX IF NOT EXISTS idx_college_bucket_access_college_id
    ON college_bucket_access (college_id);

CREATE INDEX IF NOT EXISTS idx_college_bucket_access_bucket_id
    ON college_bucket_access (bucket_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- bucket_ctc_bands
--   Stores framework-implied CTC percentile bands per bucket × geography × college_tier.
--   No per-person CTC numbers are ever stored (Q1 decision).
--   currency defaults to 'INR'; use 'USD', 'AED' for international colleges.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bucket_ctc_bands (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id       UUID        NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    geography       TEXT        NOT NULL DEFAULT 'IN',     -- ISO 3166-1 alpha-2 or 'IN', 'GLOBAL'
    college_tier    SMALLINT,                              -- NULL = applies to all tiers; else matches colleges.tier
    p25             NUMERIC(10,2),                         -- 25th percentile CTC
    p50             NUMERIC(10,2),                         -- median CTC
    p75             NUMERIC(10,2),                         -- 75th percentile CTC
    currency        TEXT        NOT NULL DEFAULT 'INR',
    unit            TEXT        NOT NULL DEFAULT 'LPA',    -- 'LPA', 'USD_K', etc.
    source          TEXT,                                  -- e.g. 'Tier1_MBA_Bucket_Framework_v1.0'
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bucket_id, geography, COALESCE(college_tier, -1))
                    -- ASSUMPTION: COALESCE trick used because UNIQUE on nullable column
                    -- treats (bucket_id, geography, NULL) as never-equal in standard SQL.
                    -- If Supabase PG version < 15, replace with a partial unique index.
);

COMMENT ON TABLE bucket_ctc_bands IS
    'Bucket-implied CTC percentile bands. Values are framework-derived estimates, '
    'not per-person survey data. Bands are modulated by geography and college tier. '
    'Snapshots reference these at analysis time; public reports show bands only.';

CREATE INDEX IF NOT EXISTS idx_bucket_ctc_bands_bucket_id
    ON bucket_ctc_bands (bucket_id);


-- =============================================================================
-- LAYER 1 — PROGRAM MASTER MAPPING CACHE
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- program_mapping_cache
--   Caches LLM-resolved mappings from raw LinkedIn degree/field strings to
--   college_programs.id. Cache key = (college_id, raw_degree, raw_field).
--   confidence < 0.6 entries are surfaced to admins for manual review.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_mapping_cache (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id          UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    raw_degree          TEXT        NOT NULL,
    raw_field           TEXT        NOT NULL DEFAULT '',
    mapped_program_id   UUID        REFERENCES college_programs(id) ON DELETE SET NULL,
    confidence          FLOAT,                             -- 0.0–1.0; NULL = manual mapping
    model               TEXT,                              -- model used for this mapping
    manually_overridden BOOLEAN     NOT NULL DEFAULT false,-- true if admin corrected the LLM result
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (college_id, raw_degree, raw_field)
);

COMMENT ON TABLE program_mapping_cache IS
    'LLM cache for Layer 1: maps raw LinkedIn degree + field_of_study strings to '
    'college_programs.id per college. Avoids repeat LLM calls on re-runs. '
    'confidence < 0.6 or mapped_program_id IS NULL = flagged for admin review.';

CREATE INDEX IF NOT EXISTS idx_program_mapping_college_id
    ON program_mapping_cache (college_id);

CREATE INDEX IF NOT EXISTS idx_program_mapping_unmapped
    ON program_mapping_cache (college_id, confidence)
    WHERE mapped_program_id IS NULL OR confidence < 0.6;


-- =============================================================================
-- LAYER 2 — ALUMNI PROFILE SNAPSHOTS
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- alumni_profile_snapshots
--   Core output table for the person_analysis pipeline. One row per
--   (college_id, person_id, schema_version). Newer schema versions are inserted
--   as new rows; old rows are retained for rollback / audit.
--
--   Flat columns (lifted from snapshot jsonb) are maintained by the pipeline
--   writer — NOT by triggers — for simplicity and explicit control.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alumni_profile_snapshots (
    -- Primary key
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Context foreign keys
    college_id                  UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    person_id                   UUID        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    alumni_id                   UUID        REFERENCES alumni(id) ON DELETE SET NULL,
    program_id                  UUID        REFERENCES college_programs(id) ON DELETE SET NULL,

    -- Versioning
    schema_version              SMALLINT    NOT NULL DEFAULT 2,
    -- schema_version is bumped when the snapshot JSON shape changes incompatibly.
    -- All v1 rows remain; re-analysis writes new v2 rows alongside them.

    -- Full structured output
    snapshot                    JSONB       NOT NULL DEFAULT '{}',

    -- ── Flat lifted columns (see spec §5 for reasoning) ────────────────────
    -- Cohort grouping
    graduation_year             SMALLINT,
    cohort_label                TEXT,                      -- e.g. '2023_MBA'

    -- First-job placement (most-queried insight)
    first_job_bucket_id         UUID        REFERENCES buckets(id) ON DELETE SET NULL,
    first_job_bucket_code       TEXT,                      -- denormalized for filter without JOIN
    is_ppo                      BOOLEAN,                   -- first job = SIP company

    -- During-college
    sip_bucket_id               UUID        REFERENCES buckets(id) ON DELETE SET NULL,

    -- Pre-college profile
    undergrad_college_tier      TEXT,                      -- e.g. 'Cat-A+', 'Cat-A', 'Cat-B'
    pre_college_total_exp_months SMALLINT,

    -- Current career
    current_job_bucket_id       UUID        REFERENCES buckets(id) ON DELETE SET NULL,

    -- CTC band (derived at analysis time from bucket_ctc_bands)
    ctc_band_label              TEXT,                      -- e.g. '₹45–58 LPA'

    -- Data quality
    completeness_score          NUMERIC(3,2),              -- 0.00–1.00

    -- Analysis metadata
    model                       TEXT,                      -- e.g. 'gpt-4.1-mini'
    analyzed_at                 TIMESTAMPTZ,               -- when the LLM call completed
    run_id                      UUID,                      -- FK to pipeline_runs.id (soft; no FK constraint for perf)

    -- Idempotency hash: SHA-256 of canonical(experience jsonb || education jsonb).
    -- Used to skip re-analysis when the source profile hasn't changed.
    -- More reliable than people.updated_at, which may not be bumped on jsonb updates.
    source_content_hash         TEXT,

    -- Timestamps
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Idempotency constraint
    UNIQUE (college_id, person_id, schema_version)
);

COMMENT ON TABLE alumni_profile_snapshots IS
    'Output of the person_analysis pipeline. One row per (college_id, person_id, schema_version). '
    'Flat columns are promoted from the snapshot JSONB for query performance. '
    'CTC data is bucket-implied bands only (Q1 decision); no per-person salary figures.';

-- Primary access pattern: cohort dashboard (college + year)
CREATE INDEX IF NOT EXISTS idx_aps_college_year
    ON alumni_profile_snapshots (college_id, graduation_year, schema_version);

-- Program-specific cohort drill-down
CREATE INDEX IF NOT EXISTS idx_aps_college_program_year
    ON alumni_profile_snapshots (college_id, program_id, graduation_year)
    WHERE program_id IS NOT NULL;

-- Bucket distribution queries
CREATE INDEX IF NOT EXISTS idx_aps_first_job_bucket
    ON alumni_profile_snapshots (college_id, first_job_bucket_id, graduation_year);

-- Completeness filter (public reports exclude low-quality profiles)
CREATE INDEX IF NOT EXISTS idx_aps_completeness
    ON alumni_profile_snapshots (college_id, completeness_score);

-- Undergrad tier distribution
CREATE INDEX IF NOT EXISTS idx_aps_undergrad_tier
    ON alumni_profile_snapshots (college_id, undergrad_college_tier, graduation_year);

-- Content hash lookup for the 24-hr re-analysis skip (replaces people.updated_at trust)
CREATE INDEX IF NOT EXISTS idx_aps_content_hash
    ON alumni_profile_snapshots (person_id, schema_version, source_content_hash)
    WHERE source_content_hash IS NOT NULL;

-- person_id lookup (for per-person debugging endpoint)
CREATE INDEX IF NOT EXISTS idx_aps_person_id
    ON alumni_profile_snapshots (person_id);

-- Run tracking (to associate snapshot with the pipeline_run that created it)
CREATE INDEX IF NOT EXISTS idx_aps_run_id
    ON alumni_profile_snapshots (run_id)
    WHERE run_id IS NOT NULL;


-- =============================================================================
-- LAYER 5 — PUBLIC REPORT METADATA
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- insight_reports
--   Tracks generated public reports. chart_urls stores Supabase Storage paths
--   for each rendered PNG widget. status: 'pending' | 'rendering' | 'ready' | 'error'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insight_reports (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id          UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    graduation_year     SMALLINT,                          -- NULL = multi-year report
    program_id          UUID        REFERENCES college_programs(id) ON DELETE SET NULL,
    report_type         TEXT        NOT NULL DEFAULT 'cohort', -- 'cohort' | 'yoy' | 'custom'
    title               TEXT,
    caption             TEXT,                              -- auto-generated 140-char caption
    status              TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','rendering','ready','error')),
    chart_urls          JSONB       NOT NULL DEFAULT '{}', -- {widget_name: storage_path}
    redacted_widgets    JSONB       NOT NULL DEFAULT '[]', -- list of widget names suppressed by N<5
    filters_applied     JSONB       NOT NULL DEFAULT '{}', -- snapshot of filters used to generate
    schema_version_used SMALLINT    DEFAULT 2,
    generated_by        TEXT,                              -- user id or 'system'
    expires_at          TIMESTAMPTZ,                       -- NULL = no expiry
    is_public           BOOLEAN     NOT NULL DEFAULT true,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE insight_reports IS
    'Metadata for generated public reports. Actual chart PNGs live in Supabase Storage. '
    'N>=5 redaction rule applied at generation time; suppressed widgets listed in redacted_widgets. '
    'Public viewer fetches pre-computed data from this table (no dynamic aggregation).';

CREATE INDEX IF NOT EXISTS idx_insight_reports_college_id
    ON insight_reports (college_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_insight_reports_public
    ON insight_reports (is_public, status)
    WHERE is_public = true AND status = 'ready';


-- =============================================================================
-- V1.1 STUB — COLLEGE PEER GROUPS
-- Schema is present in v1 so that peer comparison can drop in without a
-- breaking migration. No application code reads this table in v1.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- college_peer_groups
--   Maps a "focal" college to its peer colleges for comparison purposes.
--   relationship_type: 'peer' | 'aspirational'. Directional (A→B ≠ B→A).
--   Added in v1 as a placeholder; consumed by aggregation engine in v1.1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS college_peer_groups (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    focal_college_id    UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    peer_college_id     UUID        NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    relationship_type   TEXT        NOT NULL DEFAULT 'peer'
                                    CHECK (relationship_type IN ('peer','aspirational')),
    similarity_score    FLOAT,                             -- 0.0–1.0; NULL = manually asserted
    evidence            JSONB       NOT NULL DEFAULT '{}', -- e.g. {"shared_employers": 12}
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (focal_college_id, peer_college_id, relationship_type),
    CHECK (focal_college_id <> peer_college_id)
);

COMMENT ON TABLE college_peer_groups IS
    'v1.1 stub. Present in schema so peer comparison drops in without migration. '
    'Not read by any v1 application code. '
    'focal_college_id → peer_college_id mapping is directional.';

CREATE INDEX IF NOT EXISTS idx_college_peer_groups_focal
    ON college_peer_groups (focal_college_id, relationship_type);


-- =============================================================================
-- UPDATED_AT TRIGGER HELPER
-- Reuse if a generic moddatetime trigger already exists; otherwise define once.
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Apply updated_at trigger to all new tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'bucket_frameworks',
        'buckets',
        'college_bucket_access',
        'bucket_ctc_bands',
        'program_mapping_cache',
        'alumni_profile_snapshots',
        'insight_reports',
        'college_peer_groups'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_' || tbl || '_updated_at'
              AND tgrelid = tbl::regclass
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_%I_updated_at
                 BEFORE UPDATE ON %I
                 FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                tbl, tbl
            );
        END IF;
    END LOOP;
END;
$$;

-- =============================================================================
-- END OF MIGRATION 0001
-- =============================================================================
