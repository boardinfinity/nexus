-- Migration 007: People Enrichment via Apify
-- Adds new columns to people table for LinkedIn profile enrichment data

ALTER TABLE people ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]';
ALTER TABLE people ADD COLUMN IF NOT EXISTS languages_spoken TEXT[];
ALTER TABLE people ADD COLUMN IF NOT EXISTS volunteer_work JSONB DEFAULT '[]';
ALTER TABLE people ADD COLUMN IF NOT EXISTS publications JSONB DEFAULT '[]';
ALTER TABLE people ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS connections_count INTEGER;
ALTER TABLE people ADD COLUMN IF NOT EXISTS career_transitions JSONB DEFAULT '[]';
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;
