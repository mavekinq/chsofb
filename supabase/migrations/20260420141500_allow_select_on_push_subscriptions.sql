DROP POLICY IF EXISTS "Push subscriptions are readable" ON public.push_subscriptions;

CREATE POLICY "Push subscriptions are readable"
ON public.push_subscriptions
FOR SELECT
USING (TRUE);