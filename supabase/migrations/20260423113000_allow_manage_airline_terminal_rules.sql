create policy "Allow public insert on airline terminal rules"
  on public.airline_terminal_rules
  as permissive
  for insert
  with check (true);

create policy "Allow public update on airline terminal rules"
  on public.airline_terminal_rules
  as permissive
  for update
  using (true)
  with check (true);

create policy "Allow public delete on airline terminal rules"
  on public.airline_terminal_rules
  as permissive
  for delete
  using (true);
