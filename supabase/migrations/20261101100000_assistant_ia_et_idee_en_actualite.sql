-- Assistant « Améliorer » et idées publiées en actualité.
-- 1. Les idées ont un titre (facultatif pour les anciennes, demandé par le formulaire).
-- 2. Quota quotidien de l'assistant par personne (la fonction ameliorer-texte le consomme).
-- 3. Un manager ou un admin qui a validé une idée peut la publier en actualité, une seule fois.

-- 1. Titre des idées
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_title_length;
ALTER TABLE public.submissions ADD CONSTRAINT submissions_title_length
  CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120);

-- Un manager ne modifie pas non plus le titre d'une idée qu'il traite.
CREATE OR REPLACE FUNCTION private.enforce_submission_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
       OR NEW.title IS DISTINCT FROM OLD.title
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
$function$;

-- 2. Quota de l'assistant : 30 demandes par personne et par jour.
CREATE TABLE IF NOT EXISTS private.assistant_ia_usage (
  email text NOT NULL,
  jour date NOT NULL DEFAULT current_date,
  nombre integer NOT NULL DEFAULT 0,
  PRIMARY KEY (email, jour)
);

CREATE OR REPLACE FUNCTION public.consommer_quota_ia()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  _email text := lower(nullif(auth.jwt() ->> 'email', ''));
  _n integer;
BEGIN
  IF _email IS NULL OR NOT private.is_allowed() THEN
    RAISE EXCEPTION 'Connecte-toi pour utiliser l''assistant.';
  END IF;
  INSERT INTO private.assistant_ia_usage AS u (email, jour, nombre)
  VALUES (_email, current_date, 1)
  ON CONFLICT (email, jour) DO UPDATE SET nombre = u.nombre + 1
  RETURNING nombre INTO _n;
  DELETE FROM private.assistant_ia_usage WHERE jour < current_date - 30;
  RETURN _n <= 30;
END
$function$;
REVOKE ALL ON FUNCTION public.consommer_quota_ia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consommer_quota_ia() TO authenticated;

-- 3. Lien actualité → idée d'origine (une idée devient au plus une actualité).
ALTER TABLE public.news ADD COLUMN IF NOT EXISTS source_submission_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'news_source_submission_unique') THEN
    ALTER TABLE public.news ADD CONSTRAINT news_source_submission_unique UNIQUE (source_submission_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'news_source_submission_fkey') THEN
    ALTER TABLE public.news ADD CONSTRAINT news_source_submission_fkey
      FOREIGN KEY (source_submission_id) REFERENCES public.submissions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Publie une idée validée en actualité : titre et texte de l'idée, signée par son auteur,
-- pour les mêmes destinataires. L'actualité est rattachée à la personne qui publie (author_email),
-- ce qui permet aux managers de l'équipe de la corriger ensuite.
CREATE OR REPLACE FUNCTION public.publier_idee_en_actualite(p_submission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  _email text := lower(nullif(auth.jwt() ->> 'email', ''));
  _s public.submissions%ROWTYPE;
  _titre text;
  _id uuid;
BEGIN
  SELECT * INTO _s FROM public.submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idée introuvable.';
  END IF;
  IF NOT (private.is_admin() OR (private.current_app_role() = 'manager'::public.app_role AND private.can_review_team(_s.team))) THEN
    RAISE EXCEPTION 'Tu ne peux pas publier cette idée.';
  END IF;
  IF lower(coalesce(_s.submitted_by_email, '')) = _email THEN
    RAISE EXCEPTION 'Tu ne peux pas publier ta propre idée.';
  END IF;
  IF _s.status <> 'validée'::public.submission_status THEN
    RAISE EXCEPTION 'Seule une idée validée peut devenir une actualité.';
  END IF;

  -- Anciennes idées sans titre : le début du texte.
  _titre := nullif(btrim(_s.title), '');
  IF _titre IS NULL THEN
    _titre := btrim(split_part(_s.content, E'\n', 1));
    IF char_length(_titre) > 80 THEN
      _titre := btrim(left(_titre, 77)) || '…';
    END IF;
  END IF;

  INSERT INTO public.news (title, body, author, author_email, status, recipient_teams, source_submission_id)
  VALUES (_titre, _s.content, _s.author_name, _email, 'publiée'::public.news_status, _s.recipient_teams, _s.id)
  ON CONFLICT (source_submission_id) DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;
REVOKE ALL ON FUNCTION public.publier_idee_en_actualite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publier_idee_en_actualite(uuid) TO authenticated;
