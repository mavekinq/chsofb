CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription JSONB NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION public.set_push_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  NEW.last_seen_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_push_subscriptions_updated_at ON public.push_subscriptions;

CREATE TRIGGER set_push_subscriptions_updated_at
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.set_push_subscriptions_updated_at();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Push subscriptions are insertable" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions are insertable"
ON public.push_subscriptions
FOR INSERT
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Push subscriptions are updatable" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions are updatable"
ON public.push_subscriptions
FOR UPDATE
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Push subscriptions are deletable" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions are deletable"
ON public.push_subscriptions
FOR DELETE
USING (TRUE);