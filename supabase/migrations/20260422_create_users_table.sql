-- Create users table for staff authentication with security numbers
create table public.users (
  id uuid default gen_random_uuid() primary key,
  full_name text not null unique,
  security_number text,
  notification_enabled boolean default false,
  is_admin boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.users enable row level security;

-- Allow public (unauthenticated) select for login validation
create policy "Allow public select on users"
  on public.users
  as permissive
  for select
  using (true);

-- Allow public (unauthenticated) insert for first-time registration
create policy "Allow public insert on users"
  on public.users
  as permissive
  for insert
  with check (true);

-- Allow public update for user updates
create policy "Allow public update on users"
  on public.users
  as permissive
  for update
  using (true)
  with check (true);
