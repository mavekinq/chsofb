create table public.airline_terminal_rules (
  id uuid default gen_random_uuid() primary key,
  airline_code text not null unique,
  terminal_code text not null check (terminal_code in ('T1', 'T2')),
  is_active boolean default true not null,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

insert into public.airline_terminal_rules (airline_code, terminal_code, note)
values
  ('PC', 'T1', 'Pegasus ic hat/T1 eslemesi'),
  ('4M', 'T2', 'Varsayilan T2 havayolu'),
  ('KC', 'T2', 'Varsayilan T2 havayolu'),
  ('TB', 'T2', 'Varsayilan T2 havayolu'),
  ('W9', 'T2', 'Varsayilan T2 havayolu'),
  ('BY', 'T2', 'Varsayilan T2 havayolu'),
  ('OR', 'T2', 'Varsayilan T2 havayolu'),
  ('OL', 'T2', 'Varsayilan T2 havayolu'),
  ('B2', 'T2', 'Yeni eklenen T2 havayolu')
on conflict (airline_code) do update
set
  terminal_code = excluded.terminal_code,
  note = excluded.note,
  is_active = true,
  updated_at = timezone('utc'::text, now());

alter table public.airline_terminal_rules enable row level security;

create policy "Allow public select on airline terminal rules"
  on public.airline_terminal_rules
  as permissive
  for select
  using (true);
