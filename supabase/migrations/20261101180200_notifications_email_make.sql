-- ============================================================
-- V2 : notifications par email — l'envoi passe par Make
-- ============================================================
-- La base décide toujours quoi envoyer et à qui (file public.email_outbox).
-- Chaque minute, pg_cron envoie les emails prêts au webhook Make « Happy Place · Emails » :
--   { "jeton": "...", "emails": [ { "id", "to", "subject", "html" }, ... ] }
-- Make vérifie le jeton, envoie chaque email avec Gmail, puis rappelle public.marquer_email
-- (« envoyé » ou « échec ») avec la clé publishable du projet.
--
-- Mode simulé (rien ne part, l'email reste lisible dans l'app) :
-- • la personne n'a pas renseigné d'adresse de réception ;
-- • ou le webhook Make n'est pas encore enregistré dans le coffre.
--
-- Réglages, une fois par projet (coffre Supabase) :
--   SELECT vault.create_secret('https://hook.eu1.make.com/…', 'emails_make_webhook');
--   SELECT vault.create_secret('https://mon-app…', 'emails_app_url');   -- facultatif : lien « Ouvrir dans Happy Place »

-- La fonction Edge n'est plus utilisée : Make prend les emails poussés par la base.
DROP FUNCTION IF EXISTS public.emails_a_envoyer(text, integer);

-- Texte → HTML simple (Gmail dans Make n'accepte que du HTML)
CREATE OR REPLACE FUNCTION private.texte_en_html(_texte text, _lien text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">'
    || replace(replace(replace(replace(coalesce(_texte, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>')
    || CASE WHEN _lien IS NOT NULL
            THEN '<p style="margin-top:24px"><a href="' || replace(_lien, '"', '%22') || '">Ouvrir dans Happy Place</a></p>'
            ELSE '' END
    || '</div>'
$$;

CREATE OR REPLACE FUNCTION private.declencher_envoi_emails()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _webhook text;
  _jeton text;
  _app text;
  _lot jsonb;
BEGIN
  SELECT decrypted_secret INTO _webhook FROM vault.decrypted_secrets WHERE name = 'emails_make_webhook';
  SELECT decrypted_secret INTO _jeton FROM vault.decrypted_secrets WHERE name = 'emails_jeton';
  SELECT rtrim(decrypted_secret, '/') INTO _app FROM vault.decrypted_secrets WHERE name = 'emails_app_url';

  -- 1. Sans adresse de réception : simulé.
  UPDATE public.email_outbox o
     SET status = 'simulé'::public.email_status, processed_at = now(),
         note = 'Aucune adresse de réception renseignée.'
   WHERE o.status = 'à envoyer'::public.email_status
     AND NOT EXISTS (SELECT 1 FROM public.notification_preferences p
                      WHERE p.email = o.recipient_email AND p.delivery_email IS NOT NULL);

  -- 2. Make pas encore branché : simulé.
  IF _webhook IS NULL OR _jeton IS NULL THEN
    UPDATE public.email_outbox o
       SET status = 'simulé'::public.email_status, processed_at = now(),
           note = 'Envoi par Make pas encore configuré.'
     WHERE o.status = 'à envoyer'::public.email_status;
    RETURN;
  END IF;

  -- 3. Envoyé à Make mais jamais confirmé après 10 min : un nouvel essai, trois au plus.
  UPDATE public.email_outbox o
     SET status = CASE WHEN o.attempts >= 3 THEN 'échec'::public.email_status ELSE 'à envoyer'::public.email_status END,
         note = 'Pas de confirmation de Make.'
   WHERE o.status = 'en cours'::public.email_status AND o.processed_at < now() - interval '10 minutes';

  -- 4. Un lot de 20 au plus, poussé à Make.
  WITH pris AS (
    SELECT o.id FROM public.email_outbox o
     WHERE o.status = 'à envoyer'::public.email_status
     ORDER BY o.created_at LIMIT 20
     FOR UPDATE SKIP LOCKED
  ), maj AS (
    UPDATE public.email_outbox o
       SET status = 'en cours'::public.email_status, attempts = o.attempts + 1, processed_at = now()
      FROM pris WHERE o.id = pris.id
    RETURNING o.id, o.recipient_email, o.subject, o.body, o.link_path, o.created_at
  )
  SELECT jsonb_agg(jsonb_build_object(
           'id', maj.id,
           'to', p.delivery_email,
           'subject', maj.subject,
           'html', private.texte_en_html(maj.body, CASE WHEN _app IS NOT NULL AND maj.link_path IS NOT NULL
                                                         THEN _app || maj.link_path END))
           ORDER BY maj.created_at)
    INTO _lot
    FROM maj JOIN public.notification_preferences p ON p.email = maj.recipient_email;

  IF _lot IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := _webhook,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('jeton', _jeton, 'emails', _lot),
    timeout_milliseconds := 30000);
END
$$;

-- Make rappelle cette fonction avec la clé publishable : le jeton fait office de mot de passe.
GRANT EXECUTE ON FUNCTION public.marquer_email(text, uuid, text, text, text) TO anon;
