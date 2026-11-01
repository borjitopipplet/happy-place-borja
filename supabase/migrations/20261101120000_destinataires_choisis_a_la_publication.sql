-- Les destinataires d'une idée publiée en actualité sont choisis par le manager ou l'admin qui la publie,
-- et non plus par l'auteur de l'idée (le formulaire d'idées ne demande plus « Pour qui ? »).
-- p_recipient_teams vide = tout le cabinet.
DROP FUNCTION IF EXISTS public.publier_idee_en_actualite(uuid);

CREATE OR REPLACE FUNCTION public.publier_idee_en_actualite(p_submission_id uuid, p_recipient_teams text[] DEFAULT '{}')
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

  -- Les équipes inconnues ou trop nombreuses sont refusées par le déclencheur check_recipient_teams.
  INSERT INTO public.news (title, body, author, author_email, status, recipient_teams, source_submission_id)
  VALUES (_titre, _s.content, _s.author_name, _email, 'publiée'::public.news_status,
          coalesce(p_recipient_teams, '{}'), _s.id)
  ON CONFLICT (source_submission_id) DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;
REVOKE ALL ON FUNCTION public.publier_idee_en_actualite(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publier_idee_en_actualite(uuid, text[]) TO authenticated;
