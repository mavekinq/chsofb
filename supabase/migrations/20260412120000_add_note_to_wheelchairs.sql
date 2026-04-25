-- Add note column to wheelchairs table
ALTER TABLE public.wheelchairs
  ADD COLUMN note TEXT DEFAULT '';
