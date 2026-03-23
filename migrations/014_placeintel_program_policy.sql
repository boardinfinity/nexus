-- Migration: Add dream_offer_policy to placement_programs table
-- This moves dream offer policy from college-level (placement_profiles) to program-level
-- since MBA and B.Tech programs have completely different placement policies.

ALTER TABLE placement_programs ADD COLUMN IF NOT EXISTS dream_offer_policy TEXT;
