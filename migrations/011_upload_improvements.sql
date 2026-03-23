-- Migration 011: Upload improvements — company name dedup
-- Add normalized name to companies for fuzzy matching

ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_normalized TEXT;
CREATE INDEX IF NOT EXISTS idx_companies_name_normalized ON companies(name_normalized);

-- Backfill normalized names: lowercase, strip common suffixes, normalize whitespace
UPDATE companies SET name_normalized = TRIM(REGEXP_REPLACE(
  REGEXP_REPLACE(
    LOWER(name),
    '\s*(pvt\.?\s*ltd\.?|ltd\.?|inc\.?|llc|corp\.?|corporation|private\s+limited|limited|india)\s*$',
    '',
    'gi'
  ),
  '\s+', ' ', 'g'
));
