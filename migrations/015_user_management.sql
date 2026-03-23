-- Migration 015: User Management & Role-Based Access Control
-- Creates nexus_users table for RBAC and seeds super_admin

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (who can access Nexus)
CREATE TABLE IF NOT EXISTS nexus_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer', -- super_admin, admin, editor, viewer, college_rep
    is_active BOOLEAN DEFAULT true,
    avatar_url TEXT,

    -- For college_rep role: restrict to specific colleges/regions
    restricted_college_ids UUID[], -- null = all colleges
    restricted_regions TEXT[], -- null = all regions (state-level)

    -- Section permissions (JSONB: { "dashboard": "full", "jobs": "read", ... })
    -- If null, derive from role defaults
    permissions JSONB,

    last_login_at TIMESTAMPTZ,
    invited_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nexus_users_email ON nexus_users(email);
CREATE INDEX IF NOT EXISTS idx_nexus_users_role ON nexus_users(role);

-- Seed super_admin
INSERT INTO nexus_users (email, name, role, permissions)
VALUES ('abhay@boardinfinity.com', 'Abhay Gupta', 'super_admin', null)
ON CONFLICT (email) DO NOTHING;
