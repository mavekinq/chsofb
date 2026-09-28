ALTER TABLE public.chef_daily_flight_statuses
  ADD COLUMN IF NOT EXISTS stage_updated_by jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_reminders_sent jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.claim_chef_daily_stage_reminder(
  p_id uuid,
  p_stage_key text,
  p_stage_timestamp text,
  p_reminder_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_stage_key text;
  claimed_id uuid;
BEGIN
  IF p_stage_key NOT IN ('hazirlik', 'boarding') THEN
    RAISE EXCEPTION 'Invalid stage key';
  END IF;

  IF p_reminder_key IS NULL OR length(p_reminder_key) > 200 THEN
    RAISE EXCEPTION 'Invalid reminder key';
  END IF;

  next_stage_key := CASE p_stage_key
    WHEN 'hazirlik' THEN 'boarding'
    ELSE 'gate-close'
  END;

  UPDATE public.chef_daily_flight_statuses
  SET stage_reminders_sent = jsonb_set(
    COALESCE(stage_reminders_sent, '{}'::jsonb),
    ARRAY[p_reminder_key],
    to_jsonb('sending'::text),
    true
  )
  WHERE id = p_id
    AND stage_times ->> p_stage_key = p_stage_timestamp
    AND NULLIF(stage_times ->> next_stage_key, '') IS NULL
    AND COALESCE(stage_reminders_sent ->> p_reminder_key, '') = ''
  RETURNING id INTO claimed_id;

  RETURN claimed_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_chef_daily_stage_reminder(
  p_id uuid,
  p_reminder_key text,
  p_sent boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sent THEN
    UPDATE public.chef_daily_flight_statuses
    SET stage_reminders_sent = jsonb_set(
      COALESCE(stage_reminders_sent, '{}'::jsonb),
      ARRAY[p_reminder_key],
      to_jsonb('sent'::text),
      true
    )
    WHERE id = p_id
      AND stage_reminders_sent ->> p_reminder_key = 'sending';
  ELSE
    UPDATE public.chef_daily_flight_statuses
    SET stage_reminders_sent = COALESCE(stage_reminders_sent, '{}'::jsonb) - p_reminder_key
    WHERE id = p_id
      AND stage_reminders_sent ->> p_reminder_key = 'sending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_chef_daily_stage_reminder(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_chef_daily_stage_reminder(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chef_daily_stage_reminder(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_chef_daily_stage_reminder(uuid, text, boolean) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'chef-daily-stage-reminders-1min';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'chef-daily-stage-reminders-1min',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://phkebmawlwlwtbxosafw.supabase.co/functions/v1/process-chef-daily-stage-reminders',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $job$
  );
END;
$$;
