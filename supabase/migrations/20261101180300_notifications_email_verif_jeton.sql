-- ============================================================
-- V2 : notifications par email — Make vérifie le jeton auprès de la base
-- ============================================================
-- Make ne stocke aucun secret : à chaque lot reçu, il demande à la base si le jeton est le bon.
-- Un appel au webhook qui ne vient pas de la base (jeton absent ou faux) n'envoie donc rien.
CREATE OR REPLACE FUNCTION public.verifier_jeton_emails(p_jeton text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT jsonb_build_object('ok', p_jeton IS NOT NULL AND p_jeton =
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'emails_jeton'))
$$;

REVOKE ALL ON FUNCTION public.verifier_jeton_emails(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_jeton_emails(text) TO anon, service_role;
