-- Create wheelchair_services table for tracking wheelchair services per flight
CREATE TABLE public.wheelchair_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flight_iata TEXT NOT NULL,
  wheelchair_id TEXT NOT NULL,
  passenger_type TEXT NOT NULL CHECK (passenger_type IN ('STEP', 'RAMP', 'CABIN')),
  notes TEXT NOT NULL DEFAULT '',
  terminal TEXT NOT NULL DEFAULT 'T1' CHECK (terminal IN ('T1', 'T2')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'Personel'
);

-- Enable RLS
ALTER TABLE public.wheelchair_services ENABLE ROW LEVEL SECURITY;

-- Allow all operations for any user (public table)
CREATE POLICY "Allow all public operations" ON public.wheelchair_services FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.wheelchair_services;