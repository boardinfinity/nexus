-- Migration 016: Convert enum columns to TEXT for flexibility at scale
-- Enums can't be extended without ALTER TYPE which is restrictive

-- 1. Jobs: source column (currently enum)
ALTER TABLE jobs ALTER COLUMN source TYPE TEXT USING source::TEXT;

-- 2. Jobs: enrichment_status column (currently enum)
ALTER TABLE jobs ALTER COLUMN enrichment_status TYPE TEXT USING enrichment_status::TEXT;

-- 3. Jobs: seniority_level column (currently enum)
ALTER TABLE jobs ALTER COLUMN seniority_level TYPE TEXT USING seniority_level::TEXT;

-- 4. Jobs: employment_type column (currently enum)
ALTER TABLE jobs ALTER COLUMN employment_type TYPE TEXT USING employment_type::TEXT;

-- 5. People: enrichment_status column (currently enum without "pending" value)
ALTER TABLE people ALTER COLUMN enrichment_status TYPE TEXT USING enrichment_status::TEXT;

-- 6. People: seniority column (if enum)
ALTER TABLE people ALTER COLUMN seniority TYPE TEXT USING seniority::TEXT;

-- 7. People: function column (if enum)
ALTER TABLE people ALTER COLUMN function TYPE TEXT USING function::TEXT;

-- 8. Companies: enrichment_status column (if enum)
ALTER TABLE companies ALTER COLUMN enrichment_status TYPE TEXT USING enrichment_status::TEXT;

-- Now drop the old enum types (they may fail if still referenced, that's OK)
DO $$
BEGIN
  DROP TYPE IF EXISTS job_source CASCADE;
  DROP TYPE IF EXISTS enrichment_status CASCADE;
  DROP TYPE IF EXISTS seniority_level CASCADE;
  DROP TYPE IF EXISTS employment_type CASCADE;
EXCEPTION WHEN OTHERS THEN
  -- Ignore if types don't exist or are still referenced
  NULL;
END $$;

-- Update analytics RPC functions to remove ::text casts (no longer needed)
-- The existing ::text casts won't break but are now unnecessary
