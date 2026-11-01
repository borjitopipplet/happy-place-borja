-- ============================================================
-- V2 : notifications par email
-- ============================================================
-- Qui reçoit quoi :
-- • La personne qui envoie une idée ou propose un point bloquant reçoit un accusé d'envoi (désactivable),
--   puis un email à chaque décision : idée validée, refusée (avec le motif), publiée en actualité ;
--   proposition confirmée, refusée (avec la raison), point bloquant résolu.
-- • Les personnes qui traitent reçoivent, au choix, un résumé chaque matin à 8 h (par défaut)
--   ou un email par élément. Chaque lundi à 8 h, un rappel liste ce qui attend depuis plus de 7 jours.
-- • Qui traite : les managers de l'équipe, sauf l'auteur. S'il n'en reste aucun (idée d'un admin,
--   manager seul dans son équipe), les admins, sauf l'auteur.
-- Chaque email contient le contenu complet, pour tout voir d'un coup d'œil.
--
-- Fonctionnement : les emails sont écrits dans public.email_outbox, puis envoyés chaque minute.
-- L'envoi passe finalement par Make : voir 20261101180200_notifications_email_make.sql
-- (la partie « fonction Edge » ci-dessous est remplacée par cette migration).

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 1. Préférences (remplacent l'ancien « résumé hebdomadaire », jamais mis en service)
-- ------------------------------------------------------------
ALTER TABLE public.notification_preferences
  DROP COLUMN IF EXISTS weekly_summary,
  ADD COLUMN IF NOT EXISTS delivery_email text,
  ADD COLUMN IF NOT EXISTS confirm_submissions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_mode text NOT NULL DEFAULT 'quotidien';

ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_delivery_email_check;
ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_delivery_email_check
  CHECK (delivery_email IS NULL OR (
    delivery_email = lower(btrim(delivery_email))
    AND char_length(delivery_email) <= 254
    AND delivery_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_review_mode_check;
ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_review_mode_check
  CHECK (review_mode IN ('quotidien', 'immédiat'));

-- ------------------------------------------------------------
-- 2. File d'envoi
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL,
  kind text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  link_path text,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'à envoyer'
    CHECK (status IN ('à envoyer', 'en cours', 'envoyé', 'simulé', 'échec')),
  attempts integer NOT NULL DEFAULT 0,
  note text,
  delivered_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON public.email_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS email_outbox_recipient_idx ON public.email_outbox (recipient_email, created_at DESC);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.email_outbox FROM authenticated;

-- Chacun relit uniquement ses propres emails. Personne n'écrit dans la file depuis l'app.
DROP POLICY IF EXISTS "Read own emails" ON public.email_outbox;
CREATE POLICY "Read own emails" ON public.email_outbox
  FOR SELECT TO authenticated
  USING (private.is_allowed() AND recipient_email = lower(auth.jwt() ->> 'email'));

-- ------------------------------------------------------------
-- 3. Petits outils
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.nom_de(_email text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT coalesce(
    (SELECT nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
       FROM public.allowed_users u WHERE u.email = lower(_email)),
    _email)
$$;

CREATE OR REPLACE FUNCTION private.bonjour(_email text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT coalesce(
    'Bonjour ' || (SELECT nullif(btrim(u.first_name), '') FROM public.allowed_users u WHERE u.email = lower(_email)) || ',',
    'Bonjour,')
$$;

CREATE OR REPLACE FUNCTION private.date_fr(_t timestamptz)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(_t AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY "à" HH24"h"MI')
$$;

CREATE OR REPLACE FUNCTION private.veut_accuse(_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT coalesce((SELECT p.confirm_submissions FROM public.notification_preferences p WHERE p.email = lower(_email)), true)
$$;

CREATE OR REPLACE FUNCTION private.mode_revue(_email text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT coalesce((SELECT p.review_mode FROM public.notification_preferences p WHERE p.email = lower(_email)), 'quotidien')
$$;

-- Qui doit traiter un élément d'une équipe, envoyé par _author.
CREATE OR REPLACE FUNCTION private.reviewers_for(_team text, _author text)
RETURNS SETOF text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT au.email FROM public.manager_teams mt
    JOIN public.allowed_users au ON au.id = mt.allowed_user_id
    JOIN public.allowed_user_roles r ON r.allowed_user_id = au.id
    WHERE r.role = 'manager'::public.app_role
      AND lower(mt.team) = lower(_team)
      AND au.email IS DISTINCT FROM lower(_author);
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT au.email FROM public.allowed_users au
    JOIN public.allowed_user_roles r ON r.allowed_user_id = au.id
    WHERE r.role = 'admin'::public.app_role
      AND au.email IS DISTINCT FROM lower(_author);
  IF FOUND THEN RETURN; END IF;

  -- Seul admin du cabinet : il traite lui-même.
  RETURN QUERY
    SELECT au.email FROM public.allowed_users au
    JOIN public.allowed_user_roles r ON r.allowed_user_id = au.id
    WHERE r.role = 'admin'::public.app_role;
END
$$;

CREATE OR REPLACE FUNCTION private.ajouter_email(
  _to text, _kind text, _subject text, _body text, _link text, _dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  IF _to IS NULL OR btrim(_to) = '' THEN RETURN; END IF;
  INSERT INTO public.email_outbox (recipient_email, kind, subject, body, link_path, dedupe_key)
  VALUES (lower(_to), _kind, left(_subject, 200),
          _body || E'\n\n—\nHappy Place · Tu peux régler tes emails depuis le menu « Notifications » de l''app.',
          _link, _dedupe)
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION private.titre_idee(_title text, _content text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    nullif(btrim(_title), ''),
    CASE WHEN char_length(btrim(split_part(coalesce(_content, ''), E'\n', 1))) > 80
         THEN btrim(left(btrim(split_part(_content, E'\n', 1)), 77)) || '…'
         ELSE nullif(btrim(split_part(coalesce(_content, ''), E'\n', 1)), '') END,
    'Sans titre')
$$;

CREATE OR REPLACE FUNCTION private.bloc_idee(_s public.submissions)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT '« ' || private.titre_idee(_s.title, _s.content) || ' »' || E'\n\n'
    || _s.content || E'\n\n'
    || 'Équipe : ' || coalesce(_s.team, '—') || E'\n'
    || 'Envoyée par ' || coalesce(_s.author_name, '—') || ' le ' || private.date_fr(_s.created_at)
    || CASE WHEN _s.attachment_name IS NOT NULL THEN E'\nPièce jointe : ' || _s.attachment_name ELSE '' END
$$;

CREATE OR REPLACE FUNCTION private.priorite_fr(_s public.blocker_severity)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s WHEN 'critical' THEN 'Haute' WHEN 'warning' THEN 'Moyenne' WHEN 'info' THEN 'Basse' ELSE '—' END
$$;

CREATE OR REPLACE FUNCTION private.bloc_blocage(_b public.blockers)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT '« ' || _b.title || ' »' || E'\n\n'
    || coalesce(nullif(btrim(_b.description), '') || E'\n\n', '')
    || 'Équipe : ' || coalesce(_b.team, _b.proposed_team, '—') || E'\n'
    || 'Priorité : ' || private.priorite_fr(_b.severity) || E'\n'
    || 'Proposé par ' || coalesce(private.nom_de(_b.proposed_by_email), '—') || ' le ' || private.date_fr(_b.created_at)
$$;

-- ------------------------------------------------------------
-- 4. Idées : accusé, à traiter (mode immédiat), validée, refusée
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.emails_idee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _actor text := lower(nullif(auth.jwt() ->> 'email', ''));
  _author text := lower(NEW.submitted_by_email);
  _titre text := private.titre_idee(NEW.title, NEW.content);
  _bloc text := private.bloc_idee(NEW);
  _r text;
BEGIN
  -- Sans personne connectée (données de démo, tâches internes) : aucun email.
  IF _actor IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'en attente'::public.submission_status THEN RETURN NULL; END IF;
    IF _author IS NOT NULL AND private.veut_accuse(_author) THEN
      PERFORM private.ajouter_email(_author, 'idee_envoyee',
        'Ton idée a bien été envoyée : ' || _titre,
        private.bonjour(_author) || E'\n\nTon idée a bien été envoyée. Tu recevras un email dès qu''elle sera traitée.\n\n' || _bloc,
        '/', 'idee_envoyee:' || NEW.id);
    END IF;
    FOR _r IN SELECT * FROM private.reviewers_for(NEW.team, _author) LOOP
      IF private.mode_revue(_r) = 'immédiat' THEN
        PERFORM private.ajouter_email(_r, 'a_traiter',
          'Nouvelle idée à traiter : ' || _titre,
          private.bonjour(_r) || E'\n\nUne nouvelle idée attend ta décision.\n\n' || _bloc
            || E'\n\nSi quelqu''un d''autre l''a déjà traitée, tu n''as rien à faire.',
          '/a-traiter', 'a_traiter:' || NEW.id || ':' || _r);
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status OR _author IS NULL OR _author = _actor THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'validée'::public.submission_status THEN
    PERFORM private.ajouter_email(_author, 'idee_validee',
      'Ton idée a été validée : ' || _titre,
      private.bonjour(_author) || E'\n\nBonne nouvelle : ' || private.nom_de(_actor) || E' a validé ton idée.\n\n' || _bloc,
      '/', 'idee_validee:' || NEW.id);
  ELSIF NEW.status = 'refusée'::public.submission_status THEN
    PERFORM private.ajouter_email(_author, 'idee_refusee',
      'Ton idée n''a pas été retenue : ' || _titre,
      private.bonjour(_author) || E'\n\n' || private.nom_de(_actor) || E' n''a pas retenu ton idée.\n\n'
        || 'Motif : ' || coalesce(NEW.rejection_category::text, '—') || E'\n'
        || coalesce(NEW.rejection_note, '') || E'\n\n' || _bloc,
      '/', 'idee_refusee:' || NEW.id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS emails_idee ON public.submissions;
CREATE TRIGGER emails_idee
  AFTER INSERT OR UPDATE OF status ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION private.emails_idee();

-- ------------------------------------------------------------
-- 5. Idée publiée en actualité
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.emails_idee_publiee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _actor text := lower(nullif(auth.jwt() ->> 'email', ''));
  _s public.submissions%ROWTYPE;
  _pour text;
BEGIN
  IF _actor IS NULL OR NEW.source_submission_id IS NULL OR NEW.status <> 'publiée'::public.news_status THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'publiée'::public.news_status THEN RETURN NULL; END IF;

  SELECT * INTO _s FROM public.submissions WHERE id = NEW.source_submission_id;
  IF NOT FOUND OR _s.submitted_by_email IS NULL OR lower(_s.submitted_by_email) = _actor THEN RETURN NULL; END IF;

  _pour := CASE WHEN coalesce(cardinality(NEW.recipient_teams), 0) = 0 THEN 'tout le cabinet'
                ELSE array_to_string(NEW.recipient_teams, ', ') END;

  PERFORM private.ajouter_email(_s.submitted_by_email, 'idee_publiee',
    'Ton idée est publiée en actualité : ' || NEW.title,
    private.bonjour(_s.submitted_by_email) || E'\n\n' || private.nom_de(_actor)
      || ' a publié ton idée en actualité, pour ' || _pour || E'.\n\n'
      || '« ' || NEW.title || ' »' || E'\n\n' || coalesce(NEW.body, ''),
    '/', 'idee_publiee:' || _s.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS emails_idee_publiee ON public.news;
CREATE TRIGGER emails_idee_publiee
  AFTER INSERT OR UPDATE OF status ON public.news
  FOR EACH ROW EXECUTE FUNCTION private.emails_idee_publiee();

-- ------------------------------------------------------------
-- 6. Points bloquants proposés : accusé, à traiter, confirmé, refusé, résolu
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.emails_blocage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _actor text := lower(nullif(auth.jwt() ->> 'email', ''));
  _author text := lower(NEW.proposed_by_email);
  _bloc text := private.bloc_blocage(NEW);
  _r text;
BEGIN
  IF _actor IS NULL OR _author IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSÉ'::public.blocker_status THEN RETURN NULL; END IF;
    IF private.veut_accuse(_author) THEN
      PERFORM private.ajouter_email(_author, 'blocage_propose',
        'Ta proposition de point bloquant a bien été envoyée : ' || NEW.title,
        private.bonjour(_author) || E'\n\nTa proposition a bien été envoyée. Tu recevras un email dès qu''elle sera traitée.\n\n' || _bloc,
        '/', 'blocage_propose:' || NEW.id);
    END IF;
    FOR _r IN SELECT * FROM private.reviewers_for(NEW.proposed_team, _author) LOOP
      IF private.mode_revue(_r) = 'immédiat' THEN
        PERFORM private.ajouter_email(_r, 'a_traiter',
          'Point bloquant proposé à traiter : ' || NEW.title,
          private.bonjour(_r) || E'\n\nUne proposition de point bloquant attend ta décision.\n\n' || _bloc
            || E'\n\nSi quelqu''un d''autre l''a déjà traitée, tu n''as rien à faire.',
          '/a-traiter', 'a_traiter:' || NEW.id || ':' || _r);
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status OR _author = _actor THEN RETURN NULL; END IF;

  IF OLD.status = 'PROPOSÉ'::public.blocker_status AND NEW.status = 'OUVERT'::public.blocker_status THEN
    PERFORM private.ajouter_email(_author, 'blocage_confirme',
      'Ton point bloquant a été confirmé : ' || NEW.title,
      private.bonjour(_author) || E'\n\n' || private.nom_de(_actor)
        || E' a confirmé ta proposition : elle fait maintenant partie des points bloquants suivis.\n\n' || _bloc,
      '/', 'blocage_confirme:' || NEW.id);
  ELSIF NEW.status = 'REFUSÉ'::public.blocker_status THEN
    PERFORM private.ajouter_email(_author, 'blocage_refuse',
      'Ta proposition de point bloquant n''a pas été retenue : ' || NEW.title,
      private.bonjour(_author) || E'\n\n' || private.nom_de(_actor) || E' n''a pas retenu ta proposition.\n\n'
        || 'Raison : ' || coalesce(NEW.decision_note, '—') || E'\n\n' || _bloc,
      '/', 'blocage_refuse:' || NEW.id);
  ELSIF NEW.status = 'RÉSOLU'::public.blocker_status THEN
    PERFORM private.ajouter_email(_author, 'blocage_resolu',
      'Point bloquant résolu : ' || NEW.title,
      private.bonjour(_author) || E'\n\nLe point bloquant que tu avais proposé est résolu. Merci de l''avoir signalé.\n\n' || _bloc,
      '/', 'blocage_resolu:' || NEW.id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS emails_blocage ON public.blockers;
CREATE TRIGGER emails_blocage
  AFTER INSERT OR UPDATE OF status ON public.blockers
  FOR EACH ROW EXECUTE FUNCTION private.emails_blocage();

-- ------------------------------------------------------------
-- 7. Résumés : chaque matin à 8 h (heure de Paris) et rappel du lundi
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.ligne_resume(
  _genre text, _titre text, _team text, _auteur text, _created timestamptz, _detail text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT '• ' || _genre || ' — « ' || _titre || ' »' || E'\n'
    || '  Équipe ' || coalesce(_team, '—') || ', envoyé par ' || coalesce(_auteur, '—')
    || ' le ' || private.date_fr(_created)
    || CASE WHEN now() - _created >= interval '1 day'
            THEN ' (en attente depuis ' || extract(day FROM now() - _created)::int || ' j)' ELSE '' END
    || CASE WHEN nullif(btrim(_detail), '') IS NOT NULL
            THEN E'\n  ' || replace(btrim(_detail), E'\n', E'\n  ') ELSE '' END
$$;

-- _force : pour tester à n'importe quelle heure ; _lundi force le rappel des retards.
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
   WHERE status IN ('envoyé', 'simulé', 'échec') AND created_at < now() - interval '90 days';

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

-- ------------------------------------------------------------
-- 8. Envoi : pg_cron appelle la fonction Edge chaque minute s'il y a des emails en file
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'emails_jeton') THEN
    PERFORM vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'emails_jeton', 'Jeton partagé entre pg_cron et la fonction envoyer-emails');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.declencher_envoi_emails()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _url text;
  _jeton text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.email_outbox
     WHERE status = 'à envoyer' OR (status = 'en cours' AND processed_at < now() - interval '10 minutes')
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

-- Réservé à la fonction envoyer-emails (clé service_role + jeton) : prend jusqu'à 50 emails à envoyer.
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
     WHERE o.status = 'à envoyer' OR (o.status = 'en cours' AND o.processed_at < now() - interval '10 minutes')
     ORDER BY o.created_at
     LIMIT least(greatest(coalesce(p_limite, 20), 1), 50)
     FOR UPDATE SKIP LOCKED
  ), maj AS (
    UPDATE public.email_outbox o
       SET status = 'en cours', attempts = o.attempts + 1, processed_at = now()
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
BEGIN
  IF p_jeton IS NULL OR p_jeton IS DISTINCT FROM
     (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'emails_jeton') THEN
    RAISE EXCEPTION 'Jeton d''envoi invalide.' USING ERRCODE = '42501';
  END IF;
  IF p_statut NOT IN ('envoyé', 'simulé', 'échec') THEN
    RAISE EXCEPTION 'Statut d''envoi inconnu : %', p_statut;
  END IF;
  -- Un échec est retenté deux fois (trois essais en tout), puis abandonné.
  UPDATE public.email_outbox o
     SET status = CASE WHEN p_statut = 'échec' AND o.attempts < 3 THEN 'à envoyer' ELSE p_statut END,
         note = left(p_note, 500),
         delivered_to = p_destinataire,
         processed_at = now()
   WHERE o.id = p_id AND o.status = 'en cours';
END
$$;

REVOKE ALL ON FUNCTION public.emails_a_envoyer(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marquer_email(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_a_envoyer(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.marquer_email(text, uuid, text, text, text) TO service_role;

-- Tâches planifiées (pg_cron tourne en UTC : le résumé vérifie lui-même qu'il est 8 h à Paris)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-envoi-minute') THEN
    PERFORM cron.unschedule('emails-envoi-minute');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-resumes-horaire') THEN
    PERFORM cron.unschedule('emails-resumes-horaire');
  END IF;
END $$;
SELECT cron.schedule('emails-envoi-minute', '* * * * *', 'SELECT private.declencher_envoi_emails()');
SELECT cron.schedule('emails-resumes-horaire', '0 * * * *', 'SELECT private.envoyer_resumes()');

-- ------------------------------------------------------------
-- 9. Test de fumée : accusé et décisions pour l'auteur, rien d'immédiat pour le manager (mode résumé)
-- ------------------------------------------------------------
DO $do$
DECLARE
  _def text := pg_get_functiondef('private.run_smoke_tests()'::regprocedure);
BEGIN
  IF position('HP_EMAILS' IN _def) = 0 THEN
    _def := replace(_def, $a$    RAISE EXCEPTION 'HP_SMOKE_ROLLBACK';$a$, $b$    -- HP_EMAILS : emails écrits dans la file pour l'auteur, pas au manager en mode résumé
    SELECT count(*) INTO _cnt FROM email_outbox
     WHERE recipient_email = 'smoke.collab@test.invalid'
       AND dedupe_key IN ('idee_envoyee:' || _s1, 'idee_validee:' || _s1, 'idee_envoyee:' || _s2, 'idee_refusee:' || _s2);
    _res := _res || jsonb_build_object('t', 'Emails : accusés et décisions envoyés à l''auteur', 'ok', _cnt = 4, 'd', _cnt || ' email(s) sur 4');
    SELECT count(*) INTO _cnt FROM email_outbox
     WHERE recipient_email = 'smoke.manager@test.invalid' AND kind = 'a_traiter';
    _res := _res || jsonb_build_object('t', 'Emails : rien d''immédiat pour le manager en mode résumé', 'ok', _cnt = 0, 'd', _cnt || ' email(s)');

    RAISE EXCEPTION 'HP_SMOKE_ROLLBACK';$b$);
    EXECUTE _def;
  END IF;
END
$do$;
