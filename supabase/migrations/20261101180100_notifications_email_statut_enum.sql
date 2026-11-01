-- ============================================================
-- V2 : notifications par email — le statut d'envoi devient un ENUM
-- ============================================================
-- Comme les autres statuts de l'app : une faute de frappe dans une fonction est refusée
-- par la base, et le test « Aucune valeur d'ENUM obsolète » peut la détecter.

CREATE TYPE public.email_status AS ENUM ('à envoyer', 'en cours', 'envoyé', 'simulé', 'échec');

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.email_outbox ALTER COLUMN status TYPE public.email_status USING status::public.email_status;
ALTER TABLE public.email_outbox ALTER COLUMN status SET DEFAULT 'à envoyer'::public.email_status;

CREATE OR REPLACE FUNCTION private.envoyer_resumes(_force boolean DEFAULT false, _lundi boolean DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _paris timestamp := now() AT TIME ZONE 'Europe/Paris';
  _est_lundi boolean := coalesce(_lundi, extract(isodow FROM _paris) = 1);
  _jour text := to_char(_paris, 'YYYY-MM-DD');
  _p record;
  _sujet text;
  _corps text;
  _n integer := 0;
BEGIN
  IF NOT _force AND extract(hour FROM _paris) <> 8 THEN RETURN 0; END IF;

  -- Ménage : les emails traités de plus de 90 jours ne servent plus.
  DELETE FROM public.email_outbox
   WHERE status IN ('envoyé'::public.email_status, 'simulé'::public.email_status, 'échec'::public.email_status)
     AND created_at < now() - interval '90 days';

  FOR _p IN
    WITH items AS (
      SELECT 'Idée'::text AS genre, s.id, private.titre_idee(s.title, s.content) AS titre, s.team,
             s.author_name AS auteur, s.created_at, s.content AS detail, s.submitted_by_email AS author
        FROM public.submissions s WHERE s.status = 'en attente'::public.submission_status
      UNION ALL
      SELECT 'Point bloquant proposé', b.id, b.title, b.proposed_team,
             private.nom_de(b.proposed_by_email), b.created_at, b.description, b.proposed_by_email
        FROM public.blockers b WHERE b.status = 'PROPOSÉ'::public.blocker_status
    ), pp AS (
      SELECT r.email AS reviewer, i.*,
             (i.created_at > now() - interval '1 day') AS nouveau,
             (i.created_at < now() - interval '7 days') AS en_retard
        FROM items i CROSS JOIN LATERAL private.reviewers_for(i.team, i.author) AS r(email)
    )
    SELECT pp.reviewer,
      count(*) FILTER (WHERE pp.nouveau AND private.mode_revue(pp.reviewer) = 'quotidien') AS nb_nouveaux,
      string_agg(private.ligne_resume(pp.genre, pp.titre, pp.team, pp.auteur, pp.created_at, pp.detail), E'\n\n' ORDER BY pp.created_at)
        FILTER (WHERE pp.nouveau AND private.mode_revue(pp.reviewer) = 'quotidien') AS nouveaux,
      count(*) FILTER (WHERE _est_lundi AND pp.en_retard) AS nb_retards,
      string_agg(private.ligne_resume(pp.genre, pp.titre, pp.team, pp.auteur, pp.created_at, pp.detail), E'\n\n' ORDER BY pp.created_at)
        FILTER (WHERE _est_lundi AND pp.en_retard) AS retards
    FROM pp GROUP BY pp.reviewer
  LOOP
    CONTINUE WHEN _p.nb_nouveaux = 0 AND _p.nb_retards = 0;

    _sujet := CASE
      WHEN _p.nb_nouveaux > 0 AND _p.nb_retards > 0 THEN
        _p.nb_nouveaux || ' nouveauté(s) à traiter et ' || _p.nb_retards || ' en attente depuis plus de 7 jours'
      WHEN _p.nb_nouveaux > 0 THEN _p.nb_nouveaux || ' nouveauté(s) à traiter'
      ELSE _p.nb_retards || ' élément(s) en attente depuis plus de 7 jours' END;

    _corps := private.bonjour(_p.reviewer)
      || CASE WHEN _p.nb_nouveaux > 0
              THEN E'\n\nArrivé depuis hier et toujours en attente :\n\n' || _p.nouveaux ELSE '' END
      || CASE WHEN _p.nb_retards > 0
              THEN E'\n\nRappel du lundi — en attente depuis plus de 7 jours :\n\n' || _p.retards ELSE '' END;

    PERFORM private.ajouter_email(_p.reviewer, 'resume', 'Happy Place : ' || _sujet, _corps,
      '/a-traiter', 'resume:' || _p.reviewer || ':' || _jour);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$$;

CREATE OR REPLACE FUNCTION private.declencher_envoi_emails()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _url text;
  _jeton text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.email_outbox
     WHERE status = 'à envoyer'::public.email_status
        OR (status = 'en cours'::public.email_status AND processed_at < now() - interval '10 minutes')
  ) THEN RETURN; END IF;
  SELECT decrypted_secret INTO _url FROM vault.decrypted_secrets WHERE name = 'emails_fonction_url';
  SELECT decrypted_secret INTO _jeton FROM vault.decrypted_secrets WHERE name = 'emails_jeton';
  IF _url IS NULL OR _jeton IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jeton-envoi', _jeton),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
END
$$;

CREATE OR REPLACE FUNCTION public.emails_a_envoyer(p_jeton text, p_limite integer DEFAULT 20)
RETURNS TABLE(id uuid, recipient_email text, delivery_email text, subject text, body text, link_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
#variable_conflict use_column
BEGIN
  IF p_jeton IS NULL OR p_jeton IS DISTINCT FROM
     (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'emails_jeton') THEN
    RAISE EXCEPTION 'Jeton d''envoi invalide.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pris AS (
    SELECT o.id FROM public.email_outbox o
     WHERE o.status = 'à envoyer'::public.email_status
        OR (o.status = 'en cours'::public.email_status AND o.processed_at < now() - interval '10 minutes')
     ORDER BY o.created_at
     LIMIT least(greatest(coalesce(p_limite, 20), 1), 50)
     FOR UPDATE SKIP LOCKED
  ), maj AS (
    UPDATE public.email_outbox o
       SET status = 'en cours'::public.email_status, attempts = o.attempts + 1, processed_at = now()
      FROM pris WHERE o.id = pris.id
    RETURNING o.id, o.recipient_email, o.subject, o.body, o.link_path
  )
  SELECT maj.id, maj.recipient_email, np.delivery_email, maj.subject, maj.body, maj.link_path
    FROM maj LEFT JOIN public.notification_preferences np ON np.email = maj.recipient_email;
END
$$;

CREATE OR REPLACE FUNCTION public.marquer_email(
  p_jeton text, p_id uuid, p_statut text, p_note text DEFAULT NULL, p_destinataire text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _statut public.email_status;
BEGIN
  IF p_jeton IS NULL OR p_jeton IS DISTINCT FROM
     (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'emails_jeton') THEN
    RAISE EXCEPTION 'Jeton d''envoi invalide.' USING ERRCODE = '42501';
  END IF;
  _statut := p_statut::public.email_status;
  IF _statut NOT IN ('envoyé'::public.email_status, 'simulé'::public.email_status, 'échec'::public.email_status) THEN
    RAISE EXCEPTION 'Statut d''envoi inconnu : %', p_statut;
  END IF;
  -- Un échec est retenté deux fois (trois essais en tout), puis abandonné.
  UPDATE public.email_outbox o
     SET status = CASE WHEN _statut = 'échec'::public.email_status AND o.attempts < 3
                       THEN 'à envoyer'::public.email_status ELSE _statut END,
         note = left(p_note, 500),
         delivered_to = p_destinataire,
         processed_at = now()
   WHERE o.id = p_id AND o.status = 'en cours'::public.email_status;
END
$$;

REVOKE ALL ON FUNCTION public.emails_a_envoyer(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marquer_email(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_a_envoyer(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.marquer_email(text, uuid, text, text, text) TO service_role;
