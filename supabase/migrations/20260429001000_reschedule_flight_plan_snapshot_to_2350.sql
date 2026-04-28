DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'capture-flight-plan-daily-istanbul-0005'
  ) THEN
    PERFORM cron.unschedule('capture-flight-plan-daily-istanbul-0005');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'capture-flight-plan-daily-istanbul-2350'
  ) THEN
    PERFORM cron.unschedule('capture-flight-plan-daily-istanbul-2350');
  END IF;
END
$$;

SELECT
  cron.schedule(
    'capture-flight-plan-daily-istanbul-2350',
    '50 20 * * *',
    $$
    SELECT net.http_post(
      url := 'https://phkebmawlwlwtbxosafw.supabase.co/functions/v1/capture-flight-plan-snapshot',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $$
  );