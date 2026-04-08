-- Migration 022: Add text storage and chunk progress for reliable report processing
-- Enables resumable, chunked processing without re-downloading files

ALTER TABLE secondary_reports ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE secondary_reports ADD COLUMN IF NOT EXISTS chunk_progress JSONB DEFAULT '{"completed":[],"results":{}}'::jsonb;
ALTER TABLE secondary_reports ADD COLUMN IF NOT EXISTS total_chars INTEGER;
