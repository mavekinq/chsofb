-- Work schedule history: stores all previously uploaded schedules
CREATE TABLE public.work_schedule_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  week_range text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE public.work_schedule_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to work_schedule_history"
  ON public.work_schedule_history
  FOR ALL
  USING (true)
  WITH CHECK (true);
