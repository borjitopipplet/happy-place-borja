-- ============================================================
-- V2 : personne ne valide ni ne refuse sa propre idée
-- ============================================================
-- Une idée envoyée par un manager est traitée par un autre manager de l'équipe ou par un admin.
-- Un admin ne peut traiter sa propre idée que s'il est le seul admin (sinon elle resterait bloquée).

CREATE OR REPLACE FUNCTION private.enforce_submission_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _email text := lower(nullif(auth.jwt() ->> 'email', ''));
BEGIN
  IF _email IS NOT NULL
     AND OLD.status = 'en attente'::public.submission_status
     AND NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.submitted_by_email, '')) = _email
     AND (
       private.current_app_role() IS DISTINCT FROM 'admin'::public.app_role
       OR (SELECT count(*) FROM public.allowed_user_roles WHERE role = 'admin'::public.app_role) > 1
     ) THEN
    RAISE EXCEPTION 'Tu ne peux pas valider ni refuser ta propre idée : un autre manager de l''équipe ou un admin la traite.';
  END IF;

  IF private.current_app_role() = 'manager'::public.app_role THEN
    IF NEW.author_name IS DISTINCT FROM OLD.author_name
       OR NEW.team IS DISTINCT FROM OLD.team
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.status NOT IN ('validée'::public.submission_status, 'refusée'::public.submission_status)
       OR OLD.status <> 'en attente'::public.submission_status
       OR NOT private.can_review_team(OLD.team) THEN
      RAISE EXCEPTION 'Un manager peut uniquement valider ou refuser une soumission en attente de ses équipes';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
