-- ============================================================
-- V2 : « sans mise à jour depuis plus de 7 jours » repose sur updated_at
-- ============================================================
-- Jusqu'ici c'est le navigateur qui renseignait updated_at. La base le fait désormais
-- elle-même à chaque modification : la règle des 7 jours ne dépend plus de l'écran utilisé.

CREATE OR REPLACE FUNCTION private.touch_blocker_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS touch_blocker_updated_at ON public.blockers;
CREATE TRIGGER touch_blocker_updated_at
  BEFORE UPDATE ON public.blockers
  FOR EACH ROW EXECUTE FUNCTION private.touch_blocker_updated_at();
