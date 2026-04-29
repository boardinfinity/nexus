-- Migration 030: Survey Admin v2
-- Adds multi-survey support: surveys, survey_invites, email_queue
-- Backfills legacy single-survey data into a new "Legacy MBA Skills Survey" record

-- ==================== 1. surveys table ====================
CREATE TABLE IF NOT EXISTS surveys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text,
  audience_type   text NOT NULL CHECK (audience_type IN ('employer','industry_sme','alumni','faculty','student','other')),
  college_id      uuid REFERENCES colleges(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed','archived')),
  schema          jsonb NOT NULL DEFAULT '{"sections":[],"settings":{}}'::jsonb,
  estimated_minutes integer,
  intro_markdown  text,
  thank_you_markdown text,
  version         integer NOT NULL DEFAULT 1,
  parent_survey_id uuid REFERENCES surveys(id) ON DELETE SET NULL,
  locked_at       timestamptz,
  created_by      uuid REFERENCES nexus_users(id) ON DELETE SET NULL,
  opens_at        timestamptz,
  closes_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surveys_college     ON surveys(college_id);
CREATE INDEX IF NOT EXISTS idx_surveys_status      ON surveys(status);
CREATE INDEX IF NOT EXISTS idx_surveys_audience    ON surveys(audience_type);
CREATE INDEX IF NOT EXISTS idx_surveys_slug        ON surveys(slug);

-- ==================== 2. survey_invites table ====================
CREATE TABLE IF NOT EXISTS survey_invites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id        uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  email            text NOT NULL,
  full_name        text,
  metadata         jsonb DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','opened','started','completed','bounced','failed')),
  invited_by       uuid REFERENCES nexus_users(id) ON DELETE SET NULL,
  invite_sent_at   timestamptz,
  last_reminder_at timestamptz,
  reminder_count   integer NOT NULL DEFAULT 0,
  bounced_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(survey_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invites_survey      ON survey_invites(survey_id);
CREATE INDEX IF NOT EXISTS idx_invites_email       ON survey_invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_status      ON survey_invites(survey_id, status);

-- ==================== 3. email_queue table ====================
CREATE TABLE IF NOT EXISTS email_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         text NOT NULL,                          -- 'survey_invite' | 'survey_reminder' | 'survey_otp' | other
  survey_id       uuid REFERENCES surveys(id) ON DELETE CASCADE,
  to_email        text NOT NULL,
  to_name         text,
  subject         text NOT NULL,
  body_text       text,
  body_html       text,
  payload         jsonb DEFAULT '{}'::jsonb,              -- template vars / context
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  last_attempt_at timestamptz,
  provider_msg_id text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_due     ON email_queue(status, scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_email_queue_survey  ON email_queue(survey_id);

-- ==================== 4. add survey_id to existing tables ====================
ALTER TABLE survey_respondents
  ADD COLUMN IF NOT EXISTS survey_id uuid REFERENCES surveys(id) ON DELETE CASCADE;

ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS survey_id uuid REFERENCES surveys(id) ON DELETE CASCADE;

ALTER TABLE survey_skill_ratings
  ADD COLUMN IF NOT EXISTS survey_id uuid REFERENCES surveys(id) ON DELETE CASCADE;

-- ==================== 5. backfill legacy survey ====================
-- Create the legacy survey record with the canonical schema we have hard-coded today
INSERT INTO surveys (id, slug, title, description, audience_type, status, schema, version, locked_at)
VALUES (
  '00000000-0000-0000-0000-00000000beef',
  'legacy-mba-skills',
  'MBA Skills & Hiring Survey (Legacy)',
  'Original Nexus MBA hiring & skills survey — preserved for historical responses. New surveys should be created via Survey Admin v2.',
  'employer',
  'archived',
  jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object('key','profile','title','Respondent Profile','order',1),
      jsonb_build_object('key','hiring_overview','title','Hiring Overview','order',2),
      jsonb_build_object('key','skill_ratings','title','Skill Importance & Demonstration','order',3),
      jsonb_build_object('key','gap_analysis','title','Gap Analysis','order',4),
      jsonb_build_object('key','emerging_trends','title','Emerging Trends','order',5)
    ),
    'settings', jsonb_build_object('legacy', true, 'show_progress', true)
  ),
  1,
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Backfill all existing data to point to the legacy survey
UPDATE survey_respondents   SET survey_id = '00000000-0000-0000-0000-00000000beef' WHERE survey_id IS NULL;
UPDATE survey_responses     SET survey_id = '00000000-0000-0000-0000-00000000beef' WHERE survey_id IS NULL;
UPDATE survey_skill_ratings SET survey_id = '00000000-0000-0000-0000-00000000beef' WHERE survey_id IS NULL;

-- ==================== 6. swap unique constraints to be per-survey ====================
-- survey_respondents.email was globally unique; v2 needs (survey_id, email) unique
ALTER TABLE survey_respondents DROP CONSTRAINT IF EXISTS survey_respondents_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_respondents_survey_email
  ON survey_respondents(survey_id, lower(email));

-- survey_responses upsert key was (respondent_id, section_key, question_key) — keep that, but
-- add a stronger index that also pins survey_id for analytics speed
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey
  ON survey_responses(survey_id, section_key, question_key);

CREATE INDEX IF NOT EXISTS idx_survey_skill_ratings_survey
  ON survey_skill_ratings(survey_id, skill_name);

-- Ensure survey_id becomes NOT NULL after backfill
ALTER TABLE survey_respondents   ALTER COLUMN survey_id SET NOT NULL;
ALTER TABLE survey_responses     ALTER COLUMN survey_id SET NOT NULL;
ALTER TABLE survey_skill_ratings ALTER COLUMN survey_id SET NOT NULL;

-- ==================== 7. updated_at trigger helper (idempotent) ====================
CREATE OR REPLACE FUNCTION set_updated_at_now()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_surveys_updated_at        ON surveys;
CREATE TRIGGER trg_surveys_updated_at        BEFORE UPDATE ON surveys        FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_survey_invites_updated_at ON survey_invites;
CREATE TRIGGER trg_survey_invites_updated_at BEFORE UPDATE ON survey_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ==================== Done ====================
COMMENT ON TABLE surveys         IS 'Survey Admin v2: each row = one survey definition (schema in jsonb).';
COMMENT ON TABLE survey_invites  IS 'Survey Admin v2: per-survey invite list with delivery & completion status.';
COMMENT ON TABLE email_queue     IS 'Survey Admin v2: outbound email queue (drained by daily cron, also flushed on demand).';
