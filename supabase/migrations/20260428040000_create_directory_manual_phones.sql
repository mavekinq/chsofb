create table if not exists public.directory_manual_phones (
  name text primary key,
  phone text not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.directory_manual_phones enable row level security;

create policy "Allow public select on directory_manual_phones"
  on public.directory_manual_phones
  as permissive
  for select
  using (true);

create policy "Allow public insert on directory_manual_phones"
  on public.directory_manual_phones
  as permissive
  for insert
  with check (true);

create policy "Allow public update on directory_manual_phones"
  on public.directory_manual_phones
  as permissive
  for update
  using (true)
  with check (true);

create policy "Allow public delete on directory_manual_phones"
  on public.directory_manual_phones
  as permissive
  for delete
  using (true);
