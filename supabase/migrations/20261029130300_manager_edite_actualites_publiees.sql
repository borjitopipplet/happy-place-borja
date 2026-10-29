-- ============================================================
-- V2 : un manager corrige les actualités publiées, les siennes et celles de son équipe
-- ============================================================
-- « De son équipe » = écrites par un manager qui partage au moins une de ses équipes.
-- Il peut modifier le contenu (titre, texte, liens, média, destinataires), pas dépublier
-- ni changer l'auteur ou la date.

CREATE OR REPLACE FUNCTION private.manager_can_edit_news(_author_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.current_app_role() = 'manager'::public.app_role
    AND (
      lower(coalesce(_author_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      OR EXISTS (
        SELECT 1
        FROM public.manager_teams mt
        JOIN public.allowed_users au ON au.id = mt.allowed_user_id
        WHERE au.email = lower(coalesce(_author_email, ''))
          AND private.can_review_team(mt.team)
      )
    )
$$;

DROP POLICY IF EXISTS "Managers update team published news" ON public.news;
CREATE POLICY "Managers update team published news" ON public.news
  FOR UPDATE TO authenticated
  USING (status = 'publiée' AND private.manager_can_edit_news(author_email))
  WITH CHECK (status = 'publiée' AND private.manager_can_edit_news(author_email));

CREATE OR REPLACE FUNCTION private.guard_news_manager_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF private.current_app_role() = 'manager'::public.app_role THEN
    IF NEW.author_email IS DISTINCT FROM OLD.author_email
       OR NEW.author IS DISTINCT FROM OLD.author
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Un manager ne peut pas changer l''auteur ni la date d''une actualité.';
    END IF;
    IF OLD.status = 'publiée'::public.news_status AND NEW.status <> 'publiée'::public.news_status THEN
      RAISE EXCEPTION 'Une actualité publiée ne peut pas être remise en brouillon par un manager.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_news_manager_edit ON public.news;
CREATE TRIGGER guard_news_manager_edit
  BEFORE UPDATE ON public.news
  FOR EACH ROW EXECUTE FUNCTION private.guard_news_manager_edit();

-- Le média d'une actualité suit les mêmes droits
CREATE OR REPLACE FUNCTION private.can_edit_news_media(_news_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.is_admin() OR EXISTS (
    SELECT 1 FROM public.news n
    WHERE n.id::text = _news_id
      AND private.current_app_role() = 'manager'
      AND (
        (n.status = 'brouillon' AND n.author_email = lower(auth.jwt() ->> 'email'))
        OR (n.status = 'publiée' AND private.manager_can_edit_news(n.author_email))
      ))
$$;

-- Les actualités publiées que l'utilisateur peut modifier (une seule définition des droits, côté base)
CREATE OR REPLACE FUNCTION public.editable_news_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT n.id FROM public.news n
  WHERE private.is_allowed()
    AND n.status = 'publiée'
    AND (private.is_admin() OR private.manager_can_edit_news(n.author_email))
$$;

REVOKE ALL ON FUNCTION public.editable_news_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editable_news_ids() TO authenticated;
