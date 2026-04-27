-- Central weekly work schedule state shared across all devices
CREATE TABLE IF NOT EXISTS public.work_schedule_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_schedule_state ENABLE ROW LEVEL SECURITY;

-- Public read/write to match existing app access pattern
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_schedule_state'
      AND policyname = 'Public read work_schedule_state'
  ) THEN
    CREATE POLICY "Public read work_schedule_state"
    ON public.work_schedule_state
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
      AND tablename = 'work_schedule_state'
      AND policyname = 'Public insert work_schedule_state'
  ) THEN
    CREATE POLICY "Public insert work_schedule_state"
    ON public.work_schedule_state
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
      AND tablename = 'work_schedule_state'
      AND policyname = 'Public update work_schedule_state'
  ) THEN
    CREATE POLICY "Public update work_schedule_state"
    ON public.work_schedule_state
    FOR UPDATE
    USING (true)
    WITH CHECK (true);
  END IF;
END
$$;

-- Seed singleton row with an empty payload object if missing; app will overwrite with full payload.
INSERT INTO public.work_schedule_state (id, payload)
VALUES ('global', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
