CREATE TABLE IF NOT EXISTS public.briefings_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.briefings_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'briefings_state'
      AND policyname = 'Public read briefings_state'
  ) THEN
    CREATE POLICY "Public read briefings_state"
    ON public.briefings_state
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
      AND tablename = 'briefings_state'
      AND policyname = 'Public insert briefings_state'
  ) THEN
    CREATE POLICY "Public insert briefings_state"
    ON public.briefings_state
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
      AND tablename = 'briefings_state'
      AND policyname = 'Public update briefings_state'
  ) THEN
    CREATE POLICY "Public update briefings_state"
    ON public.briefings_state
    FOR UPDATE
    USING (true)
    WITH CHECK (true);
  END IF;
END
$$;

INSERT INTO public.briefings_state (id, payload)
VALUES (
  'global',
  '["Pazartesi 08:30: Haftalik operasyon brifingi", "Carsamba 14:00: T2 ekip koordinasyon toplantisi", "Cuma 16:30: Hafta sonu yogunluk planlamasi"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
