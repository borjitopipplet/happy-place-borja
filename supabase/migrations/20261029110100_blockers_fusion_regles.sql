-- ============================================================
-- V2 : fusion des règles sur les points bloquants
-- ============================================================
-- Les corrections de la revue (100600) et l'équipe responsable (110000) réécrivent les deux mêmes
-- fonctions. Cette migration pose la version finale qui garde les deux :
--  * une proposition est rattachée à l'équipe du proposant (ou choisie par un admin) ET devient le point bloquant de cette équipe ;
--  * personne ne confirme ni ne refuse sa propre proposition ;
--  * un manager modifie les points bloquants de ses équipes seulement.

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
  IF _email IS NULL THEN
    RETURN NEW;
  END IF;

  IF private.is_admin() THEN
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
  NEW.team := NEW.proposed_team;
  NEW.department := NEW.proposed_team;
  NEW.decision_note := NULL;
  NEW.decided_by_name := NULL;
  RETURN NEW;
END
$$;

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
    IF OLD.team IS NULL OR NOT private.can_review_team(OLD.team)
       OR OLD.status = 'REFUSÉ'::public.blocker_status
       OR NEW.team IS DISTINCT FROM OLD.team
       OR NEW.department IS DISTINCT FROM OLD.department
       OR NEW.proposed_team IS DISTINCT FROM OLD.proposed_team
       OR NEW.proposed_by_email IS DISTINCT FROM OLD.proposed_by_email
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Un manager peut uniquement modifier les points bloquants de ses équipes (titre, détails, priorité, statut).';
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
