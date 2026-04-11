-- Create wheelchairs table
CREATE TABLE public.wheelchairs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wheelchair_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'missing', 'maintenance')),
  gate TEXT NOT NULL DEFAULT '',
  terminal TEXT NOT NULL DEFAULT 'İç Hat' CHECK (terminal IN ('İç Hat', 'T1', 'T2')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create action_logs table
CREATE TABLE public.action_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wheelchair_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  performed_by TEXT NOT NULL DEFAULT 'Personel',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create shifts table
CREATE TABLE public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_name TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.wheelchairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Public access policies (staff tool, no auth required)
CREATE POLICY "Public read wheelchairs" ON public.wheelchairs FOR SELECT USING (true);
CREATE POLICY "Public update wheelchairs" ON public.wheelchairs FOR UPDATE USING (true);
CREATE POLICY "Public insert wheelchairs" ON public.wheelchairs FOR INSERT WITH CHECK (true);

CREATE POLICY "Public read action_logs" ON public.action_logs FOR SELECT USING (true);
CREATE POLICY "Public insert action_logs" ON public.action_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Public read shifts" ON public.shifts FOR SELECT USING (true);
CREATE POLICY "Public insert shifts" ON public.shifts FOR INSERT WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.wheelchairs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.action_logs;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_wheelchairs_updated_at
  BEFORE UPDATE ON public.wheelchairs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample wheelchair data
INSERT INTO public.wheelchairs (wheelchair_id, status, gate, terminal) VALUES
  ('TS-001', 'available', 'Gate 1', 'İç Hat'),
  ('TS-002', 'available', 'Gate 3', 'İç Hat'),
  ('TS-003', 'missing', 'Gate 5', 'İç Hat'),
  ('TS-004', 'maintenance', 'Gate 2', 'İç Hat'),
  ('TS-005', 'available', 'Gate 7', 'İç Hat'),
  ('TS-006', 'available', 'Gate 1', 'T1'),
  ('TS-007', 'missing', 'Gate 4', 'T1'),
  ('TS-008', 'available', 'Gate 6', 'T1'),
  ('TS-009', 'maintenance', 'Gate 2', 'T1'),
  ('TS-010', 'available', 'Gate 1', 'T2'),
  ('TS-011', 'available', 'Gate 3', 'T2'),
  ('TS-012', 'missing', 'Gate 5', 'T2');
