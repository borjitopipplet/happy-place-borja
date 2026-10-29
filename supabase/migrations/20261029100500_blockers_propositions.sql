-- ============================================================
-- V2 : propositions de points bloquants (2/2) — colonnes, règles et permissions
-- ============================================================
-- Tout utilisateur autorisé peut PROPOSER un point bloquant (avec une priorité suggérée).
-- Seul le manager de l'équipe du proposant, ou un admin, le confirme (OUVERT) ou le refuse
-- (REFUSÉ, avec une raison obligatoire). Une proposition n'est visible que de son auteur,
-- du manager de l'équipe concernée et des admins, tant qu'elle n'est pas confirmée.

ALTER TABLE public.blockers
  ADD COLUMN IF NOT EXISTS proposed_by_email text,
  ADD COLUMN IF NOT EXISTS proposed_team text REFERENCES public.teams(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS decided_by_name text;

ALTER TABLE public.blockers
  DROP CONSTRAINT IF EXISTS blockers_decision_note_max_500;
ALTER TABLE public.blockers
  ADD CONSTRAINT blockers_decision_note_max_500
  CHECK (decision_note IS NULL OR char_length(btrim(decision_note)) <= 500);

-- 1. À la création par un non-admin : toujours une proposition, rattachée à une équipe
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
  -- Sans identité (service interne) ou admin : création directe comme avant
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
  NEW.department := NEW.proposed_team;
  NEW.decision_note := NULL;
  NEW.decided_by_name := NULL;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS set_blocker_proposal ON public.blockers;
CREATE TRIGGER set_blocker_proposal
  BEFORE INSERT ON public.blockers
  FOR EACH ROW EXECUTE FUNCTION private.set_blocker_proposal();

-- 2. Transitions autorisées (en plus des règles existantes)
CREATE OR REPLACE FUNCTION private.check_blocker_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'RÉSOLU'::public.blocker_status THEN
    RAISE EXCEPTION 'Un point bloquant ne peut pas être créé directement au statut RÉSOLU.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'OUVERT'::public.blocker_status AND NEW.status = 'RÉSOLU'::public.blocker_status THEN
      RAISE EXCEPTION 'Un point bloquant OUVERT doit d''abord passer EN COURS avant d''être RÉSOLU.';
    END IF;
    IF NEW.status = 'PROPOSÉ'::public.blocker_status AND OLD.status <> 'PROPOSÉ'::public.blocker_status THEN
      RAISE EXCEPTION 'Un point bloquant existant ne peut pas redevenir une proposition.';
    END IF;
    IF OLD.status = 'PROPOSÉ'::public.blocker_status
       AND NEW.status NOT IN ('PROPOSÉ'::public.blocker_status, 'OUVERT'::public.blocker_status, 'REFUSÉ'::public.blocker_status) THEN
      RAISE EXCEPTION 'Une proposition doit d''abord être confirmée (OUVERT) ou refusée.';
    END IF;
    IF OLD.status = 'REFUSÉ'::public.blocker_status AND NEW.status <> 'REFUSÉ'::public.blocker_status THEN
      RAISE EXCEPTION 'Une proposition refusée ne peut pas être rouverte : fais une nouvelle proposition.';
    END IF;
    IF NEW.status = 'REFUSÉ'::public.blocker_status AND OLD.status <> 'PROPOSÉ'::public.blocker_status
       AND OLD.status <> 'REFUSÉ'::public.blocker_status THEN
      RAISE EXCEPTION 'Seule une proposition peut être refusée.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- 3. Décision sur une proposition : portée du manager, raison obligatoire, nom de qui décide
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
    IF NEW.status = 'REFUSÉ'::public.blocker_status AND (NEW.decision_note IS NULL OR btrim(NEW.decision_note) = '') THEN
      RAISE EXCEPTION 'La raison du refus est obligatoire.';
    END IF;
    NEW.decided_by_name := _name;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS enforce_blocker_decision ON public.blockers;
CREATE TRIGGER enforce_blocker_decision
  BEFORE UPDATE ON public.blockers
  FOR EACH ROW EXECUTE FUNCTION private.enforce_blocker_decision();

-- 4. Permissions
DROP POLICY IF EXISTS "Allowed read" ON public.blockers;
DROP POLICY IF EXISTS "Allowed read blockers" ON public.blockers;
CREATE POLICY "Allowed read blockers" ON public.blockers
  FOR SELECT TO authenticated
  USING (
    private.is_allowed()
    AND (
      status NOT IN ('PROPOSÉ', 'REFUSÉ')
      OR private.is_admin()
      OR proposed_by_email = lower(auth.jwt() ->> 'email')
      OR (private.current_app_role() = 'manager'::public.app_role AND private.can_review_team(proposed_team))
    )
  );

DROP POLICY IF EXISTS "Allowed propose blockers" ON public.blockers;
CREATE POLICY "Allowed propose blockers" ON public.blockers
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_allowed()
    AND status = 'PROPOSÉ'
    AND proposed_by_email = lower(auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS "Managers decide proposals" ON public.blockers;
CREATE POLICY "Managers decide proposals" ON public.blockers
  FOR UPDATE TO authenticated
  USING (
    private.current_app_role() = 'manager'::public.app_role
    AND status = 'PROPOSÉ'
    AND private.can_review_team(proposed_team)
  )
  WITH CHECK (
    private.current_app_role() = 'manager'::public.app_role
    AND status IN ('OUVERT', 'REFUSÉ')
    AND private.can_review_team(proposed_team)
  );
