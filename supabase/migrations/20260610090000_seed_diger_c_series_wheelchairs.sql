INSERT INTO public.wheelchairs (wheelchair_id, status, gate, terminal)
SELECT
  'Ç-' || gs::text AS wheelchair_id,
  'available' AS status,
  '' AS gate,
  'Diğer' AS terminal
FROM generate_series(1, 104) AS gs
ON CONFLICT (wheelchair_id) DO NOTHING;