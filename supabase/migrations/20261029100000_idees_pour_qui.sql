-- ============================================================
-- V2 : « Pour qui ? » sur les idées
-- ============================================================
-- Une idée peut concerner tout le cabinet (liste vide) ou une ou plusieurs équipes.
-- Colonne facultative avec valeur par défaut : l'ancienne version de l'app continue de fonctionner.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS recipient_teams text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION private.check_recipient_teams()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF cardinality(NEW.recipient_teams) > 20 THEN
    RAISE EXCEPTION 'Trop d''équipes destinataires (20 maximum).';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.recipient_teams) AS t(name)
    WHERE t.name IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams WHERE teams.name = t.name)
  ) THEN
    RAISE EXCEPTION 'Une des équipes destinataires n''existe pas.';
  END IF;
  -- doublons retirés, ordre stable
  NEW.recipient_teams := ARRAY(SELECT DISTINCT n FROM unnest(NEW.recipient_teams) AS n ORDER BY n);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS check_recipient_teams ON public.submissions;
CREATE TRIGGER check_recipient_teams
  BEFORE INSERT OR UPDATE OF recipient_teams ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION private.check_recipient_teams();

-- Les équipes citées dans une liste ne sont pas protégées par une clé étrangère :
-- on suit donc les renommages et on refuse la suppression d'une équipe encore citée.
CREATE OR REPLACE FUNCTION private.sync_recipient_teams()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      UPDATE public.submissions
         SET recipient_teams = array_replace(recipient_teams, OLD.name, NEW.name)
       WHERE OLD.name = ANY (recipient_teams);
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.submissions WHERE OLD.name = ANY (recipient_teams)) THEN
    RAISE EXCEPTION 'Cette équipe est encore citée comme destinataire d''une idée.';
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS sync_recipient_teams_upd ON public.teams;
CREATE TRIGGER sync_recipient_teams_upd
  AFTER UPDATE OF name ON public.teams
  FOR EACH ROW EXECUTE FUNCTION private.sync_recipient_teams();

DROP TRIGGER IF EXISTS sync_recipient_teams_del ON public.teams;
CREATE TRIGGER sync_recipient_teams_del
  BEFORE DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION private.sync_recipient_teams();
