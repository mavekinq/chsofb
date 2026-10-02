ALTER TABLE public.wheelchair_services
  ADD COLUMN passenger_name TEXT,
  ADD COLUMN passenger_seat TEXT,
  ADD COLUMN delivery_stage TEXT CHECK (delivery_stage IN ('ready', 'gate', 'boarding', 'completed')),
  ADD COLUMN delivery_stage_updated_at TIMESTAMPTZ,
  ADD COLUMN delivery_stage_updated_by TEXT;
