-- Enable pg_cron extension (already available in Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Schedule sync-google-sheets-auto edge function to run every minute
-- Uses pg_net (built-in to Supabase) for outbound HTTP calls
select
  cron.schedule(
    'sync-google-sheets-auto-1min',
    '* * * * *',
    $$
    select net.http_post(
      url := 'https://phkebmawlwlwtbxosafw.supabase.co/functions/v1/sync-google-sheets-auto',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $$
  );
