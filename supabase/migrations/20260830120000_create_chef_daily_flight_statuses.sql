CREATE TABLE IF NOT EXISTS public.chef_daily_flight_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  flight_key text NOT NULL,
  flight_code text NOT NULL,
  departure_time text,
  stage text NOT NULL CHECK (stage IN ('hazirlik', 'boarding', 'gate-close')),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chef_daily_flight_statuses_snapshot_flight_key_unique UNIQUE (snapshot_date, flight_key)
);

ALTER TABLE public.chef_daily_flight_statuses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chef_daily_flight_statuses'
      AND policyname = 'Allow public select on chef_daily_flight_statuses'
  ) THEN
    CREATE POLICY "Allow public select on chef_daily_flight_statuses"
      ON public.chef_daily_flight_statuses
      FOR SELECT
      USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chef_daily_flight_statuses'
      AND policyname = 'Allow public insert on chef_daily_flight_statuses'
  ) THEN
    CREATE POLICY "Allow public insert on chef_daily_flight_statuses"
      ON public.chef_daily_flight_statuses
      FOR INSERT
      WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chef_daily_flight_statuses'
      AND policyname = 'Allow public update on chef_daily_flight_statuses'
  ) THEN
    CREATE POLICY "Allow public update on chef_daily_flight_statuses"
      ON public.chef_daily_flight_statuses
      FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chef_daily_flight_statuses'
      AND policyname = 'Allow public delete on chef_daily_flight_statuses'
  ) THEN
    CREATE POLICY "Allow public delete on chef_daily_flight_statuses"
      ON public.chef_daily_flight_statuses
      FOR DELETE
      USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chef_daily_flight_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chef_daily_flight_statuses;
  END IF;
END;
$$;