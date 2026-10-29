-- ============================================================
-- V2 : préférences de notification (le résumé hebdomadaire est une option, désactivée par défaut)
-- ============================================================
-- Aucune notification n'est encore envoyée : cette table ne fait que mémoriser le choix de chaque personne,
-- pour que la future automatisation (Make) sache à qui envoyer le résumé.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  email text PRIMARY KEY CHECK (email = lower(email)),
  weekly_summary boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own notification preferences" ON public.notification_preferences;
CREATE POLICY "Read own notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (private.is_allowed() AND email = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Create own notification preferences" ON public.notification_preferences;
CREATE POLICY "Create own notification preferences" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (private.is_allowed() AND email = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Update own notification preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (private.is_allowed() AND email = lower(auth.jwt() ->> 'email'))
  WITH CHECK (private.is_allowed() AND email = lower(auth.jwt() ->> 'email'));

CREATE OR REPLACE FUNCTION private.touch_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS touch_notification_preferences ON public.notification_preferences;
CREATE TRIGGER touch_notification_preferences
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.touch_notification_preferences();
