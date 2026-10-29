-- ============================================================
-- V2 : chaque équipe a toujours au moins un manager
-- ============================================================
-- 1. Données de démonstration : un manager fictif pour chaque équipe qui n'en avait pas
--    (adresses manager.xxx@happyplace.test, comptes sans connexion possible).
-- 2. Garde-fou : on ne peut plus retirer le dernier manager d'une équipe. Le contrôle est
--    différé à la fin de la transaction, pour qu'un changement de rôle qui retire puis
--    remet la même équipe (choisir_mon_role) reste possible.

DO $$
DECLARE
  r record;
  _id uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Accounting',           'Élodie',  'Marchetti', 'accounting'),
      ('Direction Conseil',    'Thomas',  'Lefèvre',   'conseil'),
      ('Direction recrutement','Inès',    'Moreau',    'recrutement'),
      ('Finance',              'Marc',    'Delorme',   'finance'),
      ('Legal',                'Sarah',   'Cohen',     'legal'),
      ('Opérations',           'Yanis',   'Haddad',    'operations'),
      ('Relation clients',     'Clara',   'Dubois',    'clients')
    ) AS v(team, first_name, last_name, slug)
  LOOP
    IF EXISTS (SELECT 1 FROM public.teams WHERE name = r.team)
       AND NOT EXISTS (SELECT 1 FROM public.manager_teams WHERE team = r.team) THEN
      INSERT INTO public.allowed_users (email, first_name, last_name)
      VALUES ('manager.' || r.slug || '@happyplace.test', r.first_name, r.last_name)
      ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name
      RETURNING id INTO _id;
      INSERT INTO public.allowed_user_roles (allowed_user_id, role)
      VALUES (_id, 'manager') ON CONFLICT (allowed_user_id) DO NOTHING;
      INSERT INTO public.manager_teams (allowed_user_id, team) VALUES (_id, r.team);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.assert_team_has_manager(_team text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.teams t WHERE t.name = _team AND NOT t.is_reserved)
     AND NOT EXISTS (
       SELECT 1 FROM public.manager_teams mt
       JOIN public.allowed_user_roles r ON r.allowed_user_id = mt.allowed_user_id
       WHERE mt.team = _team AND r.role = 'manager'::public.app_role
     ) THEN
    RAISE EXCEPTION 'L''équipe « % » doit toujours avoir au moins un manager.', _team;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.check_manager_teams_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.assert_team_has_manager(OLD.team);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS check_manager_teams_change ON public.manager_teams;
CREATE CONSTRAINT TRIGGER check_manager_teams_change
  AFTER DELETE OR UPDATE OF team, allowed_user_id ON public.manager_teams
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_manager_teams_change();

CREATE OR REPLACE FUNCTION private.check_manager_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _t text;
BEGIN
  IF OLD.role = 'manager'::public.app_role
     AND (TG_OP = 'DELETE' OR NEW.role <> 'manager'::public.app_role) THEN
    FOR _t IN SELECT team FROM public.manager_teams WHERE allowed_user_id = OLD.allowed_user_id LOOP
      PERFORM private.assert_team_has_manager(_t);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS check_manager_role_change ON public.allowed_user_roles;
CREATE CONSTRAINT TRIGGER check_manager_role_change
  AFTER DELETE OR UPDATE OF role ON public.allowed_user_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_manager_role_change();
