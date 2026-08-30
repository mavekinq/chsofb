ALTER TABLE public.chef_daily_flight_statuses
ADD COLUMN IF NOT EXISTS stage_times jsonb NOT NULL DEFAULT '{}'::jsonb;