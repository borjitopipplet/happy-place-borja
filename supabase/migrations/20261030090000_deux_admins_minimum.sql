-- ============================================================
-- V2 : au moins deux admins en permanence
-- ============================================================
-- 1. Données de démonstration : un second admin fictif si le cabinet n'en a qu'un.
-- 2. Garde-fou : impossible de supprimer un admin ou de lui retirer son rôle tant qu'il n'y en a que deux.
--    Vaut pour tout le monde, y compris un admin et y compris par suppression du compte
--    (la suppression d'un compte supprime son rôle, ce qui déclenche le même contrôle).

DO $$
DECLARE
  _id uuid;
BEGIN
  IF (SELECT count(*) FROM public.allowed_user_roles WHERE role = 'admin'::public.app_role) < 2 THEN
    INSERT INTO public.allowed_users (email, first_name, last_name)
    VALUES ('helene.garnier@biggerboat.example', 'Hélène', 'Garnier')
    ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id INTO _id;
    INSERT INTO public.allowed_user_roles (allowed_user_id, role)
    VALUES (_id, 'admin') ON CONFLICT (allowed_user_id) DO UPDATE SET role = 'admin';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.protect_min_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
BEGIN
  IF OLD.role = 'admin'::public.app_role
     AND (TG_OP = 'DELETE' OR NEW.role <> 'admin'::public.app_role)
     AND (SELECT count(*) FROM public.allowed_user_roles WHERE role = 'admin'::public.app_role) <= 2 THEN
    RAISE EXCEPTION 'Il doit toujours y avoir au moins deux admins : impossible d''en retirer un.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS protect_last_admin_role ON public.allowed_user_roles;
DROP TRIGGER IF EXISTS protect_min_admins ON public.allowed_user_roles;
CREATE TRIGGER protect_min_admins
  BEFORE UPDATE OR DELETE ON public.allowed_user_roles
  FOR EACH ROW EXECUTE FUNCTION private.protect_min_admins();
DROP FUNCTION IF EXISTS private.protect_last_admin_role();

-- Test de fumée : deux admins au moins, et le retrait de l'un des deux derniers est refusé
DO $do$
DECLARE
  _def text := pg_get_functiondef('private.run_smoke_tests()'::regprocedure);
BEGIN
  IF position('HP_ADMINS_MIN' IN _def) = 0 THEN
    _def := replace(_def, $a$    RAISE EXCEPTION 'HP_SMOKE_ROLLBACK';$a$, $b$    -- HP_ADMINS_MIN : on garde deux admins, puis on tente d'en retirer un
    DELETE FROM allowed_user_roles
     WHERE role = 'admin' AND allowed_user_id NOT IN (
       SELECT allowed_user_id FROM allowed_user_roles WHERE role = 'admin' ORDER BY created_at, id LIMIT 2);
    BEGIN
      DELETE FROM allowed_user_roles
       WHERE allowed_user_id = (SELECT allowed_user_id FROM allowed_user_roles WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
      _res := _res || jsonb_build_object('t', 'On ne peut pas retirer l''un des deux derniers admins', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'On ne peut pas retirer l''un des deux derniers admins', 'ok', true, 'd', 'refusé par la base');
    END;

    RAISE EXCEPTION 'HP_SMOKE_ROLLBACK';$b$);
    _def := replace(_def, $a$  SELECT count(*) INTO _cnt FROM private.audit_enum_literals();$a$, $b$  SELECT count(*) INTO _cnt FROM allowed_user_roles WHERE role = 'admin';
  _res := _res || jsonb_build_object('t', 'Au moins deux admins', 'ok', _cnt >= 2, 'd', _cnt || ' admin(s)');

  SELECT count(*) INTO _cnt FROM private.audit_enum_literals();$b$);
    EXECUTE _def;
  END IF;
END
$do$;
