DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wheelchair_services'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wheelchair_services;
  END IF;
END;
$$;