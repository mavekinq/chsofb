-- Add terminal column to shifts table for shift management
ALTER TABLE public.shifts
  ADD COLUMN terminal TEXT NOT NULL DEFAULT 'İç Hat' CHECK (terminal IN ('İç Hat', 'Dış Hat'));
