-- ============================================================
-- V2 : « Pour : … » sur les actualités
-- ============================================================
-- Liste vide = tout le cabinet. Information et filtre d'affichage seulement :
-- les règles de lecture des actualités publiées ne changent pas.

ALTER TABLE public.news
  ADD COLUMN IF NOT EXISTS recipient_teams text[] NOT NULL DEFAULT '{}';

DROP TRIGGER IF EXISTS check_recipient_teams ON public.news;
CREATE TRIGGER check_recipient_teams
  BEFORE INSERT OR UPDATE OF recipient_teams ON public.news
  FOR EACH ROW EXECUTE FUNCTION private.check_recipient_teams();

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
      UPDATE public.news
         SET recipient_teams = array_replace(recipient_teams, OLD.name, NEW.name)
       WHERE OLD.name = ANY (recipient_teams);
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.submissions WHERE OLD.name = ANY (recipient_teams))
     OR EXISTS (SELECT 1 FROM public.news WHERE OLD.name = ANY (recipient_teams)) THEN
    RAISE EXCEPTION 'Cette équipe est encore citée comme destinataire d''une idée ou d''une actualité.';
  END IF;
  RETURN OLD;
END
$$;
