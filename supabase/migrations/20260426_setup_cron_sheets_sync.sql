-- Enable required extensions for pg_cron and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Schedule sync-google-sheets-auto edge function to run every minute
-- This automatically queries the database and sends data to Google Sheets
select
  cron.schedule(
    'sync-google-sheets-auto-1min',
    '* * * * *',
    'select http_post(
      ''https://'' || current_setting(''db.name'') || ''.supabase.co/functions/v1/sync-google-sheets-auto'',
      '''{}''::jsonb,
      ''{"Content-Type": "application/json"}''::jsonb
    );'
  );
