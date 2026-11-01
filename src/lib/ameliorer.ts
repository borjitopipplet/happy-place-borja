import { supabase } from "@/integrations/supabase/client";

export type Amelioration = { titre: string; texte: string };

/** Demande à l'assistant un titre et un texte à partir de quelques mots (fonction Supabase ameliorer-texte). */
export async function ameliorerTexte(input: { titre?: string; texte: string }): Promise<Amelioration> {
  const { data, error } = await supabase.functions.invoke<Amelioration>("ameliorer-texte", { body: input });
  if (error) {
    // Le message utile est dans le corps de la réponse (« Précise un peu ton texte… »).
    let message = "L'assistant ne répond pas pour le moment. Réessaie dans un instant.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = await ctx.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        /* corps illisible : message par défaut */
      }
    }
    throw new Error(message);
  }
  if (!data || typeof data.titre !== "string" || typeof data.texte !== "string") {
    throw new Error("Réponse inattendue de l'assistant.");
  }
  return data;
}
