DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname
    INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.wheelchairs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%terminal%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.wheelchairs DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.wheelchairs
    ADD CONSTRAINT wheelchairs_terminal_check
    CHECK (terminal IN ('İç Hat', 'T1', 'T2', 'Diğer'));
END $$;