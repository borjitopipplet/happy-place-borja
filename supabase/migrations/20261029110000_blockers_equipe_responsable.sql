-- ============================================================
-- V2 : un point bloquant appartient à une équipe ; son manager peut le modifier
-- ============================================================
-- Un manager modifie (statut, priorité, titre, détails) les points bloquants de SES équipes,
-- jamais ceux des autres. Un point sans équipe reste réservé aux admins.

ALTER TABLE public.blockers
  ADD COLUMN IF NOT EXISTS team text REFERENCES public.teams(name) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Reprise de l'existant : l'équipe est déduite de l'ancien libellé de pôle quand il correspond à une équipe.
UPDATE public.blockers SET team = 'Product'               WHERE team IS NULL AND upper(department) = 'PRODUCT TEAM';
UPDATE public.blockers SET team = 'Pôle Data et IA'       WHERE team IS NULL AND upper(department) = 'DATA & IA';
UPDATE public.blockers SET team = 'Relation clients'      WHERE team IS NULL AND upper(department) = 'RELATIONS CLIENTS';
UPDATE public.blockers SET team = 'Direction recrutement' WHERE team IS NULL AND upper(department) = 'DIRECTION RECRUTEMENT';
UPDATE public.blockers SET team = 'Opérations'            WHERE team IS NULL AND upper(department) = 'OPÉRATIONS';
UPDATE public.blockers SET team = proposed_team           WHERE team IS NULL AND proposed_team IS NOT NULL;

-- Une proposition est rattachée à l'équipe du proposant
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
  IF _email IS NULL OR private.is_admin() THEN
    RETURN NEW;
  END IF;
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
  NEW.proposed_by_email := _email;
  NEW.team := NEW.proposed_team;
  NEW.department := NEW.proposed_team;
  NEW.decision_note := NULL;
  NEW.decided_by_name := NULL;
  RETURN NEW;
END
$$;

-- Ce qu'un manager peut changer sur un point bloquant de son équipe
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
    IF NEW.status = 'REFUSÉ'::public.blocker_status AND (NEW.decision_note IS NULL OR btrim(NEW.decision_note) = '') THEN
      RAISE EXCEPTION 'La raison du refus est obligatoire.';
    END IF;
    NEW.decided_by_name := _name;
  END IF;
  RETURN NEW;
END
$$;

DROP POLICY IF EXISTS "Managers decide proposals" ON public.blockers;
DROP POLICY IF EXISTS "Managers update their team blockers" ON public.blockers;
CREATE POLICY "Managers update their team blockers" ON public.blockers
  FOR UPDATE TO authenticated
  USING (
    private.current_app_role() = 'manager'::public.app_role
    AND team IS NOT NULL
    AND private.can_review_team(team)
  )
  WITH CHECK (
    private.current_app_role() = 'manager'::public.app_role
    AND team IS NOT NULL
    AND private.can_review_team(team)
  );
