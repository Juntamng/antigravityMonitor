-- Migration 3: denormalize user_id on alerts + agent polling indexes
-- Apply in Supabase SQL Editor or via `supabase db push` if using CLI.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

UPDATE alerts a
SET user_id = m.user_id
FROM monitors m
WHERE a.monitor_id = m.id
  AND a.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_monitors_agent_due
  ON monitors (assigned_agent, next_check_at)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts (user_id);
