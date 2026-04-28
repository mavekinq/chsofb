CREATE TABLE IF NOT EXISTS public.flight_plan_snapshots (
  snapshot_date date PRIMARY KEY,
  source_fetched_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_csv text NOT NULL DEFAULT ''
);

ALTER TABLE public.flight_plan_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flight_plan_snapshots'
      AND policyname = 'Public read flight_plan_snapshots'
  ) THEN
    CREATE POLICY "Public read flight_plan_snapshots"
    ON public.flight_plan_snapshots
    FOR SELECT
    USING (true);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_flight_plan_snapshots_created_at
ON public.flight_plan_snapshots (created_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'capture-flight-plan-daily-istanbul-0005'
  ) THEN
    PERFORM cron.unschedule('capture-flight-plan-daily-istanbul-0005');
  END IF;
END
$$;

SELECT
  cron.schedule(
    'capture-flight-plan-daily-istanbul-0005',
    '5 21 * * *',
    $$
    SELECT net.http_post(
      url := 'https://phkebmawlwlwtbxosafw.supabase.co/functions/v1/capture-flight-plan-snapshot',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $$
  );
