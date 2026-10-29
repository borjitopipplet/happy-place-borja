-- ============================================================
-- V2 : un manager crée directement les points bloquants de ses équipes
-- ============================================================
-- Plus besoin de passer par une proposition : le manager choisit l'une de ses équipes et le point
-- bloquant est créé tel quel (OUVERT, EN COURS ou SURVEILLANCE). Les collaborateurs continuent de proposer.

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
      -- Création directe par le manager, pour l'une de ses équipes
      IF NEW.status IS DISTINCT FROM 'PROPOSÉ'::public.blocker_status THEN
        SELECT mt.team INTO _chosen FROM public.manager_teams mt
         WHERE mt.allowed_user_id = _uid
           AND lower(btrim(mt.team)) = lower(btrim(coalesce(NEW.team, '')))
         LIMIT 1;
        IF _chosen IS NULL THEN
          RAISE EXCEPTION 'Choisis une de tes équipes pour ce point bloquant.';
        END IF;
        IF NEW.status NOT IN ('OUVERT'::public.blocker_status, 'EN COURS'::public.blocker_status, 'SURVEILLANCE'::public.blocker_status) THEN
          RAISE EXCEPTION 'Un point bloquant se crée OUVERT, EN COURS ou SURVEILLANCE.';
        END IF;
        NEW.team := _chosen;
        NEW.department := _chosen;
        NEW.proposed_team := NULL;
        NEW.proposed_by_email := NULL;
        NEW.decision_note := NULL;
        NEW.decided_by_name := NULL;
        RETURN NEW;
      END IF;
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

DROP POLICY IF EXISTS "Managers create team blockers" ON public.blockers;
CREATE POLICY "Managers create team blockers" ON public.blockers
  FOR INSERT TO authenticated
  WITH CHECK (
    private.current_app_role() = 'manager'::public.app_role
    AND team IS NOT NULL
    AND private.can_review_team(team)
    AND status IN ('OUVERT', 'EN COURS', 'SURVEILLANCE')
  );
