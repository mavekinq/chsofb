
CREATE POLICY "Public delete wheelchairs"
ON public.wheelchairs
FOR DELETE
USING (true);

CREATE POLICY "Public update shifts"
ON public.shifts
FOR UPDATE
USING (true);
