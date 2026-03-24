-- Migration 019: Security Hardening
-- Drop the exec_sql function that allows arbitrary SQL execution.
-- All migrations have been applied; this function is no longer needed.

DROP FUNCTION IF EXISTS exec_sql(text);
