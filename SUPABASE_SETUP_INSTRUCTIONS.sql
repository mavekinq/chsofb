-- ============================================================
-- WHEELIE WATCH PRO - Users Table Setup
-- ============================================================
-- This SQL creates the users table for staff authentication
-- 
-- INSTRUCTIONS:
-- 1. Go to your Supabase Project Dashboard
-- 2. Click "SQL Editor" in the left sidebar
-- 3. Click "New Query"
-- 4. Copy and paste ALL of this SQL code
-- 5. Click "Run"
-- ============================================================

-- Create users table
CREATE TABLE public.users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL UNIQUE,
  security_number text,
  notification_enabled boolean DEFAULT false,
  is_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Allow public SELECT (for login checking)
CREATE POLICY "Allow public select on users"
  ON public.users
  AS PERMISSIVE
  FOR SELECT
  USING (true);

-- RLS Policy 2: Allow public INSERT (for first registration)
CREATE POLICY "Allow public insert on users"
  ON public.users
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (true);

-- RLS Policy 3: Allow public UPDATE (for updates)
CREATE POLICY "Allow public update on users"
  ON public.users
  AS PERMISSIVE
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- DONE! The users table is now ready.
-- ============================================================
