-- ============================================================
-- V2 : propositions de points bloquants — corrections
-- ============================================================
-- 1. Une proposition faite par un admin est rattachée à une équipe (choisie), pour que
--    le manager de cette équipe la voie. Avant, elle restait sans équipe.
-- 2. Personne ne confirme ni ne refuse sa propre proposition.
-- 3. updated_at ne bouge que si le contenu visible change : renommer une équipe
--    (ON UPDATE CASCADE sur proposed_team) ne remet plus à zéro la règle des 7 jours.

-- 1. Création
CREATE OR REPLACE FUNCTION private.set_blocker_proposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _email text := lower(auth.jwt() ->> 'email');
  _role public.app_role;
  _team text;
  _uid uuid;
  _chosen text;
BEGIN
  -- Sans identité (service interne) : création directe comme avant
  IF _email IS NULL THEN
    RETURN NEW;
  END IF;

  IF private.is_admin() THEN
    -- Un admin crée directement (Gérer les données), sauf s'il propose : il choisit alors l'équipe.
    IF NEW.status IS DISTINCT FROM 'PROPOSÉ'::public.blocker_status THEN
      RETURN NEW;
    END IF;
    SELECT t.name INTO _chosen FROM public.teams t
     WHERE NOT t.is_reserved AND lower(t.name) = lower(btrim(coalesce(NEW.proposed_team, '')));
    IF _chosen IS NULL THEN
      RAISE EXCEPTION 'Choisis l''équipe concernée par cette proposition.';
    END IF;
    NEW.proposed_team := _chosen;
  ELSE
    SELECT r.role, u.team, u.id INTO _role, _team, _uid
    FROM public.allowed_users u
    LEFT JOIN public.allowed_user_roles r ON r.allowed_user_id = u.id
    WHERE u.email = _email;

    IF _role = 'manager' THEN
      SELECT mt.team INTO _chosen FROM public.manager_teams mt
       WHERE mt.allowed_user_id = _uid
         AND (NEW.proposed_team IS NULL OR lower(btrim(mt.team)) = lower(btrim(NEW.proposed_team)))
       ORDER BY mt.team LIMIT 1;
      IF _chosen IS NULL THEN
        RAISE EXCEPTION 'Choisis une de tes équipes pour cette proposition.';
      END IF;
      NEW.proposed_team := _chosen;
    ELSE
      IF _team IS NULL OR btrim(_team) = '' THEN
        RAISE EXCEPTION 'Aucune équipe n''est associée à ton compte. Contacte un administrateur.';
      END IF;
      NEW.proposed_team := _team;
    END IF;
    NEW.status := 'PROPOSÉ';
  END IF;

  NEW.proposed_by_email := _email;
  NEW.department := NEW.proposed_team;
  NEW.decision_note := NULL;
  NEW.decided_by_name := NULL;
  RETURN NEW;
END
$$;

-- 2. Décision
CREATE OR REPLACE FUNCTION private.enforce_blocker_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _email text := lower(nullif(auth.jwt() ->> 'email', ''));
  _name text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', _email);
BEGIN
  IF private.current_app_role() = 'manager'::public.app_role THEN
    IF OLD.status <> 'PROPOSÉ'::public.blocker_status OR NOT private.can_review_team(OLD.proposed_team)
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.department IS DISTINCT FROM OLD.department
       OR NEW.proposed_team IS DISTINCT FROM OLD.proposed_team
       OR NEW.proposed_by_email IS DISTINCT FROM OLD.proposed_by_email
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Un manager peut uniquement confirmer ou refuser une proposition de son équipe (et ajuster sa priorité).';
    END IF;
  END IF;
  IF OLD.status = 'PROPOSÉ'::public.blocker_status AND NEW.status <> 'PROPOSÉ'::public.blocker_status THEN
    IF _email IS NOT NULL AND lower(OLD.proposed_by_email) = _email THEN
      RAISE EXCEPTION 'Tu ne peux pas confirmer ni refuser ta propre proposition.';
    END IF;
    IF NEW.status = 'REFUSÉ'::public.blocker_status AND (NEW.decision_note IS NULL OR btrim(NEW.decision_note) = '') THEN
      RAISE EXCEPTION 'La raison du refus est obligatoire.';
    END IF;
    NEW.decided_by_name := _name;
  END IF;
  RETURN NEW;
END
$$;

-- 3. updated_at
CREATE OR REPLACE FUNCTION private.touch_blocker_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF (NEW.title, NEW.description, NEW.department, NEW.severity, NEW.status, NEW.decision_note)
     IS DISTINCT FROM (OLD.title, OLD.description, OLD.department, OLD.severity, OLD.status, OLD.decision_note) THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$$;
