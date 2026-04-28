-- Create flight_notes table for storing operational notes per flight per day
CREATE TABLE public.flight_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  flight_iata text NOT NULL,
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  note text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (flight_iata, note_date)
);

-- Enable RLS
ALTER TABLE public.flight_notes ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated and anon access (same pattern as other tables)
CREATE POLICY "Allow all access to flight_notes"
  ON public.flight_notes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-cleanup: delete notes older than today (runs via pg_cron or can be called manually)
-- A trigger to auto-set updated_at
CREATE OR REPLACE FUNCTION public.update_flight_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language plpgsql;

CREATE TRIGGER update_flight_notes_updated_at
  BEFORE UPDATE ON public.flight_notes
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_flight_notes_updated_at();
