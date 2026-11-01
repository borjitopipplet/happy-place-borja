-- Abandon des brouillons IA envoyés par Make (ancienne branche v2/brouillons-ia), remplacés par
-- le bouton « Améliorer ». On retire ce qu'avait ajouté cette version : la fonction de création
-- et les colonnes de source sur news. source_submission_id est conservée (idée → actualité).
-- IF EXISTS : ces objets n'existent que dans les bases où l'ancienne version avait été appliquée.
DROP FUNCTION IF EXISTS public.creer_brouillon_ia(uuid, text, text);

ALTER TABLE public.news DROP CONSTRAINT IF EXISTS news_ai_source_required;
ALTER TABLE public.news DROP CONSTRAINT IF EXISTS news_source_format;
ALTER TABLE public.news DROP COLUMN IF EXISTS generated_by_ai;
ALTER TABLE public.news DROP COLUMN IF EXISTS source_label;
ALTER TABLE public.news DROP COLUMN IF EXISTS source_url;
