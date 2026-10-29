-- ============================================================
-- V2 : propositions de points bloquants (1/2) — nouveaux statuts
-- ============================================================
-- PROPOSÉ : suggéré par un collaborateur, en attente de confirmation.
-- REFUSÉ  : proposition écartée par le manager de l'équipe ou un admin (conservée avec sa raison).
-- Une valeur d'ENUM ne peut pas être utilisée dans la transaction qui la crée :
-- les règles qui s'en servent sont dans la migration suivante.

ALTER TYPE public.blocker_status ADD VALUE IF NOT EXISTS 'PROPOSÉ';
ALTER TYPE public.blocker_status ADD VALUE IF NOT EXISTS 'REFUSÉ';
